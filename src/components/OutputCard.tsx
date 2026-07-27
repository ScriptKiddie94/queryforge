import { useState } from "react";
import { highlight } from "../lib/highlight";
import type { TargetDef } from "../lib/targets";
import type { GeneratedQuery, ValidationResult } from "../lib/types";

export type CardState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; result: GeneratedQuery; validation: ValidationResult };

export function OutputCard({ target, state }: { target: TargetDef; state: CardState }) {
  const [copied, setCopied] = useState(false);
  const hue = { ["--hue" as string]: target.hue };

  const query = state.status === "done" ? state.result.query : "";

  function copy() {
    navigator.clipboard.writeText(query).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }

  return (
    <div className={"card" + (state.status === "loading" ? " loading" : "")} style={hue}>
      <div className="card-head">
        <span className="card-title">
          <span className="dot" />
          {target.label} <span className="lang">{target.lang}</span>
        </span>
        {state.status === "done" && (
          <button className={copied ? "copied" : ""} onClick={copy}>
            {copied ? "✓ Copied" : "Copy"}
          </button>
        )}
      </div>

      {state.status === "idle" && (
        <div className="placeholder">
          Enter an intent and generate to see the {target.lang} query, a plain-English
          explanation, a confidence badge, and a validation check.
        </div>
      )}

      {state.status === "loading" && (
        <div className="placeholder">
          <span className="spinner" style={hue} />
          Generating {target.lang}…
        </div>
      )}

      {state.status === "error" && <pre className="err">{state.message}</pre>}

      {state.status === "done" && (
        <>
          <pre dangerouslySetInnerHTML={{ __html: highlight(state.result.query) }} />

          <div className="card-meta">
            <span className="explanation">
              {state.result.explanation || "No explanation provided."}
              {state.result.unmapped_fields.length > 0 && (
                <>
                  {" "}
                  <span style={{ color: "#d29922" }}>
                    Unmapped: {state.result.unmapped_fields.join(", ")}.
                  </span>
                </>
              )}
            </span>
            <span className={"confidence " + state.result.confidence}>
              {state.result.confidence} confidence
            </span>
          </div>

          {!state.validation.ok && (
            <div className="warn">
              ⚠{" "}
              {state.validation.unknownTable && (
                <>
                  Table <code>{state.result.table}</code> is not in the catalog.{" "}
                </>
              )}
              {state.validation.unknownColumns.length > 0 && (
                <>
                  Column{state.validation.unknownColumns.length > 1 ? "s" : ""} not in the
                  schema catalog:{" "}
                  <code>{state.validation.unknownColumns.join(", ")}</code> — review before
                  running.
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
