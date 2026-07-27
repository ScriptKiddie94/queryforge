import { useEffect, useRef } from "react";

// Cloudflare Turnstile — renders only when VITE_TURNSTILE_SITE_KEY is set.
// In local dev (no site key), this renders nothing and the Worker skips the
// bot gate, so the app still works end-to-end.

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
  remove: (id: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    __qfTurnstileReady?: boolean;
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

export function TurnstileWidget({ onToken }: { onToken: (token: string | null) => void }) {
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!siteKey || !ref.current) return;
    let widgetId: string | undefined;
    let cancelled = false;
    const container = ref.current;

    loadScript()
      .then(() => {
        if (cancelled || !window.turnstile || !container) return;
        widgetId = window.turnstile.render(container, {
          sitekey: siteKey,
          theme: "dark",
          size: "flexible",
          callback: (token) => onToken(token),
          "error-callback": () => onToken(null),
          "expired-callback": () => onToken(null),
        });
      })
      .catch(() => onToken(null));

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, onToken]);

  if (!siteKey) return null;
  return <div ref={ref} className="turnstile" style={{ marginTop: 12 }} />;
}
