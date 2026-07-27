import { describe, expect, it } from "vitest";
import { extractColumnCandidates, validateQuery } from "../src/lib/validate";

describe("validator — flags hallucinated columns", () => {
  it("flags a made-up column in a KQL filter", () => {
    const q =
      'DeviceProcessEvents\n| where Timestamp > ago(24h)\n| where MagicThreatScore > 5';
    const r = validateQuery(q, "defender", "DeviceProcessEvents");
    expect(r.ok).toBe(false);
    expect(r.unknownColumns).toContain("MagicThreatScore");
  });

  it("flags a made-up field in an SPL match", () => {
    const q = 'sourcetype=sysmon EventCode=1 BogusField="evil"';
    const r = validateQuery(q, "splunk", "sysmon");
    expect(r.ok).toBe(false);
    expect(r.unknownColumns).toContain("BogusField");
  });

  it("flags an unknown declared table", () => {
    const q = "MadeUpTable\n| where Timestamp > ago(1h)";
    const r = validateQuery(q, "defender", "MadeUpTable");
    expect(r.unknownTable).toBe(true);
    expect(r.ok).toBe(false);
  });
});

describe("validator — passes clean queries (no false positives)", () => {
  it("passes a real Defender KQL query", () => {
    const q = `DeviceProcessEvents
| where Timestamp > ago(24h)
| where InitiatingProcessFileName in~ ("winword.exe","excel.exe","outlook.exe")
| where FileName =~ "powershell.exe"
| where ProcessCommandLine has_any ("-enc","-EncodedCommand")
| project Timestamp, DeviceName, AccountName, ProcessCommandLine`;
    const r = validateQuery(q, "defender", "DeviceProcessEvents");
    expect(r.unknownColumns).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("does not flag KQL functions/operators like ago, bin, count, summarize", () => {
    const q = `DeviceNetworkEvents
| where Timestamp > ago(7d)
| summarize Connections = count() by DeviceName, bin(Timestamp, 1h)
| where Connections > 100`;
    const r = validateQuery(q, "defender", "DeviceNetworkEvents");
    expect(r.unknownColumns).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("passes a real Splunk query with stats/by and meta fields", () => {
    const q = `sourcetype=sysmon EventCode=1 ParentImage="*\\\\winword.exe" Image="*\\\\powershell.exe"
| stats count by host, User, CommandLine`;
    const r = validateQuery(q, "splunk", "sysmon");
    expect(r.unknownColumns).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("passes Suricata dotted fields", () => {
    const q = 'sourcetype=suricata event_type="dns" dns.rrname="*.xyz"';
    const r = validateQuery(q, "splunk", "suricata");
    expect(r.ok).toBe(true);
  });

  it("does not scan values inside string literals", () => {
    // 'NotARealColumn' only appears inside a quoted value, so must NOT be flagged.
    const q = 'DeviceProcessEvents | where ProcessCommandLine contains "NotARealColumn=1"';
    const r = validateQuery(q, "defender", "DeviceProcessEvents");
    expect(r.ok).toBe(true);
  });
});

describe("extractColumnCandidates", () => {
  it("extracts column-position identifiers, not values", () => {
    const cands = extractColumnCandidates(
      'DeviceProcessEvents | where FileName =~ "cmd.exe"',
      "defender",
    );
    expect(cands).toContain("FileName");
    expect(cands).not.toContain("cmd");
  });
});
