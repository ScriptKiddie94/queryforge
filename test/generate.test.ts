import { describe, expect, it, vi } from "vitest";
import { generate, parseModelContent } from "../src/lib/generate";
import type { GeneratedQuery } from "../src/lib/types";

// Build a fake OpenAI-compatible Response whose message content is `content`.
function mockProxy(content: string, status = 200): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

const SAMPLE: GeneratedQuery = {
  target: "defender",
  table: "DeviceProcessEvents",
  query:
    'DeviceProcessEvents\n| where Timestamp > ago(24h)\n| where FileName =~ "powershell.exe"',
  explanation: "Finds PowerShell process creations in the last 24 hours.",
  confidence: "high",
  unmapped_fields: [],
};

describe("parseModelContent", () => {
  it("parses clean JSON", () => {
    const r = parseModelContent(JSON.stringify(SAMPLE), "defender");
    expect(r.query).toContain("DeviceProcessEvents");
    expect(r.confidence).toBe("high");
  });

  it("strips ```json code fences the model added anyway", () => {
    const fenced = "```json\n" + JSON.stringify(SAMPLE) + "\n```";
    const r = parseModelContent(fenced, "defender");
    expect(r.table).toBe("DeviceProcessEvents");
  });

  it("recovers JSON wrapped in prose", () => {
    const messy = "Here you go:\n" + JSON.stringify(SAMPLE) + "\nHope that helps!";
    const r = parseModelContent(messy, "defender");
    expect(r.query).toContain("powershell.exe");
  });

  it("defaults confidence to low when invalid", () => {
    const r = parseModelContent(JSON.stringify({ ...SAMPLE, confidence: "banana" }), "defender");
    expect(r.confidence).toBe("low");
  });

  it("throws when there is no query", () => {
    expect(() => parseModelContent(JSON.stringify({ ...SAMPLE, query: "" }), "defender")).toThrow();
  });

  it("throws on non-JSON", () => {
    expect(() => parseModelContent("I cannot help with that.", "defender")).toThrow();
  });
});

describe("generate (mocked proxy — no real network)", () => {
  it("returns a parsed result on success", async () => {
    const out = await generate("find powershell", "defender", {
      fetchImpl: mockProxy(JSON.stringify(SAMPLE)),
      url: "http://mock/proxy",
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.query).toContain("DeviceProcessEvents");
  });

  it("sends only { intent, target } to the proxy (no client-built prompt)", async () => {
    const spy = mockProxy(JSON.stringify(SAMPLE));
    await generate("find powershell", "sentinel", { fetchImpl: spy, url: "http://mock/proxy" });
    const body = JSON.parse((spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body).toEqual({ intent: "find powershell", target: "sentinel" });
    expect(body).not.toHaveProperty("system");
    expect(body).not.toHaveProperty("prompt");
  });

  it("maps a 429 to rate_limited", async () => {
    const out = await generate("x", "splunk", {
      fetchImpl: mockProxy("{}", 429),
      url: "http://mock/proxy",
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.kind).toBe("rate_limited");
  });

  it("maps a thrown fetch to a network error", async () => {
    const out = await generate("x", "splunk", {
      fetchImpl: (() => {
        throw new Error("offline");
      }) as unknown as typeof fetch,
      url: "http://mock/proxy",
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.kind).toBe("network");
  });

  it("maps unparseable model content to a parse error", async () => {
    const out = await generate("x", "splunk", {
      fetchImpl: mockProxy("not json at all"),
      url: "http://mock/proxy",
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.kind).toBe("parse");
  });
});
