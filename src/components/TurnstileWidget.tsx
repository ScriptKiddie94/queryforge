import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

// Cloudflare Turnstile — renders only when VITE_TURNSTILE_SITE_KEY is set.
// In local dev (no site key), this renders nothing and the Worker skips the
// bot gate, so the app still works end-to-end.
//
// Turnstile tokens are SINGLE-USE. QueryForge fires one backend request per
// shown target (up to 3, in parallel), so one token cannot cover a whole
// "Generate" click. Instead, getToken() is called once per target — Cloudflare's
// documented pattern for "give me another token" is to reset() the already-
// rendered widget, which re-runs verification (near-instant in Managed mode)
// and fires the callback again with a fresh token.

interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
      theme?: "auto" | "light" | "dark";
      size?: "normal" | "flexible" | "compact";
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("turnstile load failed")));
      return;
    }
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("turnstile load failed"));
    document.head.appendChild(s);
  });
}

export interface TurnstileHandle {
  /** Resolves with a fresh, single-use verification token. One call per backend request. */
  getToken: () => Promise<string>;
}

export const TurnstileWidget = forwardRef<TurnstileHandle, { onReady: (ready: boolean) => void }>(
  function TurnstileWidget({ onReady }, ref) {
    const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string>();
    const pendingRef = useRef<{ resolve: (t: string) => void; reject: (e: Error) => void } | null>(
      null,
    );

    useEffect(() => {
      if (!siteKey || !containerRef.current) return;
      let cancelled = false;
      const container = containerRef.current;

      loadScript()
        .then(() => {
          if (cancelled || !window.turnstile || !container) return;
          widgetIdRef.current = window.turnstile.render(container, {
            sitekey: siteKey,
            theme: "dark",
            size: "flexible",
            callback: (token) => {
              onReady(true);
              pendingRef.current?.resolve(token);
              pendingRef.current = null;
            },
            "error-callback": () => {
              onReady(false);
              pendingRef.current?.reject(new Error("Turnstile challenge failed."));
              pendingRef.current = null;
            },
            "expired-callback": () => onReady(false),
          });
        })
        .catch(() => onReady(false));

      return () => {
        cancelled = true;
        if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [siteKey]);

    useImperativeHandle(
      ref,
      () => ({
        getToken: () =>
          new Promise<string>((resolve, reject) => {
            if (!window.turnstile || !widgetIdRef.current) {
              reject(new Error("Turnstile not ready."));
              return;
            }
            pendingRef.current = { resolve, reject };
            // reset() re-runs verification and fires `callback` again with a new token.
            window.turnstile.reset(widgetIdRef.current);
          }),
      }),
      [],
    );

    if (!siteKey) return null;
    return <div ref={containerRef} className="turnstile" style={{ marginTop: 12 }} />;
  },
);
