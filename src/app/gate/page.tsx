import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ThresholdControls } from "@/components/threshold-controls";
import { RouteBadge } from "@/components/route-badge";
import { getStore } from "@/lib/store";
import { formatPercent } from "@/lib/format";
import { LOCAL_CONFIDENCE_LEVELS, ROUTE_CRITERIA } from "@/lib/gate/primitives";
import type { Route } from "@/lib/types";

export const dynamic = "force-dynamic";

export default function GatePage() {
  const store = getStore();
  const live = Boolean(process.env.TYPESAFE_API_KEY?.trim());
  const labeled = store
    .listTasks()
    .filter((t) => t.gate && t.route)
    .slice(0, 12);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Confidence gate
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Jev makes decisions, not text. Score, Choice, and Noul come back as
          numbers; TypeScript composes the route. Thresholds are calibrated from
          labeled tasks — never guessed into a price list.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Operating thresholds</CardTitle>
            <CardDescription>
              Shadow burn-in writes the labels. You move the cuts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ThresholdControls initial={store.settings} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Evaluator</CardTitle>
            <CardDescription>
              Live Jev key is still pending. Shadow Jev stands in with the same
              primitives so the mill can run today.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              <span className="text-muted-foreground">Provider </span>
              {live ? "Jev (live)" : "Shadow Jev"}
            </p>
            <p>
              <span className="text-muted-foreground">Endpoint </span>
              <span className="font-mono text-xs">api.typesafe.ai/v1/systemone</span>
            </p>
            <p>
              <span className="text-muted-foreground">Model </span>
              jev-latest
            </p>
            <p className="text-muted-foreground">
              Set <code className="font-mono text-foreground">TYPESAFE_API_KEY</code> to
              switch the evaluator to live Jev. Failures fall back to shadow.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Primitives</CardTitle>
          <CardDescription>
            One request, three question types, then software.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div>
            <h3 className="text-sm font-medium">Score — local confidence</h3>
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
              {LOCAL_CONFIDENCE_LEVELS.map((level) => (
                <li key={level}>{level}</li>
              ))}
            </ol>
          </div>
          <div>
            <h3 className="text-sm font-medium">Choice — suggested lane</h3>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {(Object.keys(ROUTE_CRITERIA) as Route[]).map((route) => (
                <li key={route}>
                  <span className="text-foreground">{route.replaceAll("_", " ")}.</span>{" "}
                  {ROUTE_CRITERIA[route]}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-medium">Noul — unknown / stakes</h3>
            <p className="mt-2 text-xs text-muted-foreground">
              Underspecified near 1 asks a human. High-stakes near 1 forces
              frontier even if the local score is strong. Near 0.5 is uncertainty,
              not a medium rating.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Shadow labels</CardTitle>
          <CardDescription>
            Each real task becomes an example: local success, local failure, or
            needed escalation. That table sets the threshold.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="pb-2 font-medium">Task</th>
                <th className="pb-2 font-medium">Score</th>
                <th className="pb-2 font-medium">Route</th>
                <th className="pb-2 font-medium">Label</th>
              </tr>
            </thead>
            <tbody>
              {labeled.map((task) => (
                <tr key={task.id} className="border-t border-border">
                  <td className="py-2 pr-3">{task.title}</td>
                  <td className="py-2 pr-3 tabular">
                    {task.gate ? formatPercent(task.gate.confidence) : "—"}
                  </td>
                  <td className="py-2 pr-3">
                    <RouteBadge route={task.route} />
                  </td>
                  <td className="py-2 text-muted-foreground">
                    {task.outcome?.replaceAll("_", " ") ?? "unlabeled"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
