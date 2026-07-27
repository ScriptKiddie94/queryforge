// Target definitions and example intents — shared UI constants.
// Per-target accent hues match the sigma-to-kql suite exactly.

export type TargetId = "sentinel" | "defender" | "splunk";

export interface TargetDef {
  id: TargetId;
  label: string;
  /** Query language shown in the card's lang tag. */
  lang: "KQL" | "SPL";
  /** Accent color used for the card stripe, dot, and toggle highlight. */
  hue: string;
}

export const TARGETS: readonly TargetDef[] = [
  { id: "sentinel", label: "Microsoft Sentinel", lang: "KQL", hue: "#58a6ff" },
  { id: "defender", label: "Defender XDR", lang: "KQL", hue: "#a371f7" },
  { id: "splunk", label: "Splunk", lang: "SPL", hue: "#7ee787" },
] as const;

export const TARGET_BY_ID: Record<TargetId, TargetDef> = Object.fromEntries(
  TARGETS.map((t) => [t.id, t]),
) as Record<TargetId, TargetDef>;

export interface ExampleIntent {
  id: string;
  label: string;
  /** The natural-language hunting intent placed into the input. */
  intent: string;
}

export const EXAMPLE_INTENTS: readonly ExampleIntent[] = [
  {
    id: "encoded-ps",
    label: "PowerShell from Office w/ encoded command",
    intent:
      "Find PowerShell processes spawned from an Office application (Word, Excel, Outlook) that use an encoded command, in the last 24 hours.",
  },
  {
    id: "failed-then-success",
    label: "Failed logins then a success from same IP",
    intent:
      "Show accounts with multiple failed sign-ins followed by a successful sign-in from the same source IP within a short window.",
  },
  {
    id: "new-domain",
    label: "Process connecting to a newly registered domain",
    intent:
      "Find processes making outbound network connections to newly registered or rarely seen domains.",
  },
  {
    id: "psexec",
    label: "PsExec-style lateral movement",
    intent:
      "Detect PsExec-style lateral movement: a service being created and executed remotely, such as PSEXESVC running as SYSTEM.",
  },
] as const;
