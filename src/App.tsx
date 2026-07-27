import { useCallback, useState } from "react";
import { OutputCard, type CardState } from "./components/OutputCard";
import { TurnstileWidget } from "./components/TurnstileWidget";
import { generate } from "./lib/generate";
import { EXAMPLE_INTENTS, TARGETS, type TargetId } from "./lib/targets";
import { validateQuery } from "./lib/validate";

type View = "all" | TargetId;

const IDLE: CardState = { status: "idle" };
const requiresTurnstile = Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY);

export default function App() {
  const [intent, setIntent] = useState<string>(EXAMPLE_INTENTS[0].intent);
  const [activeChip, setActiveChip] = useState<string>(EXAMPLE_INTENTS[0].id);
  const [view, setView] = useState<View>("all");
  const [busy, setBusy] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [cards, setCards] = useState<Record<TargetId, CardState>>({
    sentinel: IDLE,
    defender: IDLE,
    splunk: IDLE,
  });

  const shownTargets = view === "all" ? TARGETS : TARGETS.filter((t) => t.id === view);
  const canGenerate =
    intent.trim().length > 0 && !busy && (!requiresTurnstile || !!turnstileToken);

  const onToken = useCallback((t: string | null) => setTurnstileToken(t), []);

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

    await Promise.all(
      targets.map(async (id) => {
        const outcome = await generate(intent, id, {
          turnstileToken: turnstileToken ?? undefined,
        });
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
    <div className="wrap">
      <header>
        <div className="badge">detection engineering · AI-assisted</div>
        <h1>
          Query<span className="arrow">Forge</span>
        </h1>
        <p>
          Describe a hunting intent in plain English and get a runnable Microsoft
          Sentinel / Defender XDR (KQL) and Splunk (SPL) detection query — grounded in
          a curated schema catalog, so it uses real table and column names instead of
          hallucinated ones.
        </p>
      </header>

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

      <div className="toggle">
        <button className={view === "all" ? "on" : ""} onClick={() => setView("all")}>
          All targets
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

      <div className="grid">
        <div className="input-col">
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
            {requiresTurnstile && !turnstileToken && (
              <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>
                Complete the challenge to enable generation.
              </span>
            )}
          </div>
          <TurnstileWidget onToken={onToken} />
        </div>

        <div className={"output-col" + (view === "all" ? "" : " single")}>
          {shownTargets.map((t) => (
            <OutputCard key={t.id} target={t} state={cards[t.id]} />
          ))}
        </div>
      </div>

      <footer>
        <span>
          Grounded generation: schema catalog → prompt injection → LLM → validation.
          Assistive — always review a query before running it.
        </span>
        <a href="https://github.com/" target="_blank" rel="noreferrer">
          Sibling of sigma-to-kql ↗
        </a>
      </footer>
    </div>
  );
}
