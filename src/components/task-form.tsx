"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SAMPLE_PROMPTS } from "@/lib/samples";

export function TaskForm() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!prompt.trim()) {
      setError("Describe the task. The gate will not guess the goal.");
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const json = (await response.json()) as { task?: { id: string }; error?: string };
      if (!response.ok || !json.task) {
        setError(json.error ?? "Could not submit the task.");
        return;
      }
      router.push(`/tasks/${json.task.id}`);
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder="What should the mill do? File paths and success criteria keep work local."
        className="min-h-32 bg-background"
        disabled={pending}
      />
      <div className="flex flex-wrap gap-1.5">
        {SAMPLE_PROMPTS.map((sample) => (
          <button
            key={sample.label}
            type="button"
            className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setPrompt(sample.prompt)}
          >
            Try {sample.label}
          </button>
        ))}
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Not submitted</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Every task hits Jev before any coding model. Local is the default; frontier is metered.
        </p>
        <Button type="submit" disabled={pending}>
          {pending ? "Gating…" : "Run the gate"}
        </Button>
      </div>
    </form>
  );
}
