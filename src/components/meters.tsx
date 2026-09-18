import { cn } from "@/lib/utils";

export function ConfidenceMeter({
  value,
  threshold,
  label,
}: {
  value: number;
  threshold?: number;
  label?: string;
}) {
  const pct = Math.round(value * 100);
  return (
    <div>
      {label ? (
        <div className="mb-1 flex items-baseline justify-between text-xs">
          <span className="text-muted-foreground">{label}</span>
          <span className="tabular font-medium">{pct}%</span>
        </div>
      ) : null}
      <div className="relative h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            value >= (threshold ?? 0) ? "bg-local" : "bg-frontier",
          )}
          style={{ width: `${pct}%` }}
        />
        {typeof threshold === "number" ? (
          <div
            className="absolute top-0 h-full w-px bg-primary"
            style={{ left: `${Math.round(threshold * 100)}%` }}
            title={`Threshold ${Math.round(threshold * 100)}%`}
          />
        ) : null}
      </div>
    </div>
  );
}

export function SplitBar({
  local,
  frontier,
  human,
}: {
  local: number;
  frontier: number;
  human: number;
}) {
  const total = local + frontier + human;
  if (total === 0) {
    return <div className="h-2.5 rounded-full bg-muted" />;
  }
  return (
    <div className="flex h-2.5 overflow-hidden rounded-full">
      <div className="bg-local" style={{ width: `${(local / total) * 100}%` }} />
      <div
        className="bg-frontier"
        style={{ width: `${(frontier / total) * 100}%` }}
      />
      <div className="bg-human" style={{ width: `${(human / total) * 100}%` }} />
    </div>
  );
}
