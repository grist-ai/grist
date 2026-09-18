"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import type { GateSettings } from "@/lib/types";
import { formatPercent } from "@/lib/format";

export function ThresholdControls({ initial }: { initial: GateSettings }) {
  const router = useRouter();
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function persist(next: GateSettings) {
    setSettings(next);
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!response.ok) {
        setError("Could not save thresholds.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <ThresholdSlider
        label="Local confidence"
        hint="Score ≥ this value stays on Bonsai. Below it, escalate."
        value={settings.confidenceThreshold}
        onCommit={(confidenceThreshold) =>
          persist({ ...settings, confidenceThreshold })
        }
      />
      <ThresholdSlider
        label="Unknown (Noul)"
        hint="Underspecified ≥ this value asks a human. Jev never writes the missing spec."
        value={settings.unknownThreshold}
        onCommit={(unknownThreshold) => persist({ ...settings, unknownThreshold })}
      />
      <ThresholdSlider
        label="High stakes"
        hint="Security, money, migrations, production. High-stakes work leaves the box."
        value={settings.highStakesThreshold}
        onCommit={(highStakesThreshold) =>
          persist({ ...settings, highStakesThreshold })
        }
      />
      <p className="text-xs text-muted-foreground">
        {saving ? "Saving…" : error ?? "Thresholds apply to the next task. Seed history is unchanged."}
      </p>
    </div>
  );
}

function ThresholdSlider({
  label,
  hint,
  value,
  onCommit,
}: {
  label: string;
  hint: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value;

  function readValue(next: number | readonly number[]): number | null {
    const n = Array.isArray(next) ? next[0] : next;
    return typeof n === "number" ? n / 100 : null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-sm font-medium">{label}</div>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <div className="tabular text-sm font-medium">{formatPercent(shown)}</div>
      </div>
      <Slider
        min={0}
        max={100}
        value={[Math.round(shown * 100)]}
        onValueChange={(next) => {
          const parsed = readValue(next);
          if (parsed !== null) setDraft(parsed);
        }}
        onValueCommitted={(next) => {
          const parsed = readValue(next);
          setDraft(null);
          if (parsed !== null) onCommit(parsed);
        }}
      />
    </div>
  );
}
