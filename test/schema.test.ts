import { describe, expect, it } from "vitest";
import {
  ALL_SCHEMAS,
  allColumns,
  columnsForTable,
  getSchema,
  tableNames,
} from "../src/lib/schema";

describe("schema catalog", () => {
  it("every table has at least one column", () => {
    for (const schema of ALL_SCHEMAS) {
      for (const table of schema.tables) {
        expect(table.columns.length, `${schema.target}.${table.name}`).toBeGreaterThan(0);
      }
    }
  });

  it("no duplicate table names within a target", () => {
    for (const schema of ALL_SCHEMAS) {
      const names = schema.tables.map((t) => t.name.toLowerCase());
      expect(new Set(names).size, schema.target).toBe(names.length);
    }
  });

  it("no duplicate column names within a table", () => {
    for (const schema of ALL_SCHEMAS) {
      for (const table of schema.tables) {
        const cols = table.columns.map((c) => c.name.toLowerCase());
        expect(new Set(cols).size, `${schema.target}.${table.name}`).toBe(cols.length);
      }
    }
  });

  it("each target has 3–5 tables (small but real)", () => {
    for (const schema of ALL_SCHEMAS) {
      expect(schema.tables.length).toBeGreaterThanOrEqual(3);
      expect(schema.tables.length).toBeLessThanOrEqual(5);
    }
  });

  it("allColumns is the lowercased union across tables", () => {
    const cols = allColumns("defender");
    expect(cols.has("processcommandline")).toBe(true);
    expect(cols.has("initiatingprocessfilename")).toBe(true);
    expect(cols.has("this_is_not_real")).toBe(false);
  });

  it("columnsForTable scopes to a single table", () => {
    const cols = columnsForTable("sentinel", "SigninLogs");
    expect(cols.has("userprincipalname")).toBe(true);
    expect(cols.has("commandline")).toBe(false); // that's SecurityEvent
  });

  it("tableNames returns lowercased sourcetypes for splunk", () => {
    expect(tableNames("splunk").has("sysmon")).toBe(true);
    expect(tableNames("splunk").has("wineventlog:security")).toBe(true);
  });

  it("getSchema returns the right language per target", () => {
    expect(getSchema("sentinel").language).toBe("KQL");
    expect(getSchema("defender").language).toBe("KQL");
    expect(getSchema("splunk").language).toBe("SPL");
  });
});
