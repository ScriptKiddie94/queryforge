import { describe, expect, it } from "vitest";
import {
  MAX_INTENT_LENGTH,
  buildMessages,
  buildSystemPrompt,
  buildUserPrompt,
} from "../src/lib/prompt";

describe("prompt builder", () => {
  it("injects the correct schema slice for the target", () => {
    const sys = buildSystemPrompt("defender");
    // Defender-only table present, Sentinel-only table absent.
    expect(sys).toContain("DeviceFileEvents");
    expect(sys).toContain("InitiatingProcessCommandLine");
    expect(sys).not.toContain("SigninLogs");
  });

  it("injects Splunk sourcetypes and SPL for the splunk target", () => {
    const sys = buildSystemPrompt("splunk");
    expect(sys).toContain("sourcetype=sysmon");
    expect(sys).toContain("Query language: SPL");
    expect(sys).toContain("WinEventLog:Security");
  });

  it("pins the model to a JSON-only contract", () => {
    const sys = buildSystemPrompt("sentinel");
    expect(sys).toMatch(/return ONLY a JSON object/i);
    expect(sys).toContain('"unmapped_fields"');
    expect(sys).toMatch(/no markdown code fences/i);
    expect(sys).toContain('"target": "sentinel"');
  });

  it("tells the model not to invent columns", () => {
    const sys = buildSystemPrompt("sentinel");
    expect(sys).toMatch(/never invent or guess/i);
  });

  it("user prompt carries the intent and is length-capped", () => {
    const long = "x".repeat(MAX_INTENT_LENGTH + 500);
    const user = buildUserPrompt(long);
    expect(user).toContain("Hunting intent:");
    expect(user.length).toBeLessThan(MAX_INTENT_LENGTH + 200);
  });

  it("buildMessages returns both system and user", () => {
    const msgs = buildMessages("find powershell", "sentinel");
    expect(msgs.system.length).toBeGreaterThan(0);
    expect(msgs.user).toContain("find powershell");
  });

  it("is deterministic (Worker and frontend must build identical prompts)", () => {
    expect(buildSystemPrompt("splunk")).toBe(buildSystemPrompt("splunk"));
    expect(buildUserPrompt("abc")).toBe(buildUserPrompt("abc"));
  });
});
