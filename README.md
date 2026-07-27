# QueryForge

**Natural-language → detection query.** Type a plain-English hunting intent and get
a correct, runnable query for **Microsoft Sentinel / Defender XDR (KQL)** and
**Splunk (SPL)**, side by side — grounded in a real schema catalog so it uses actual
table and column names instead of hallucinated ones.

> Sibling project to [`sigma-to-kql`](https://github.com/). That one is deterministic
> (rule → query). This one is LLM-assisted (intent → query) but stays grounded and
> honest: no invented tables or columns, and every result is validated against the
> catalog before you see it.

🔗 **Live demo:** _<add your GitHub Pages URL here after first deploy>_

---

## Why this isn't just "ask the LLM for KQL"

A naive prompt-the-model app invents column names and functions that don't exist, so
the query fails the moment you paste it into a SIEM. QueryForge's whole value is
**grounding** the generation in a curated schema and then **checking the model's
work**:

```
  Plain-English intent
          │
          ▼
  ┌─────────────────┐   only { intent, target } leaves the browser
  │  Schema catalog │   (src/lib/schema.ts) — real tables + columns per target
  └────────┬────────┘
           ▼
  ┌─────────────────┐   Cloudflare Worker builds the prompt SERVER-SIDE,
  │  Prompt builder │   injecting the schema slice + strict JSON contract
  └────────┬────────┘   (src/lib/prompt.ts)
           ▼
  ┌─────────────────┐   Groq (llama-3.3-70b) via an OpenAI-compatible endpoint,
  │   LLM (proxy)   │   key held only as a Worker secret
  └────────┬────────┘
           ▼
  ┌─────────────────┐   parse JSON safely (strip fences, try/catch)
  │    Generator    │   (src/lib/generate.ts)
  └────────┬────────┘
           ▼
  ┌─────────────────┐   flag any column NOT in the catalog → amber warning
  │    Validator    │   (src/lib/validate.ts)  ← the credibility layer
  └────────┬────────┘
           ▼
   KQL / SPL + explanation + confidence + validation badge
```

Every card shows a **confidence badge** and, when the validator finds a column that
isn't in the catalog, an **amber warning strip** — so you never trust the model
blindly.

---

## Architecture

- **Frontend:** static Vite + React + TypeScript app (Tailwind, dark theme), deployed
  free to **GitHub Pages**. Holds no secrets.
- **Backend:** a tiny, dependency-free **Cloudflare Worker** ([`worker/`](worker/))
  that holds the LLM API key as a secret and forwards prompts to an OpenAI-compatible
  provider. Free tier, no credit card, no servers, **$0 hosting**.
- **Provider:** **Groq free tier** (`llama-3.3-70b-versatile`) by default. The model
  and base URL are **env vars, never hardcoded**, so switching to **Cloudflare
  Workers AI**, **Google Gemini** (OpenAI-compatible mode), or **OpenRouter** is a
  config change with no code edits. See [`worker/README.md`](worker/README.md).

### How the key stays secret

A static site can't hide an API key, so **the key never touches the frontend**. All
AI calls go through the Worker, which holds the key as a Cloudflare secret. The
browser sends only `{ intent, target }` — the Worker builds the prompt itself, so the
proxy can *only* produce detection queries and is useless as a stolen general-purpose
LLM. On top of that: **Cloudflare Turnstile** (bot gate), **per-IP rate limiting**,
strict CORS, and a body-size cap. Details in [`worker/README.md`](worker/README.md).

---

## Local development

Two terminals, a fully working loop, no cloud deploy:

```bash
# terminal 1 — the proxy (needs a Groq key in worker/.dev.vars; see worker/README.md)
cd worker && npm install && npx wrangler dev      # http://localhost:8787

# terminal 2 — the app
npm install && npm run dev                         # http://localhost:5173
```

The frontend defaults `VITE_PROXY_URL` to `http://localhost:8787` (wrangler dev's
default), so no env config is needed for local dev.

```bash
npm test         # vitest — schema, prompt, validator, generator (proxy mocked)
npm run build    # typecheck + production build
```

---

## Deploy (free, ~4 commands)

1. **Deploy the Worker** (holds your key):
   ```bash
   cd worker
   npm install
   npx wrangler login
   npx wrangler secret put GROQ_API_KEY        # your gsk_... key
   npx wrangler deploy                          # prints your Worker URL
   ```
   (Optional, recommended for a public demo: `npx wrangler secret put TURNSTILE_SECRET`.)

2. **Wire the URL + deploy the app:** in the GitHub repo, set
   **Settings → Secrets and variables → Actions**:
   - `VITE_PROXY_URL` = your Worker URL (e.g. `https://queryforge-proxy.you.workers.dev`)
   - `VITE_TURNSTILE_SITE_KEY` = your Turnstile *site* key (only if you enabled Turnstile)

   Enable **Settings → Pages → Source: GitHub Actions**, then push to `main`. The
   [deploy workflow](.github/workflows/deploy.yml) tests, builds, and publishes to
   Pages automatically (the base path is derived from the repo name).

3. **Lock CORS (recommended):** once you know your Pages URL, set the Worker's
   `ALLOWED_ORIGIN` to it so only your site can call the proxy:
   ```bash
   cd worker && npx wrangler deploy --var ALLOWED_ORIGIN:https://<you>.github.io
   ```

Full provider-swap and hardening notes: [`worker/README.md`](worker/README.md).

---

## How it stays grounded / known limitations

- **It's assistive, not authoritative.** Review every query before running it in
  production. The confidence badge and validation strip are aids, not guarantees.
- **The schema catalog is a curated subset**, not exhaustive — 3–5 real tables per
  target ([`src/lib/schema.ts`](src/lib/schema.ts)). Extend it for your environment;
  that directly improves grounding.
- **The validator is a high-precision heuristic, not a full query parser.** It flags
  column-position identifiers that aren't in the catalog and deliberately errs toward
  *not* crying wolf on legitimate functions/operators. It can miss an exotic
  construction; it won't drown you in false alarms.
- **The model can still be wrong** about logic even when every column is valid — a
  clean validation badge means "the columns exist," not "the detection is correct."

---

## Project layout

```
src/lib/schema.ts     schema catalog (grounding source of truth)
src/lib/prompt.ts     prompt builder (shared with the Worker)
src/lib/generate.ts   proxy call + safe JSON parsing
src/lib/validate.ts   column validator (the credibility layer)
src/components/        OutputCard, TurnstileWidget
test/                  vitest suite (proxy mocked — no real network)
worker/               Cloudflare Worker proxy + its README
```

## License

[MIT](LICENSE)
