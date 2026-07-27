// Generator — calls the Worker proxy (NOT the LLM provider directly) and safely
// parses the model's JSON. The browser sends only { intent, target }; the Worker
// owns the prompt. The provider replies in OpenAI-compatible shape, so we read
// choices[0].message.content and parse the JSON inside it.
//
// Design note: the UI fires one call PER TARGET in parallel (Promise.all) rather
// than a single multi-target conversation. Tradeoff: 2–3× requests, but lower
// latency and fault isolation — one target's malformed JSON can't sink the others.

import type { TargetId } from "./targets";
import type { Confidence, GeneratedQuery } from "./types";

/** Default proxy URL — wrangler dev's default. Overridden by VITE_PROXY_URL. */
export const DEFAULT_PROXY_URL = "http://localhost:8787";

export function proxyUrl(): string {
  return import.meta.env.VITE_PROXY_URL ?? DEFAULT_PROXY_URL;
}

export type GenerateErrorKind =
  | "rate_limited"
  | "network"
  | "server"
  | "parse"
  | "empty";

export type GenerateOutcome =
  | { ok: true; result: GeneratedQuery }
  | { ok: false; kind: GenerateErrorKind; message: string };

export interface GenerateOptions {
  /** Override for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Override for tests. Defaults to proxyUrl(). */
  url?: string;
  /** Cloudflare Turnstile token, attached as a header for the Worker to verify. */
  turnstileToken?: string;
  signal?: AbortSignal;
}

const VALID_CONFIDENCE: readonly Confidence[] = ["low", "medium", "high"];

/** Strip accidental ```json fences and surrounding prose, then JSON.parse. */
export function parseModelContent(content: string, target: TargetId): GeneratedQuery {
  let text = content.trim();

  // Remove a leading/trailing code fence if the model added one anyway.
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) text = fence[1].trim();

  // If there's still surrounding prose, grab the outermost JSON object.
  if (!text.startsWith("{")) {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last > first) text = text.slice(first, last + 1);
  }

  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error("Model did not return valid JSON.");
  }

  if (typeof obj !== "object" || obj === null) {
    throw new Error("Model JSON was not an object.");
  }
  const o = obj as Record<string, unknown>;

  const query = typeof o.query === "string" ? o.query.trim() : "";
  if (!query) throw new Error("Model JSON had no query.");

  const confidence: Confidence = VALID_CONFIDENCE.includes(o.confidence as Confidence)
    ? (o.confidence as Confidence)
    : "low";

  const unmapped = Array.isArray(o.unmapped_fields)
    ? o.unmapped_fields.filter((x): x is string => typeof x === "string")
    : [];

  return {
    target,
    table: typeof o.table === "string" ? o.table : "",
    query,
    explanation: typeof o.explanation === "string" ? o.explanation : "",
    confidence,
    unmapped_fields: unmapped,
  };
}

/** Extract choices[0].message.content from an OpenAI-compatible response body. */
function extractContent(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const msg = (choices[0] as { message?: { content?: unknown } })?.message;
  return typeof msg?.content === "string" ? msg.content : null;
}

/** Generate one target's query via the Worker proxy. Never throws. */
export async function generate(
  intent: string,
  target: TargetId,
  opts: GenerateOptions = {},
): Promise<GenerateOutcome> {
  const doFetch = opts.fetchImpl ?? fetch;
  const endpoint = opts.url ?? proxyUrl();

  let res: Response;
  try {
    res = await doFetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(opts.turnstileToken ? { "cf-turnstile-token": opts.turnstileToken } : {}),
      },
      body: JSON.stringify({ intent, target }),
      signal: opts.signal,
    });
  } catch {
    return { ok: false, kind: "network", message: "Could not reach the query service." };
  }

  if (res.status === 429) {
    return { ok: false, kind: "rate_limited", message: "Rate limited — try again in a moment." };
  }
  if (!res.ok) {
    return {
      ok: false,
      kind: "server",
      message: `Query service error (${res.status}).`,
    };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, kind: "parse", message: "Query service returned malformed data." };
  }

  const content = extractContent(body);
  if (content == null) {
    return { ok: false, kind: "empty", message: "The model returned no content." };
  }

  try {
    return { ok: true, result: parseModelContent(content, target) };
  } catch (e) {
    return {
      ok: false,
      kind: "parse",
      message: e instanceof Error ? e.message : "Could not parse the model output.",
    };
  }
}
