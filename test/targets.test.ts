import { describe, expect, it } from "vitest";
import { EXAMPLE_INTENTS, TARGETS, TARGET_BY_ID } from "../src/lib/targets";

describe("targets", () => {
  it("defines exactly the three expected targets", () => {
    expect(TARGETS.map((t) => t.id)).toEqual(["sentinel", "defender", "splunk"]);
  });

  it("has no duplicate target ids and every target has a hue", () => {
    const ids = new Set(TARGETS.map((t) => t.id));
    expect(ids.size).toBe(TARGETS.length);
    for (const t of TARGETS) {
      expect(t.hue).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("indexes every target in TARGET_BY_ID", () => {
    for (const t of TARGETS) {
      expect(TARGET_BY_ID[t.id]).toBe(t);
    }
  });

  it("has non-empty example intents with unique ids", () => {
    expect(EXAMPLE_INTENTS.length).toBeGreaterThan(0);
    const ids = new Set(EXAMPLE_INTENTS.map((e) => e.id));
    expect(ids.size).toBe(EXAMPLE_INTENTS.length);
    for (const e of EXAMPLE_INTENTS) {
      expect(e.intent.trim().length).toBeGreaterThan(10);
    }
  });
});
