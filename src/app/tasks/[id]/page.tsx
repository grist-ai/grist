import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GateTrace, MemoryHits } from "@/components/gate-trace";
import { HumanActions } from "@/components/human-actions";
import { RouteBadge, StatusBadge } from "@/components/route-badge";
import { getStore } from "@/lib/store";
import {
  formatTokens,
  formatUsd,
  formatWhen,
  routeHint,
} from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const store = getStore();
  const task = store.getTask(id);
  if (!task) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/tasks" className="text-xs text-muted-foreground hover:text-foreground">
          ← Intake
        </Link>
        <h1 className="font-heading mt-2 text-2xl font-semibold tracking-tight">
          {task.title}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <RouteBadge route={task.route} />
          <StatusBadge status={task.status} />
          <span className="text-xs text-muted-foreground">
            {formatWhen(task.createdAt)}
          </span>
        </div>
        {task.route ? (
          <p className="mt-2 text-sm text-muted-foreground">{routeHint(task.route)}</p>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Task</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
            {task.prompt}
          </pre>
        </CardContent>
      </Card>

      {task.status === "needs_human" ? (
        <Card>
          <CardHeader>
            <CardTitle>Ask human</CardTitle>
            <CardDescription>
              Noul unknown. Deterministic rules stay in code; this is a judgment.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HumanActions taskId={task.id} />
          </CardContent>
        </Card>
      ) : null}

      {task.gate ? (
        <Card>
          <CardHeader>
            <CardTitle>Jev trace</CardTitle>
            <CardDescription>
              Score, Choice, Noul — then code composes the route. Jev never writes
              the patch.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <GateTrace
              decision={task.gate}
              threshold={store.settings.confidenceThreshold}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Retrieved memory</CardTitle>
          <CardDescription>
            Institutional knowledge as retrieval, not re-explained every session.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MemoryHits snippets={task.retrieved} />
        </CardContent>
      </Card>

      {task.result ? (
        <Card>
          <CardHeader>
            <CardTitle>Agent pass</CardTitle>
            <CardDescription>{task.result.summary}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="space-y-2">
              {task.result.steps.map((step) => (
                <li key={`${step.at}-${step.label}`} className="text-sm">
                  <span className="font-medium">{step.label}</span>
                  <span className="text-muted-foreground"> — {step.detail}</span>
                </li>
              ))}
            </ol>
            {task.result.patch ? (
              <pre className="overflow-x-auto rounded-lg bg-muted/50 p-3 font-mono text-xs leading-relaxed">
                {task.result.patch}
              </pre>
            ) : null}
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              {task.result.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Spend log</CardTitle>
          <CardDescription>
            Local tokens are free after hardware. Frontier is the bill. Gate cost is
            rounding error.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <SpendRow
            label="Gate"
            tokens={task.tokens.gate.inputTokens + task.tokens.gate.outputTokens}
            usd={task.tokens.gate.costUsd}
          />
          <SpendRow
            label="Local"
            tokens={task.tokens.local.inputTokens + task.tokens.local.outputTokens}
            usd={task.tokens.local.costUsd}
          />
          <SpendRow
            label="Frontier"
            tokens={
              task.tokens.frontier.inputTokens + task.tokens.frontier.outputTokens
            }
            usd={task.tokens.frontier.costUsd}
          />
          <SpendRow
            label="All-frontier counterfactual"
            tokens={null}
            usd={task.counterfactualFrontierUsd}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function SpendRow({
  label,
  tokens,
  usd,
}: {
  label: string;
  tokens: number | null;
  usd: number;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-lg border border-border px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular">
        {tokens !== null ? `${formatTokens(tokens)} · ` : null}
        {formatUsd(usd, usd < 0.01 ? 4 : 2)}
      </span>
    </div>
  );
}
