import type { GateDecision, MemorySnippet } from "@/lib/types";
import { formatMs, formatPercent, formatUsd, memoryKindLabel, providerLabel } from "@/lib/format";
import { ConfidenceMeter } from "@/components/meters";
import { RouteBadge } from "@/components/route-badge";
import { Badge } from "@/components/ui/badge";

export function GateTrace({
  decision,
  threshold,
}: {
  decision: GateDecision;
  threshold: number;
}) {
  const answers = [
    {
      id: "Score",
      name: "Local confidence",
      value: formatPercent(decision.confidence),
      detail: `Weighted score ${decision.answers.localConfidence.score.toFixed(2)} / 4`,
    },
    {
      id: "Noul",
      name: "High stakes",
      value: formatPercent(decision.highStakes),
      detail: "Wrong change → security, money, or production",
    },
    {
      id: "Noul",
      name: "Underspecified",
      value: formatPercent(decision.underspecified),
      detail: "Unknown → ask a human. Jev does not write summaries.",
    },
    {
      id: "Choice",
      name: "Suggested lane",
      value: decision.choice.replaceAll("_", " "),
      detail: `Choice confidence ${formatPercent(decision.choiceConfidence)} — code still composes the route.`,
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <RouteBadge route={decision.route} />
        <Badge variant="outline">{providerLabel(decision.provider)}</Badge>
        <span className="text-xs text-muted-foreground">
          {decision.model} · {formatMs(decision.latencyMs)} · gate {formatUsd(decision.usage.costUsd, 4)}
        </span>
      </div>
      <ConfidenceMeter
        value={decision.confidence}
        threshold={threshold}
        label="Effective local confidence vs threshold"
      />
      <ul className="grid gap-3 sm:grid-cols-2">
        {answers.map((row) => (
          <li key={row.name} className="rounded-lg border border-border px-3 py-2.5">
            <div className="text-[11px] tracking-wide text-muted-foreground uppercase">
              {row.id}
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="text-sm">{row.name}</span>
              <span className="tabular text-sm font-medium">{row.value}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{row.detail}</p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Reasons: {decision.reasons.join(", ") || "none"}
      </p>
    </div>
  );
}

export function MemoryHits({ snippets }: { snippets: MemorySnippet[] }) {
  if (snippets.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No memory hits. The agent will lean on generic conventions only.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {snippets.map((snippet) => (
        <li key={snippet.id} className="rounded-lg border border-border px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{memoryKindLabel(snippet.kind)}</Badge>
            {snippet.path ? (
              <span className="font-mono text-xs text-muted-foreground">{snippet.path}</span>
            ) : null}
            {snippet.owner ? (
              <span className="text-xs text-muted-foreground">{snippet.owner}</span>
            ) : null}
          </div>
          <div className="mt-1 text-sm font-medium">{snippet.title}</div>
          <p className="mt-1 text-sm text-muted-foreground">{snippet.body}</p>
        </li>
      ))}
    </ul>
  );
}
