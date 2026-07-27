// QueryForge proxy — a tiny, dependency-free Cloudflare Worker that holds the
// LLM API key as a secret and forwards prompts to an OpenAI-compatible provider
// (Groq by default; swappable to Cloudflare Workers AI / Gemini via env vars).
//
// SECURITY MODEL (assume bad actors will find this URL):
//   1. Server-authoritative prompt — the client sends only { intent, target }.
//      The Worker builds the prompt from the shared schema module, so this proxy
//      can ONLY ever produce detection queries. It is useless as a free chatbot.
//   2. Cloudflare Turnstile — a valid token is required (when TURNSTILE_SECRET is
//      set), so headless/curl callers without a browser challenge are rejected.
//   3. Rate limiting — per-IP via the optional Rate Limiting binding, plus a
//      documented dashboard WAF rule as a second layer.
//   4. Hygiene — POST only, strict CORS to ALLOWED_ORIGIN, <=4KB body, strict
//      input validation, graceful 429 passthrough. The key is never in a response.

import { buildSystemPrompt, buildUserPrompt, MAX_INTENT_LENGTH } from "../../src/lib/prompt";
import { SCHEMA } from "../../src/lib/schema";
import type { TargetId } from "../../src/lib/targets";

// Cloudflare Rate Limiting binding (optional; see wrangler.toml).
interface RateLimiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  // Secrets (set via `wrangler secret put`):
  GROQ_API_KEY: string; // provider API key (Groq gsk_..., or a CF API token, etc.)
  TURNSTILE_SECRET?: string; // Turnstile secret key; when unset, verification is skipped (dev)
  // Vars (wrangler.toml [vars]):
  LLM_MODEL?: string;
  LLM_BASE_URL?: string;
  ALLOWED_ORIGIN?: string;
  // Optional binding:
  RATE_LIMITER?: RateLimiter;
}

const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
const MAX_BODY_BYTES = 4096;
const VALID_TARGETS = Object.keys(SCHEMA) as TargetId[];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin, env);

    // --- Preflight ---
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // --- Method guard ---
    if (request.method !== "POST") {
      return errorResponse(405, "method_not_allowed", "Use POST.", cors);
    }

    // --- Body size guard (header hint + hard cap on actual bytes) ---
    const declaredLen = Number(request.headers.get("Content-Length") ?? "0");
    if (declaredLen > MAX_BODY_BYTES) {
      return errorResponse(413, "payload_too_large", "Request body too large.", cors);
    }
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return errorResponse(413, "payload_too_large", "Request body too large.", cors);
    }

    // --- Parse + validate the ONLY accepted shape: { intent, target } ---
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return errorResponse(400, "bad_json", "Body must be JSON.", cors);
    }
    const parsed = validatePayload(payload);
    if (!parsed.ok) return errorResponse(400, "bad_request", parsed.error, cors);
    const { intent, target } = parsed;

    // --- Turnstile (primary anti-abuse gate) ---
    if (env.TURNSTILE_SECRET) {
      const token = request.headers.get("cf-turnstile-token");
      const ip = request.headers.get("CF-Connecting-IP") ?? undefined;
      const ok = await verifyTurnstile(env.TURNSTILE_SECRET, token, ip);
      if (!ok) {
        return errorResponse(403, "challenge_failed", "Bot challenge failed.", cors);
      }
    }

    // --- Rate limiting (per IP), if the binding is configured ---
    if (env.RATE_LIMITER) {
      const ip = request.headers.get("CF-Connecting-IP") ?? "anonymous";
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) {
        return errorResponse(429, "rate_limited", "Rate limited — try again shortly.", cors);
      }
    }

    // --- Build the prompt SERVER-SIDE (never trust a client-supplied prompt) ---
    const system = buildSystemPrompt(target);
    const user = buildUserPrompt(intent);

    // --- Call the OpenAI-compatible provider ---
    const baseUrl = (env.LLM_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    const model = env.LLM_MODEL ?? DEFAULT_MODEL;

    let providerRes: Response;
    try {
      providerRes = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 1500,
          temperature: 0.1,
          // Ask for strict JSON; the generator still defends against fences.
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
    } catch {
      return errorResponse(502, "provider_unreachable", "Upstream model unreachable.", cors);
    }

    // Pass provider rate limits through cleanly so the UI can show a nice message.
    if (providerRes.status === 429) {
      return errorResponse(429, "rate_limited", "Model provider is rate limited — try again.", cors);
    }
    if (!providerRes.ok) {
      // Never leak the provider body (could echo the key or internal detail).
      return errorResponse(502, "provider_error", `Model provider error (${providerRes.status}).`, cors);
    }

    const data = await providerRes.text();
    return new Response(data, {
      status: 200,
      headers: { ...cors, "content-type": "application/json" },
    });
  },
};

// --- helpers ---------------------------------------------------------------

type PayloadResult =
  | { ok: true; intent: string; target: TargetId }
  | { ok: false; error: string };

function validatePayload(payload: unknown): PayloadResult {
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, error: "Expected a JSON object." };
  }
  const o = payload as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.some((k) => k !== "intent" && k !== "target")) {
    return { ok: false, error: "Only { intent, target } is accepted." };
  }
  if (typeof o.intent !== "string" || o.intent.trim().length === 0) {
    return { ok: false, error: "intent must be a non-empty string." };
  }
  if (o.intent.length > MAX_INTENT_LENGTH) {
    return { ok: false, error: `intent must be <= ${MAX_INTENT_LENGTH} characters.` };
  }
  if (typeof o.target !== "string" || !VALID_TARGETS.includes(o.target as TargetId)) {
    return { ok: false, error: `target must be one of: ${VALID_TARGETS.join(", ")}.` };
  }
  return { ok: true, intent: o.intent, target: o.target as TargetId };
}

async function verifyTurnstile(
  secret: string,
  token: string | null,
  ip: string | undefined,
): Promise<boolean> {
  if (!token) return false;
  try {
    const body = new FormData();
    body.append("secret", secret);
    body.append("response", token);
    if (ip) body.append("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
    });
    const out = (await res.json()) as { success?: boolean };
    return out.success === true;
  } catch {
    return false;
  }
}

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = env.ALLOWED_ORIGIN ?? "*";
  // If a specific origin is configured, only echo it back when it matches.
  const allowOrigin =
    allowed === "*" ? "*" : origin && origin === allowed ? allowed : allowed;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, cf-turnstile-token",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  cors: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
