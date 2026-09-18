import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { getStore } from "@/lib/store";
import { formatTokens } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function HardwarePage() {
  const store = getStore();
  const box = store.appliance;
  const localRunning = store
    .listTasks()
    .filter((t) => t.route === "local_model" && t.status === "running").length;
  const occupied = Math.min(box.slots, localRunning);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          The box
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Pilots ship as a pre-configured appliance. This slice instruments the
          mill before llama.cpp is attached — Phase 2 of the build order.
        </p>
      </div>

      <Alert>
        <AlertTitle>Inference server not attached</AlertTitle>
        <AlertDescription>
          Bonsai 2 27B via llama.cpp is the locked local model. This console
          shadows the agent loop so the gate, spend log, and memory layer can run
          without a 5.9 GB weight file on the workstation. Connect the server and
          the same routes fire for real.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{box.name}</CardTitle>
            <CardDescription>{box.hardware}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Tier" value={box.tier} />
            <Row label="Unified / GPU memory" value={`${box.memoryGb} GB`} />
            <Row label="Model" value={`${box.model} · ${box.modelSizeGb} GB`} />
            <Row label="Inference" value={box.inference} />
            <Row
              label="Slots"
              value={`${occupied} busy / ${box.slots} configured`}
            />
            <div className="pt-1">
              {box.connected ? (
                <Badge className="bg-local/15 text-local">Connected</Badge>
              ) : (
                <Badge variant="outline">Shadow appliance</Badge>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Concurrency math</CardTitle>
            <CardDescription>
              Parallel slots split total throughput. Agentic coding is bursty —
              size RAM for sandbox test runs, not the 25 tok/s headline.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>~25 tok/s ÷ 4 slots ≈ 6 tok/s each at ~32K context on 24GB.</p>
            <p>On 16GB machines cap per-slot context at 16K.</p>
            <p>
              Used RTX 3090 (24GB) is the Linux value play. Do not buy a 5090 for
              a 5.9 GB ternary model.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Slot board</CardTitle>
          <CardDescription>
            Local tasks occupy a slot. Escalated work is load this box never sees.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: box.slots }, (_, i) => {
            const busy = i < occupied;
            return (
              <div key={i} className="rounded-lg border border-border px-3 py-3">
                <div className="text-xs text-muted-foreground">Slot {i + 1}</div>
                <div className="mt-1 text-sm font-medium">
                  {busy ? "Local loop" : "Idle"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {busy
                    ? `${formatTokens(12_000)} ctx reserved`
                    : "Ready for a high-confidence task"}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
