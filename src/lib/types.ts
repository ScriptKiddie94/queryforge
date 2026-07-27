import type { TargetId } from "./targets";

export type Confidence = "low" | "medium" | "high";

/** The structured JSON contract the model must return (one per target). */
export interface GeneratedQuery {
  target: TargetId;
  /** The table/sourcetype the query runs against (must be from the catalog). */
  table: string;
  /** The generated KQL or SPL query. */
  query: string;
  /** One-line, plain-English description of what the query does. */
  explanation: string;
  confidence: Confidence;
  /**
   * Concepts from the intent that could not be mapped to the catalog.
   * Populated (with confidence "low") instead of inventing a column.
   */
  unmapped_fields: string[];
}

/** Result of the post-generation validation pass. */
export interface ValidationResult {
  ok: boolean;
  /** Column-position identifiers in the query that aren't in the catalog. */
  unknownColumns: string[];
  /** True if the model's declared `table` isn't in the catalog for the target. */
  unknownTable: boolean;
}

/** What the messages payload looks like (built server-side, authoritatively). */
export interface PromptMessages {
  system: string;
  user: string;
}

/** The request the browser sends to the Worker proxy — intent only, no prompt. */
export interface GenerateRequest {
  intent: string;
  target: TargetId;
}
