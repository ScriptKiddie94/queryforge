// Validator — the "don't trust the LLM blindly" layer.
//
// Goal: flag column-position identifiers in the generated query that are NOT in
// the schema catalog for the target. This is a heuristic, not a full parser, so
// it is tuned for HIGH PRECISION (few false positives) over total recall:
//   1. Strip string literals so values aren't scanned as identifiers.
//   2. Extract identifiers only where they sit in genuine column positions
//      (left of a comparison/text operator, or in a project/by/fields list).
//   3. Drop anything that is a known language keyword/function/operator.
//   4. Whatever identifier remains and isn't in the catalog is flagged.

import { allColumns, tableNames } from "./schema";
import type { TargetId } from "./targets";
import type { ValidationResult } from "./types";

// KQL keywords, operators, and common functions — never treated as columns.
const KQL_RESERVED = new Set<string>([
  // operators / clauses
  "where", "project", "project-away", "project-keep", "project-rename",
  "project-reorder", "extend", "summarize", "join", "union", "order", "sort",
  "by", "on", "asc", "desc", "take", "limit", "top", "distinct", "count",
  "mv-expand", "mvexpand", "mv-apply", "parse", "parse-where", "evaluate",
  "render", "let", "print", "datatable", "range", "materialize", "invoke",
  "lookup", "partition", "make-series", "serialize", "as", "kind", "hint",
  "with", "step", "from", "to", "in", "has", "hasprefix", "hassuffix",
  "contains", "startswith", "endswith", "matches", "regex", "between", "and",
  "or", "not", "has_any", "has_all", "has_cs", "contains_cs", "in~", "!in",
  "notcontains", "nothas",
  // functions
  "ago", "now", "datetime", "timespan", "bin", "floor", "startofday",
  "endofday", "startofmonth", "dcount", "dcountif", "countif", "sumif", "sum",
  "avg", "min", "max", "make_set", "make_list", "make_bag", "arg_max",
  "arg_min", "percentile", "percentiles", "stdev", "variance", "tostring",
  "toint", "tolong", "todouble", "toreal", "todatetime", "totimespan",
  "tobool", "todynamic", "parse_json", "parse_xml", "strlen", "substring",
  "split", "strcat", "strcat_delim", "replace", "replace_string",
  "replace_regex", "extract", "extract_all", "trim", "trim_start", "trim_end",
  "indexof", "countof", "array_length", "array_index_of", "set_has_element",
  "iff", "iif", "case", "coalesce", "isnull", "isnotnull", "isempty",
  "isnotempty", "isnan", "tolower", "toupper", "hash", "hash_sha256",
  "ipv4_is_in_range", "ipv4_is_private", "ipv4_is_match", "ipv4_compare",
  "geo_info_from_ip_address", "format_datetime", "datetime_diff", "dayofweek",
  "hourofday", "getmonth", "getyear", "bin_at", "prev", "next", "row_number",
  "rank", "pack", "pack_array", "zip", "series_stats", "column_ifexists",
  // literal-ish types / keywords
  "true", "false", "null", "real", "long", "int", "string", "bool", "dynamic",
  "datetime_utc", "d", "h", "m", "s", "ms",
]);

// SPL commands, functions, and directives — never treated as fields.
const SPL_RESERVED = new Set<string>([
  // commands
  "search", "where", "eval", "stats", "tstats", "eventstats", "streamstats",
  "timechart", "chart", "table", "fields", "dedup", "sort", "head", "tail",
  "top", "rare", "rex", "regex", "lookup", "inputlookup", "outputlookup",
  "join", "append", "appendcols", "appendpipe", "transaction", "bin", "bucket",
  "fillnull", "filldown", "makeresults", "mvexpand", "mvcombine", "spath",
  "xmlkv", "kv", "extract", "rename", "convert", "fieldformat", "addinfo",
  "addtotals", "untable", "xyseries", "foreach", "map", "return", "format",
  "collect", "tags", "eventcount", "metadata", "typeof", "cluster",
  // clause words
  "by", "as", "output", "outputnew", "over", "span", "limit", "usetime",
  "earliest", "latest", "startdaysago", "in", "case", "if",
  // functions
  "count", "dc", "distinct_count", "sum", "avg", "mean", "median", "mode",
  "min", "max", "range", "stdev", "stdevp", "var", "values", "list", "first",
  "last", "earliest_time", "latest_time", "per_day", "per_hour", "perc",
  "percentile", "estdc", "coalesce", "match", "like", "cidrmatch", "searchmatch",
  "tostring", "tonumber", "lower", "upper", "substr", "len", "ltrim", "rtrim",
  "trim", "replace", "split", "mvcount", "mvindex", "mvjoin", "mvfilter",
  "mvdedup", "mvappend", "isnull", "isnotnull", "isnum", "isstr", "isbool",
  "validate", "round", "ceiling", "floor", "abs", "exact", "pow", "sqrt",
  "now", "relative_time", "strftime", "strptime", "printf", "urldecode", "md5",
  "sha256", "spath", "nullif", "true", "false", "null", "and", "or", "not",
  "xor", "term", "prestats",
  // meta directives / meta fields treated as always-valid
  "index", "sourcetype", "source", "host", "punct", "linecount",
  "splunk_server", "timestartpos", "timeendpos", "eventtype", "_time", "_raw",
]);

