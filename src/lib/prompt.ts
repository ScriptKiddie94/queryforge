// Prompt builder — injects the schema slice for a target and pins the model to
// a strict JSON contract. This module is the single source of truth for the
// prompt: the frontend can use it to preview, but the Cloudflare Worker imports
// it and rebuilds the prompt server-side so the proxy can ONLY ever be driven to
// produce detection queries (never a general-purpose chatbot).

import { getSchema, type TableDef } from "./schema";
import type { TargetId } from "./targets";
import type { PromptMessages } from "./types";

/** Max characters of user intent we forward. Guards prompt size and abuse. */
export const MAX_INTENT_LENGTH = 1000;

function formatTable(t: TableDef): string {
  const cols = t.columns
    .map((c) => `    - ${c.name} (${c.type})${c.desc ? `: ${c.desc}` : ""}`)
    .join("\n");
  return `  ${t.name} — ${t.desc}\n${cols}`;
}

function formatSchema(target: TargetId): string {
  const schema = getSchema(target);
  const tables = schema.tables.map(formatTable).join("\n\n");
  const notes = schema.dialectNotes.map((n) => `  - ${n}`).join("\n");
  const tableRefHint =
    schema.tableRef === "spl-sourcetype"
      ? "Reference a table by its sourcetype value (e.g. `sourcetype=sysmon`)."
      : "Reference a table by its name at the start of the query.";
  return [
    `Query language: ${schema.language}`,
    tableRefHint,
    "",
    "Available tables and their ONLY valid columns:",
    tables,
    "",
    "Dialect notes:",
    notes,
  ].join("\n");
}

/**
 * The system prompt. Injects the target's schema slice and the JSON contract.
 * Kept deterministic so the Worker and the frontend build byte-identical prompts.
 */
export function buildSystemPrompt(target: TargetId): string {
  const schema = getSchema(target);
  return `You are QueryForge, a detection-engineering assistant that converts a plain-English hunting intent into a single, runnable ${schema.language} query for ${labelFor(target)}.

${formatSchema(target)}

STRICT RULES:
1. Use ONLY the tables and columns listed above. Never invent or guess a table or column name.
2. If the intent references data that has no matching column in the catalog, do NOT fabricate one. Instead, get as close as the catalog allows, add the concept to "unmapped_fields", and lower your confidence.
3. Produce ONE query against the single most appropriate table.
4. Prefer a time filter when the intent implies a window (e.g. "last 24h").
5. Keep the query correct and minimal — no comments, no placeholders, no markdown code fences.

CONFIDENCE:
- "high": every part of the intent maps cleanly to catalog columns.
- "medium": the core maps, but some nuance is approximated.
- "low": significant parts of the intent cannot be expressed with the catalog (unmapped_fields is non-empty).

OUTPUT FORMAT — return ONLY a JSON object (no prose, no code fences) with exactly these keys:
{
  "target": ${JSON.stringify(target)},
  "table": "<one table/sourcetype name from the catalog>",
  "query": "<the ${schema.language} query as a single string>",
  "explanation": "<one sentence, plain English, describing what the query detects>",
  "confidence": "high" | "medium" | "low",
  "unmapped_fields": ["<intent concepts with no catalog column>", ...]
}`;
}

/** The user message — the intent, truncated defensively. */
export function buildUserPrompt(intent: string): string {
  const trimmed = intent.trim().slice(0, MAX_INTENT_LENGTH);
  return `Hunting intent:\n${trimmed}\n\nReturn only the JSON object described above.`;
}

/** Both messages, for a target + intent. */
export function buildMessages(intent: string, target: TargetId): PromptMessages {
  return { system: buildSystemPrompt(target), user: buildUserPrompt(intent) };
}

function labelFor(target: TargetId): string {
  switch (target) {
    case "sentinel":
      return "Microsoft Sentinel";
    case "defender":
      return "Microsoft Defender XDR (Advanced Hunting)";
    case "splunk":
      return "Splunk";
  }
}
