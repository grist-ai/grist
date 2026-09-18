import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SplitBar } from "@/components/meters";
import { TaskList } from "@/components/task-list";
import { getStore } from "@/lib/store";
import {
  formatMs,
  formatPercent,
  formatTokens,
  formatUsd,
} from "@/lib/format";

export const dynamic = "force-dynamic";

export default function FloorPage() {
  const store = getStore();
  const metrics = store.metrics();
  const tasks = store.listTasks();
  const waiting = tasks.filter((t) => t.status === "needs_human");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Mill floor
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Token spend and gate precision, measured from day one. The 70% local
          split is a hypothesis until this log says otherwise.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Local share"
          value={formatPercent(metrics.localShare)}
          hint={`${metrics.localCount} of ${metrics.taskCount} routed tasks`}
        />
        <Stat
          label="Spend (this mill)"
          value={formatUsd(metrics.spendUsd)}
          hint={`${formatUsd(metrics.savedUsd)} vs all-frontier counterfactual`}
        />
        <Stat
          label="Gate latency p50"
          value={metrics.gateLatencyMsP50 ? formatMs(metrics.gateLatencyMsP50) : "—"}
          hint="Budget 70–500 ms per Jev call"
        />
        <Stat
          label="Waiting on a human"
          value={String(waiting.length)}
          hint="Noul unknown. No model until you decide."
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lane split</CardTitle>
          <CardDescription>
            Local stays on Bonsai 2 27B. Frontier is metered. Human is a queue,
            not a summary.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <SplitBar
            local={metrics.localCount}
            frontier={metrics.frontierCount}
            human={metrics.humanCount}
          />
          <div className="flex flex-wrap gap-4 text-xs">
            <Legend color="bg-local" label={`Local ${metrics.localCount}`} />
            <Legend color="bg-frontier" label={`Frontier ${metrics.frontierCount}`} />
            <Legend color="bg-human" label={`Ask human ${metrics.humanCount}`} />
          </div>
          <div className="grid gap-3 pt-2 text-sm sm:grid-cols-3">
            <p>
              <span className="text-muted-foreground">Local tokens </span>
              <span className="tabular">{formatTokens(metrics.localTokens)}</span>
              <span className="text-muted-foreground"> · $0</span>
            </p>
            <p>
              <span className="text-muted-foreground">Frontier tokens </span>
              <span className="tabular">{formatTokens(metrics.frontierTokens)}</span>
            </p>
            <p>
              <span className="text-muted-foreground">Gate tokens </span>
              <span className="tabular">{formatTokens(metrics.gateTokens)}</span>
            </p>
          </div>
        </CardContent>
      </Card>

      {waiting.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Human queue</CardTitle>
            <CardDescription>
              Twelve things the mill could not resolve. Five minutes of your time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TaskList tasks={waiting} />
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-3">
        <div className="flex items-end justify-between">
          <h2 className="font-heading text-lg font-medium">Recent tasks</h2>
          <Link href="/tasks" className="text-sm text-primary hover:underline">
            Open intake
          </Link>
        </div>
        <TaskList tasks={tasks.slice(0, 8)} />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="tabular text-2xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">{hint}</CardContent>
    </Card>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}
