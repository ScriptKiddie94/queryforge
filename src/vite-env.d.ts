/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL of the Cloudflare Worker proxy. Defaults to wrangler dev's localhost in dev. */
  readonly VITE_PROXY_URL?: string;
  /** Cloudflare Turnstile *site* key (public by design). */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