// SPL meta fields that are always legitimate even if not in a sourcetype catalog.
const SPL_META_FIELDS = new Set<string>([
  "_time", "_raw", "host", "source", "sourcetype", "index", "punct",
  "linecount", "splunk_server",
]);

/** Remove single- and double-quoted string literals so values aren't scanned. */
function stripStrings(query: string): string {
  return query
    .replace(/"(?:[^"\\]|\\.)*"/g, " ")
    .replace(/'(?:[^'\\]|\\.)*'/g, " ");
}

const IDENT = "[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*";

/**
 * Pull identifiers that sit in a genuine column position for the given dialect.
 * Exported for testing.
 */
export function extractColumnCandidates(query: string, target: TargetId): string[] {
  const q = stripStrings(query);
  const out: string[] = [];

  if (target === "splunk") {
    // field <op> value  (SPL uses single '=' for matches; eval uses ==, etc.)
    const opRe = new RegExp(`(${IDENT})\\s*(?:==|!=|<=|>=|=|<|>)`, "g");
    for (const m of q.matchAll(opRe)) out.push(m[1]);
    // by / fields / table <field, field, ...>
    const listRe = /\b(?:by|fields|table)\s+([A-Za-z_][A-Za-z0-9_.,\s+*-]*)/gi;
    for (const m of q.matchAll(listRe)) out.push(...splitList(m[1]));
  } else {
    // KQL: col <op> ...   (== =~ != <> >= <= > < and word operators)
    const symRe = new RegExp(`(${IDENT})\\s*(?:==|=~|!=|<>|>=|<=|>|<)`, "g");
    for (const m of q.matchAll(symRe)) out.push(m[1]);
    const wordOps =
      "contains_cs|contains|has_any|has_all|has_cs|hasprefix|hassuffix|has|" +
      "startswith|endswith|matches\\s+regex|in~|!in|in|between|nothas|notcontains";
    const wordRe = new RegExp(`(${IDENT})\\s+(?:${wordOps})\\b`, "gi");
    for (const m of q.matchAll(wordRe)) out.push(m[1]);
    // project / distinct / by / on <col, col, ...>
    const listRe =
      /\b(?:project(?:-keep|-away|-reorder)?|distinct|by|on)\s+([A-Za-z_][A-Za-z0-9_.,\s]*)/gi;
    for (const m of q.matchAll(listRe)) out.push(...splitList(m[1]));
  }

  return out;
}

function splitList(segment: string): string[] {
  return segment
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter((x) => /^[A-Za-z_][A-Za-z0-9_.]*$/.test(x));
}

/**
 * Identifiers the query itself defines (aggregation/computed aliases). These are
 * legitimate downstream even though they aren't catalog columns, so the validator
 * must not flag them. Exported for testing.
 *   KQL: `Alias = ...` in extend/project/summarize (single '=', not '==' or '=~').
 *   SPL: `... as Alias`, and `eval Alias = ...`.
 */
export function collectAliases(query: string, target: TargetId): Set<string> {
  const q = stripStrings(query);
  const aliases = new Set<string>();
  if (target === "splunk") {
    for (const m of q.matchAll(/\bas\s+([A-Za-z_]\w*)/gi)) aliases.add(m[1].toLowerCase());
    for (const m of q.matchAll(/\beval\s+([A-Za-z_]\w*)\s*=(?![=~])/gi))
      aliases.add(m[1].toLowerCase());
  } else {
    // Single '=' (excluding '==' and '=~') marks an alias definition in KQL.
    for (const m of q.matchAll(/([A-Za-z_]\w*)\s*=(?![=~])/g)) aliases.add(m[1].toLowerCase());
  }
  return aliases;
}

/**
 * Validate a generated query against the catalog for its target.
 * @param table optional declared table; if provided, checks it exists.
 */
export function validateQuery(
  query: string,
  target: TargetId,
  table?: string,
): ValidationResult {
  const reserved = target === "splunk" ? SPL_RESERVED : KQL_RESERVED;
  const catalog = allColumns(target);
  const tables = tableNames(target);
  const aliases = collectAliases(query, target);

  const seen = new Set<string>();
  const unknown: string[] = [];

  for (const raw of extractColumnCandidates(query, target)) {
    const lc = raw.toLowerCase();
    if (seen.has(lc)) continue;
    seen.add(lc);

    if (reserved.has(lc)) continue;
    if (tables.has(lc)) continue; // a table/sourcetype name isn't a bad column
    if (aliases.has(lc)) continue; // query-defined computed alias
    if (target === "splunk" && SPL_META_FIELDS.has(lc)) continue;
    if (catalog.has(lc)) continue;

    unknown.push(raw);
  }

  const unknownTable =
    table != null && table.trim() !== "" && !tables.has(table.toLowerCase());

  return {
    ok: unknown.length === 0 && !unknownTable,
    unknownColumns: unknown,
    unknownTable,
  };
}
