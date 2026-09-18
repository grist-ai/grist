import { assertNever } from "@/lib/never";
import { routeLabel, statusLabel } from "@/lib/format";
import type { Route, TaskStatus } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function RouteBadge({ route }: { route: Route | null }) {
  if (!route) {
    return <Badge variant="outline">Ungated</Badge>;
  }
  return (
    <Badge variant="outline" className={cn("border-transparent", routeTone(route))}>
      {routeLabel(route)}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  const tone =
    status === "needs_human"
      ? "bg-human/15 text-human"
      : status === "succeeded"
        ? "bg-local/15 text-local"
        : status === "failed"
          ? "bg-destructive/15 text-destructive"
          : "bg-muted text-muted-foreground";
  return (
    <Badge variant="outline" className={cn("border-transparent", tone)}>
      {statusLabel(status)}
    </Badge>
  );
}

function routeTone(route: Route): string {
  switch (route) {
    case "local_model":
      return "bg-local/15 text-local";
    case "frontier_escalation":
      return "bg-frontier/15 text-frontier";
    case "ask_human":
      return "bg-human/15 text-human";
    default:
      return assertNever(route);
  }
}
