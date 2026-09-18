"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function HumanActions({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  async function resolve(action: "local" | "frontier" | "dismiss") {
    setError(null);
    setPending(action);
    try {
      const response = await fetch(`/api/tasks/${taskId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(json.error ?? "Could not apply that decision.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        The mill will not invent a goal. Send it local, escalate, or dismiss.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => resolve("local")}
          disabled={Boolean(pending)}
        >
          {pending === "local" ? "Routing…" : "Run local"}
        </Button>
        <Button
          variant="secondary"
          onClick={() => resolve("frontier")}
          disabled={Boolean(pending)}
        >
          {pending === "frontier" ? "Escalating…" : "Escalate to frontier"}
        </Button>
        <Button
          variant="ghost"
          onClick={() => resolve("dismiss")}
          disabled={Boolean(pending)}
        >
          Dismiss
        </Button>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Still waiting</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
