import { useEffect, useRef, useState } from "react";
import { OutputCard, type CardState } from "./components/OutputCard";
import { TurnstileWidget, type TurnstileHandle } from "./components/TurnstileWidget";
import { generate, verifyTurnstile } from "./lib/generate";
import { EXAMPLE_INTENTS, TARGETS, type TargetId } from "./lib/targets";
import { validateQuery } from "./lib/validate";

type View = "all" | TargetId;

const IDLE: CardState = { status: "idle" };
const requiresTurnstile = Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY);

const STEPS = [
  {
    n: "01",
    title: "Schema catalog",
    desc: "Real tables and columns for Sentinel, Defender XDR, and Splunk — the ground truth the model is held to.",
  },
  {
    n: "02",
    title: "Prompt injection",
    desc: "The Worker builds the prompt server-side, injecting only the relevant schema slice and a strict JSON contract.",
  },
  {
    n: "03",
    title: "LLM generation",
    desc: "Llama 3.3 (via Groq) turns your intent into a query — no key ever touches the browser.",
  },
  {
    n: "04",
    title: "Validation",
    desc: "Every column is checked against the catalog. Anything invented is flagged before you ever run it.",
  },
];

export default function App() {
  const [intent, setIntent] = useState<string>(EXAMPLE_INTENTS[0].intent);
  const [activeChip, setActiveChip] = useState<string>(EXAMPLE_INTENTS[0].id);
  const [view, setView] = useState<View>("all");
  const [busy, setBusy] = useState(false);
  const [turnstileReady, setTurnstileReady] = useState(false);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const [cards, setCards] = useState<Record<TargetId, CardState>>({
    sentinel: IDLE,
    defender: IDLE,
    splunk: IDLE,
  });

  // Reveal static content as it scrolls into view.
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>("[data-reveal]");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const shownTargets = view === "all" ? TARGETS : TARGETS.filter((t) => t.id === view);
  const canGenerate =
    intent.trim().length > 0 && !busy && (!requiresTurnstile || turnstileReady);

  async function runGeneration() {
    if (!canGenerate) return;
    setBusy(true);

    // Only (re)generate the targets currently shown — respects the toggle as a
    // cost control. Each target is an independent parallel call so one failure
    // can't sink the others.
    const targets = shownTargets.map((t) => t.id);
    setCards((prev) => {
      const next = { ...prev };
      for (const id of targets) next[id] = { status: "loading" };
      return next;
    });

    // Turnstile tokens are single-use, but one click fans out to N parallel
    // target requests. So: solve Turnstile ONCE, exchange it for a short-lived
    // burst token (POST /verify), then share that burst token across all N
    // generate() calls — it isn't a Turnstile token, so the single-use rule
    // doesn't apply to it.
    let burstToken: string | undefined;
    if (requiresTurnstile) {
      let rawToken: string;
      try {
        rawToken = await turnstileRef.current!.getToken();
      } catch {
        setCards((prev) => {
          const next = { ...prev };
          for (const id of targets) {
            next[id] = { status: "error", message: "Bot verification failed — try again." };
          }
          return next;
        });
        setBusy(false);
        return;
      }
      const verified = await verifyTurnstile(rawToken);
      if (!verified.ok) {
        setCards((prev) => {
          const next = { ...prev };
          for (const id of targets) next[id] = { status: "error", message: verified.message };
          return next;
        });
        setBusy(false);
        return;
      }
      burstToken = verified.burstToken;
    }

    await Promise.all(
      targets.map(async (id) => {
        const outcome = await generate(intent, id, { turnstileToken: burstToken });
        setCards((prev) => ({
          ...prev,
          [id]: outcome.ok
            ? {
                status: "done",
                result: outcome.result,
                validation: validateQuery(outcome.result.query, id, outcome.result.table),
              }
            : { status: "error", message: outcome.message },
        }));
      }),
    );

    setBusy(false);
  }

  return (
    <>
      <nav className="nav">
        <div className="container nav-inner">
          <a className="brand" href="#top">
            <span className="brand-mark" />
            Query<span className="accent">Forge</span>
          </a>
          <div className="nav-links">
            <a className="nav-link hide-sm" href="#how">
              How it works
            </a>
            <a className="nav-link hide-sm" href="#studio">
              Generate
            </a>
            <a className="nav-link" href="https://github.com/ScriptKiddie94/queryforge" target="_blank" rel="noreferrer">
              GitHub ↗
            </a>
          </div>
        </div>
      </nav>

      <header className="hero" id="top">
        <div className="container">
          <div className="kicker" data-reveal>
            <span className="kicker-dot" />
            detection engineering · AI-assisted
          </div>
          <h1 className="hero-title" data-reveal>
            Plain-English intent, forged into a query that <span className="grad">actually runs</span>.
          </h1>
          <p className="hero-sub" data-reveal>
            Describe a hunting idea in one sentence and get runnable Microsoft Sentinel,
            Defender XDR (KQL) and Splunk (SPL) detections side by side — grounded in a
            curated schema catalog, so they use real table and column names instead of
            hallucinated ones.
          </p>
          <div className="hero-meta" data-reveal>
            {TARGETS.map((t) => (
              <span className="meta-item" key={t.id}>
                <span className="meta-dot" style={{ background: t.hue, boxShadow: `0 0 8px ${t.hue}` }} />
                {t.label}
              </span>
            ))}
          </div>
        </div>
      </header>

      <section className="section" id="studio">
        <div className="container">
          <div className="section-head" data-reveal>
            <p className="eyebrow">The studio</p>
            <h2 className="section-title">Forge a detection</h2>
            <p className="section-desc">
              Pick an example or write your own intent, choose your targets, and generate.
              Each result carries a confidence badge and a live validation check.
            </p>
          </div>

          <div className="studio-grid">
            <aside className="studio-side">
              <div className="chips">
                <span className="chips-label">Try:</span>
                {EXAMPLE_INTENTS.map((ex) => (
                  <button
                    key={ex.id}
                    className={"chip" + (activeChip === ex.id ? " active" : "")}
                    onClick={() => {
                      setIntent(ex.intent);
                      setActiveChip(ex.id);
                    }}
                  >
                    {ex.label}
                  </button>
                ))}
              </div>

              <div>
                <div className="side-label">Targets</div>
                <div className="toggle" style={{ marginTop: 8 }}>
                  <button className={view === "all" ? "on" : ""} onClick={() => setView("all")}>
                    All
                  </button>
                  {TARGETS.map((t) => (
                    <button
                      key={t.id}
                      className={view === t.id ? "on" : ""}
                      style={{ ["--hue" as string]: t.hue }}
                      onClick={() => setView(t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="io-panel">
                <label htmlFor="intent">Hunting intent (natural language)</label>
                <textarea
                  id="intent"
                  spellCheck={false}
                  value={intent}
                  onChange={(e) => {
                    setIntent(e.target.value);
                    setActiveChip("");
                  }}
                  placeholder="e.g. Find PowerShell spawned from Office apps with an encoded command in the last 24h"
                />
                <div className="generate-row">
                  <button className="generate-btn" onClick={runGeneration} disabled={!canGenerate}>
                    {busy ? "Generating…" : "Generate queries"}
                  </button>
                  {requiresTurnstile && !turnstileReady && (
                    <span className="hint">Complete the challenge to enable.</span>
                  )}
                </div>
                <TurnstileWidget ref={turnstileRef} onReady={setTurnstileReady} />
              </div>
            </aside>

            <div className="results">
              {shownTargets.map((t) => (
                <OutputCard key={t.id} target={t} state={cards[t.id]} />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section section-band" id="how">
        <div className="container">
          <div className="section-head" data-reveal>
            <p className="eyebrow">How it stays grounded</p>
            <h2 className="section-title">Four steps, one honest result</h2>
            <p className="section-desc">
              The value isn't asking an LLM for KQL — it's holding it to a real schema and
              checking its work. Here's the pipeline behind every query.
            </p>
          </div>
          <div className="how-grid">
            {STEPS.map((s, i) => (
              <div className={"step-card d" + (i + 1)} key={s.n} data-reveal>
                <div className="step-num">
                  {s.n} {i < STEPS.length - 1 && <span className="step-arrow">→</span>}
                </div>
                <h3 className="step-title">{s.title}</h3>
                <p className="step-desc">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <div className="container footer-inner">
          <span>
            Assistive — always review a query before running it. Sibling of{" "}
            <a href="https://github.com/ScriptKiddie94" target="_blank" rel="noreferrer">
              sigma-to-kql
            </a>
            .
          </span>
          <a href="https://github.com/ScriptKiddie94/queryforge" target="_blank" rel="noreferrer">
            View source on GitHub ↗
          </a>
        </div>
      </footer>
    </>
  );
}
