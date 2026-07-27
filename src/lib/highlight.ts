// Minimal KQL/SPL syntax highlighter — same approach as sigma-to-kql: escape
// first, then wrap tokens in spans. Because we HTML-escape the query before
// injecting any markup, the model's output can't inject HTML (no XSS).

const KEYWORDS = [
  // KQL
  "where", "project", "project-away", "project-keep", "extend", "summarize",
  "join", "union", "order", "sort", "by", "on", "asc", "desc", "take", "limit",
  "top", "distinct", "count", "has_any", "has_all", "has_cs", "has", "contains",
  "startswith", "endswith", "matches", "regex", "in~", "in", "between", "and",
  "or", "not", "ago", "bin", "datetime", "todatetime", "tostring", "toint",
  "iff", "case", "isnotempty", "isempty", "ipv4_is_in_range",
  // SPL
  "sourcetype", "source", "index", "search", "eval", "stats", "tstats",
  "eventstats", "streamstats", "timechart", "chart", "table", "fields",
  "dedup", "rex", "lookup", "rename", "as", "cidrmatch", "match",
];

// Longest-first so multi-word/underscore keywords win over their prefixes.
const KW_RE = new RegExp(
  `\\b(${KEYWORDS.sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/[-]/g, "\\-"))
    .join("|")})\\b`,
  "gi",
);

export function highlight(query: string): string {
  const esc = query
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return esc
    .replace(/("(?:[^"\\]|\\.)*")/g, '<span class="tok-str">$1</span>')
    .replace(KW_RE, '<span class="tok-kw">$1</span>')
    .replace(/(\|)/g, '<span class="tok-pipe">$1</span>');
}
