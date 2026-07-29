# QueryForge Proxy (Cloudflare Worker)

A tiny, dependency-free Worker that holds the LLM API key as a secret and forwards
prompts to an OpenAI-compatible provider (**Groq** by default). The static frontend
can't hide a key, so every AI call routes through here.

## Why this exists / how it stays secure

A public proxy URL *will* be found and abused. This Worker is hardened so it's
worthless to an attacker:

1. **Server-authoritative prompt.** The browser sends only `{ intent, target }`.
   The Worker builds the actual prompt from the shared schema module
   ([`../src/lib/prompt.ts`](../src/lib/prompt.ts)). The proxy can therefore *only*
   produce detection queries — it is not a general-purpose LLM you can jailbreak.
2. **Cloudflare Turnstile, exchanged for a short-lived "burst" token.** Turnstile
   tokens are single-use, but one "Generate" click fans out to up to 3 parallel
   target requests. So the client solves Turnstile once per click and exchanges
   it via `POST /verify` for an HMAC-signed, 60-second burst token, which the N
   parallel calls to `POST /` then share. The Worker verifies the burst token's
   signature + expiry locally (stateless, no KV/Durable Objects) — no repeat
   `siteverify` calls, and Turnstile's single-use rule is never violated because
   the burst token isn't a Turnstile token. `curl`/headless callers without a
   browser challenge are rejected with `403`.
3. **Per-IP rate limiting** via the Rate Limiting binding (optional, free) plus a
   documented dashboard WAF rule.
4. **Hygiene:** POST only, strict CORS locked to `ALLOWED_ORIGIN`, ≤4 KB body,
   strict input validation (only `{ intent, target }`, `target` allow-listed,
   `intent` length-capped), and graceful `429` passthrough. Provider error bodies
   are never forwarded (so the key can never leak).

## Endpoints

`POST /verify` — exchange one solved Turnstile token for a burst token (skip if
`TURNSTILE_SECRET` is unset):

```jsonc
// headers: cf-turnstile-token: <token from the Turnstile widget>
// response
{ "burstToken": "1785300000000.Xy...", "exp": 1785300000000 }
```

`POST /` — the actual generation call:

```jsonc
// request
{ "intent": "find powershell spawned from office with an encoded command", "target": "defender" }
// headers (production): cf-turnstile-token: <burstToken from /verify>
```

Returns the provider's OpenAI-compatible JSON (`choices[0].message.content` holds
the model's JSON). Errors return `{ "error": { "code": string, "message": string } }`.

## Configuration

| Name | Where | Default | Purpose |
|------|-------|---------|---------|
| `GROQ_API_KEY` | **secret** | — | Provider bearer key (Groq `gsk_…`, or a CF API token for Workers AI) |
| `TURNSTILE_SECRET` | **secret** | *(unset → skipped)* | Turnstile secret key; enables the bot gate |
| `BURST_SECRET` | **secret** | *(falls back to `TURNSTILE_SECRET`)* | Optional dedicated HMAC key for burst tokens; separate from `TURNSTILE_SECRET` for stricter key separation in high-security deployments |
| `LLM_MODEL` | var | `llama-3.3-70b-versatile` | Model id (never hardcoded in logic) |
| `LLM_BASE_URL` | var | `https://api.groq.com/openai/v1` | OpenAI-compatible base URL |
| `ALLOWED_ORIGIN` | var | `*` | Lock to your Pages origin in production |
| `RATE_LIMITER` | binding | *(optional)* | Per-IP rate limit (see `wrangler.toml`) |

## Deploy (≈4 commands)

```bash
cd worker
npm install
npx wrangler login                       # opens browser, authorizes once
npx wrangler secret put GROQ_API_KEY     # paste your gsk_ key when prompted
# optional but recommended for a public demo:
npx wrangler secret put TURNSTILE_SECRET # paste your Turnstile secret key
npx wrangler deploy                      # prints https://queryforge-proxy.<you>.workers.dev
```

Then wire that URL into the frontend as `VITE_PROXY_URL` (see the root README) and,
once you know your Pages URL, set `ALLOWED_ORIGIN` to it:

```bash
npx wrangler deploy --var ALLOWED_ORIGIN:https://<you>.github.io
```

## Local development

```bash
npx wrangler dev            # serves on http://localhost:8787 (the frontend's default)
```

Put local secrets in `worker/.dev.vars` (git-ignored), e.g.:

```
GROQ_API_KEY=gsk_your_key_here
# TURNSTILE_SECRET intentionally omitted locally so the bot gate is skipped
```

Run `npm run dev` in the repo root for the app and `wrangler dev` here for the
proxy — a full local loop with no cloud deploy.

## Switching provider (no code changes)

**Cloudflare Workers AI** (model runs on Cloudflare, no Groq account):

```
LLM_BASE_URL = https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1
LLM_MODEL    = @cf/meta/llama-3.3-70b-instruct-fp8-fast
GROQ_API_KEY = <a Cloudflare API token>   # var name unchanged; it's just the bearer
```

**Google Gemini** (OpenAI-compatible mode) or **OpenRouter**: set `LLM_BASE_URL`
and `LLM_MODEL` to theirs and put their key in `GROQ_API_KEY`.

## Hardening notes

- **Rate Limiting binding:** uncomment the block in `wrangler.toml`. Syntax can
  change across Wrangler versions — confirm against the current
  [Rate Limiting docs](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
- **Dashboard WAF rate limit:** a second, code-free layer — add a Rate Limiting
  rule on the Worker route in the Cloudflare dashboard.
- **Turnstile:** create a widget at Cloudflare dashboard → Turnstile; put the
  **site** key in the frontend (`VITE_TURNSTILE_SITE_KEY`) and the **secret** key
  here (`wrangler secret put TURNSTILE_SECRET`).
