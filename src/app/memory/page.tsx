import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BOOTSTRAP_STEPS, MEMORY_CATALOG, SNAPSHOT_SHA, TEAM_NAME } from "@/lib/memory/catalog";
import { memoryKindLabel } from "@/lib/format";
import { assertNever } from "@/lib/never";

export const dynamic = "force-dynamic";

export default function MemoryPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {TEAM_NAME} memory
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Seeded from the overnight bootstrap: snapshot {SNAPSHOT_SHA}, 18 months
          of git, review threads ranked by discussion depth. Self-adapting means
          richer retrieval — not weight updates.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bootstrap pipeline</CardTitle>
          <CardDescription>
            One overnight job. Resumable, idempotent. Distillation is the only
            step that spends frontier tokens.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-3 md:grid-cols-2">
            {BOOTSTRAP_STEPS.map((step, index) => (
              <li key={step.id} className="rounded-lg border border-border px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {index + 1}. {step.title}
                  </span>
                  <BootstrapBadge status={step.status} />
                </div>
                <p className="mt-1 text-sm">{step.detail}</p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {MEMORY_CATALOG.map((record) => (
          <Card key={record.id} size="sm">
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{memoryKindLabel(record.kind)}</Badge>
                {record.path ? (
                  <span className="font-mono text-xs text-muted-foreground">
                    {record.path}
                  </span>
                ) : null}
                {record.owner ? (
                  <span className="text-xs text-muted-foreground">{record.owner}</span>
                ) : null}
              </div>
              <CardTitle>{record.title}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {record.body}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function BootstrapBadge({ status }: { status: "done" | "running" | "pending" }) {
  switch (status) {
                case "done":
      return (
        <Badge variant="outline" className="border-transparent bg-local/15 text-local">
          Done
        </Badge>
      );
    case "running":
      return (
        <Badge variant="outline" className="border-transparent bg-primary/15 text-primary">
          Running
        </Badge>
      );
    case "pending":
      return <Badge variant="outline">Pending</Badge>;
    default:
      return assertNever(status);
  }
}
