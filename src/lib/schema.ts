// Schema catalog — the grounding layer.
//
// This is what stops the LLM from inventing table and column names: the prompt
// injects the relevant slice, and the validator checks output against it. It is
// a curated, real-but-not-exhaustive subset (4–5 tables per target).
//
// Modeled honestly per how these products actually work:
//   • Microsoft Sentinel  → Log Analytics tables (SecurityEvent, SigninLogs) plus
//     the Defender Device* tables that surface via the M365 Defender connector.
//   • Defender XDR         → Advanced Hunting tables (Device*, Identity*).
//   • Splunk               → common sourcetypes (sysmon, WinEventLog:Security, Suricata).

import type { TargetId } from "./targets";

export interface ColumnDef {
  name: string;
  /** Coarse type, injected into the prompt to guide correct operators. */
  type: "string" | "int" | "long" | "real" | "datetime" | "bool" | "dynamic";
  /** Short hint so the model maps intent → the right column. */
  desc?: string;
}

export interface TableDef {
  /** How the table is referenced: KQL table name, or Splunk sourcetype value. */
  name: string;
  desc: string;
  columns: ColumnDef[];
}

export interface TargetSchema {
  target: TargetId;
  language: "KQL" | "SPL";
  /** How a table is entered in a query, shown to the model. */
  tableRef: "kql-table" | "spl-sourcetype";
  /** Dialect reminders injected into the system prompt. */
  dialectNotes: string[];
  tables: TableDef[];
}

const s = (name: string, desc?: string): ColumnDef => ({ name, type: "string", desc });
const dt = (name: string, desc?: string): ColumnDef => ({ name, type: "datetime", desc });
const int = (name: string, desc?: string): ColumnDef => ({ name, type: "int", desc });

// ---------------------------------------------------------------------------
// Microsoft Sentinel (Log Analytics / KQL)
// ---------------------------------------------------------------------------
const SENTINEL: TargetSchema = {
  target: "sentinel",
  language: "KQL",
  tableRef: "kql-table",
  dialectNotes: [
    "Query begins with the table name, then piped operators: `Table | where ... | where ...`.",
    "Time filtering uses TimeGenerated, e.g. `| where TimeGenerated > ago(24h)`.",
    "String matching: ==, =~ (case-insensitive equals), has, contains, startswith, endswith, in~.",
    "Use `has`/`contains` for substring; prefer `has` for tokenized performance.",
  ],
  tables: [
    {
      name: "SecurityEvent",
      desc: "Windows Security event log (via the Security Events / AMA connector). Process creation (EventID 4688), logons (4624/4625).",
      columns: [
        dt("TimeGenerated", "event time"),
        s("Computer", "hostname"),
        int("EventID", "e.g. 4688 process create, 4624 logon success, 4625 logon fail"),
        s("Activity"),
        s("Account", "domain\\user"),
        s("SubjectUserName", "acting user"),
        s("TargetUserName", "target user of the action"),
        int("LogonType", "2 interactive, 3 network, 10 remote interactive"),
        s("IpAddress", "source IP for logons"),
        s("WorkstationName"),
        s("NewProcessName", "full path of the created process (4688)"),
        s("ParentProcessName", "full path of the parent process"),
        s("CommandLine", "process command line"),
        s("LogonProcessName"),
        s("Channel"),
      ],
    },
    {
      name: "SigninLogs",
      desc: "Microsoft Entra ID (Azure AD) interactive sign-ins.",
      columns: [
        dt("TimeGenerated"),
        s("UserPrincipalName", "UPN of the account"),
        s("UserDisplayName"),
        s("IPAddress", "source IP of the sign-in"),
        s("AppDisplayName", "target application"),
        s("ClientAppUsed", "e.g. Browser, Mobile Apps"),
        int("ResultType", "0 = success; non-zero = failure code"),
        s("ResultDescription"),
        s("ConditionalAccessStatus", "success/failure/notApplied"),
        s("RiskLevelDuringSignIn", "none/low/medium/high"),
        s("RiskState"),
        s("AuthenticationRequirement", "singleFactor/multiFactorAuthentication"),
        { name: "Location", type: "dynamic", desc: "geo of the sign-in" },
        { name: "DeviceDetail", type: "dynamic" },
      ],
    },
    {
      name: "DeviceProcessEvents",
      desc: "Defender for Endpoint process creation (surfaced in Sentinel via the M365 Defender connector).",
      columns: [
        dt("Timestamp"),
        s("DeviceName", "hostname"),
        s("AccountName", "user the process ran as"),
        s("AccountDomain"),
        s("FileName", "process image file name, e.g. powershell.exe"),
        s("FolderPath", "full path of the process image"),
        s("ProcessCommandLine", "full command line"),
        s("SHA256"),
        s("InitiatingProcessFileName", "parent process image name"),
        s("InitiatingProcessFolderPath", "parent process path"),
        s("InitiatingProcessCommandLine", "parent command line"),
        s("InitiatingProcessParentFileName", "grandparent process name"),
        s("InitiatingProcessAccountName"),
      ],
    },
    {
      name: "DeviceNetworkEvents",
      desc: "Defender for Endpoint outbound/inbound network connections (surfaced in Sentinel via the M365 Defender connector).",
      columns: [
        dt("Timestamp"),
        s("DeviceName"),
        s("ActionType", "e.g. ConnectionSuccess, ConnectionFailed"),
        s("RemoteIP", "destination IP"),
        int("RemotePort", "destination port"),
        s("RemoteUrl", "destination URL/host"),
        s("LocalIP"),
        int("LocalPort"),
        s("Protocol", "Tcp/Udp"),
        s("InitiatingProcessFileName", "process that made the connection"),
        s("InitiatingProcessFolderPath"),
        s("InitiatingProcessCommandLine"),
        s("InitiatingProcessAccountName"),
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Defender XDR (Advanced Hunting / KQL)
// ---------------------------------------------------------------------------
const DEFENDER: TargetSchema = {
  target: "defender",
  language: "KQL",
  tableRef: "kql-table",
  dialectNotes: [
    "Advanced Hunting KQL. Query begins with the table name, then piped operators.",
    "Time filtering uses Timestamp, e.g. `| where Timestamp > ago(24h)`.",
    "String matching: ==, =~, has, contains, startswith, endswith, has_any, in~.",
    "Parent/initiating process fields are prefixed InitiatingProcess*.",
  ],
  tables: [
    {
      name: "DeviceProcessEvents",
      desc: "Process creation events from Defender for Endpoint.",
      columns: [
        dt("Timestamp"),
        s("DeviceName"),
        s("ActionType"),
        s("FileName", "process image file name, e.g. powershell.exe"),
        s("FolderPath", "full path of the process image"),
        s("ProcessCommandLine", "full command line"),
        s("ProcessIntegrityLevel"),
        s("SHA256"),
        s("AccountName", "user the process ran as"),
        s("AccountDomain"),
        s("InitiatingProcessFileName", "parent process image name, e.g. winword.exe"),
        s("InitiatingProcessFolderPath"),
        s("InitiatingProcessCommandLine", "parent command line"),
        s("InitiatingProcessParentFileName", "grandparent process name"),
        s("InitiatingProcessAccountName"),
      ],
    },
    {
      name: "DeviceNetworkEvents",
      desc: "Network connection events from Defender for Endpoint.",
      columns: [
        dt("Timestamp"),
        s("DeviceName"),
        s("ActionType", "e.g. ConnectionSuccess"),
        s("RemoteIP"),
        int("RemotePort"),
        s("RemoteUrl", "destination URL/host name"),
        s("LocalIP"),
        int("LocalPort"),
        s("Protocol"),
        s("InitiatingProcessFileName"),
        s("InitiatingProcessFolderPath"),
        s("InitiatingProcessCommandLine"),
        s("InitiatingProcessAccountName"),
      ],
    },
    {
      name: "DeviceFileEvents",
      desc: "File create/modify/rename events from Defender for Endpoint.",
      columns: [
        dt("Timestamp"),
        s("DeviceName"),
        s("ActionType", "FileCreated, FileModified, FileRenamed, FileDeleted"),
        s("FileName"),
        s("FolderPath"),
        s("SHA256"),
        s("FileOriginUrl", "download source URL, if any"),
        s("InitiatingProcessFileName"),
        s("InitiatingProcessCommandLine"),
        s("InitiatingProcessAccountName"),
        s("RequestAccountName"),
      ],
    },
    {
      name: "DeviceEvents",
      desc: "Miscellaneous sensor events (ASR, AMSI, LSASS access, scheduled tasks, etc.). Discriminate with ActionType.",
      columns: [
        dt("Timestamp"),
        s("DeviceName"),
        s("ActionType", "e.g. AsrOfficeChildProcessBlocked, AmsiScriptDetection"),
        s("FileName"),
        s("FolderPath"),
        s("ProcessCommandLine"),
        s("RemoteIP"),
        s("RemoteUrl"),
        s("AccountName"),
        s("InitiatingProcessFileName"),
        s("InitiatingProcessCommandLine"),
        { name: "AdditionalFields", type: "dynamic", desc: "JSON blob of event-specific detail" },
      ],
    },
    {
      name: "IdentityLogonEvents",
      desc: "Authentication events across identity providers (Defender for Identity / cloud apps).",
      columns: [
        dt("Timestamp"),
        s("ActionType", "LogonSuccess, LogonFailed"),
        s("LogonType"),
        s("AccountName"),
        s("AccountDomain"),
        s("AccountUpn"),
        s("DeviceName"),
        s("IPAddress", "source IP"),
        s("Protocol"),
        s("FailureReason"),
        s("Application"),
        { name: "Location", type: "dynamic" },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Splunk (SPL) — common sourcetypes
// ---------------------------------------------------------------------------
const SPLUNK: TargetSchema = {
  target: "splunk",
  language: "SPL",
  tableRef: "spl-sourcetype",
  dialectNotes: [
    "Start with a base search selecting the sourcetype: `sourcetype=<name> field=value ...`.",
    "Field matches use `field=\"value\"` with * wildcards, e.g. `Image=\"*\\\\powershell.exe\"`.",
    "Combine with AND/OR/NOT (uppercase). Aggregate/transform with `| stats`, `| eval`, `| where`.",
    "Time is filtered with earliest=/latest= or the time picker; _time is the event time field.",
    "These meta fields are always valid: _time, _raw, host, source, sourcetype, index.",
  ],
  tables: [
    {
      name: "sysmon",
      desc: "Sysmon operational log (XmlWinEventLog:Microsoft-Windows-Sysmon/Operational). EventCode 1 process create, 3 network, 22 DNS query.",
      columns: [
        dt("_time"),
        s("host"),
        int("EventCode", "1 process create, 3 network connect, 11 file create, 22 DNS query"),
        s("Image", "full path of the process image"),
        s("CommandLine"),
        s("CurrentDirectory"),
        s("User"),
        s("ParentImage", "full path of the parent process"),
        s("ParentCommandLine"),
        int("ProcessId"),
        int("ParentProcessId"),
        s("OriginalFileName"),
        s("Hashes"),
        s("IntegrityLevel"),
        s("DestinationIp"),
        int("DestinationPort"),
        s("DestinationHostname"),
        s("Protocol"),
        s("TargetFilename", "file path for file-create events"),
        s("QueryName", "queried domain for DNS events (EventCode 22)"),
      ],
    },
    {
      name: "WinEventLog:Security",
      desc: "Windows Security event log. EventCode 4688 process create, 4624 logon success, 4625 logon failure.",
      columns: [
        dt("_time"),
        s("host"),
        int("EventCode"),
        s("Account_Name"),
        s("Account_Domain"),
        int("Logon_Type"),
        s("Source_Network_Address", "source IP for logons"),
        s("Workstation_Name"),
        s("Process_Name", "path of the process"),
        s("New_Process_Name", "created process (4688)"),
        s("Creator_Process_Name", "parent process (4688)"),
        s("Process_Command_Line"),
        s("Target_Account"),
      ],
    },
    {
      name: "suricata",
      desc: "Suricata IDS EVE JSON. Discriminate with event_type (alert, dns, http, tls, flow).",
      columns: [
        dt("_time"),
        s("src_ip"),
        s("dest_ip"),
        int("src_port"),
        int("dest_port"),
        s("proto"),
        s("event_type", "alert, dns, http, tls, flow"),
        s("alert.signature", "IDS rule that fired"),
        s("alert.category"),
        s("http.hostname"),
        s("http.url"),
        s("dns.rrname", "queried domain name"),
        s("tls.sni"),
      ],
    },
  ],
};

export const SCHEMA: Record<TargetId, TargetSchema> = {
  sentinel: SENTINEL,
  defender: DEFENDER,
  splunk: SPLUNK,
};

/** All schemas as an array (convenience for tests/iteration). */
export const ALL_SCHEMAS: readonly TargetSchema[] = [SENTINEL, DEFENDER, SPLUNK];

/** The schema for a given target. */
export function getSchema(target: TargetId): TargetSchema {
  return SCHEMA[target];
}

/** All valid table/sourcetype names for a target (lowercased). */
export function tableNames(target: TargetId): Set<string> {
  return new Set(SCHEMA[target].tables.map((t) => t.name.toLowerCase()));
}

/**
 * Union of every valid column across all tables for a target, lowercased.
 * Used by the validator to flag columns that aren't in the catalog.
 */
export function allColumns(target: TargetId): Set<string> {
  const set = new Set<string>();
  for (const table of SCHEMA[target].tables) {
    for (const col of table.columns) set.add(col.name.toLowerCase());
  }
  return set;
}

/** Columns for a single named table (lowercased). Empty set if unknown table. */
export function columnsForTable(target: TargetId, table: string): Set<string> {
  const found = SCHEMA[target].tables.find(
    (t) => t.name.toLowerCase() === table.toLowerCase(),
  );
  return new Set((found?.columns ?? []).map((c) => c.name.toLowerCase()));
}
