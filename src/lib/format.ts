import { assertNever } from "@/lib/never";
import type { GateProvider, MemoryKind, Route, TaskStatus } from "@/lib/types";

export function formatUsd(value: number, digits = 2): string {
  if (Math.abs(value) < 0.005 && value !== 0) {
    return `$${value.toFixed(4)}`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

export function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${Math.round(value * 100)}%`;
}

export function formatMs(value: number): string {
  return `${Math.round(value)} ms`;
}

export function routeLabel(route: Route): string {
  switch (route) {
    case "local_model":
      return "Local";
    case "frontier_escalation":
      return "Frontier";
    case "ask_human":
      return "Ask human";
    default:
      return assertNever(route);
  }
}

export function routeHint(route: Route): string {
  switch (route) {
    case "local_model":
      return "Bonsai 2 27B on this box. Tokens are free after hardware.";
    case "frontier_escalation":
      return "Metered Claude / GPT. Logged, never the default.";
    case "ask_human":
      return "Noul unknown or a judgment the models should not make.";
    default:
      return assertNever(route);
  }
}

export function statusLabel(status: TaskStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "gating":
      return "Gating";
    case "running":
      return "Running";
    case "needs_human":
      return "Needs human";
    case "succeeded":
      return "Succeeded";
    case "failed":
      return "Failed";
    case "dismissed":
      return "Dismissed";
    default:
      return assertNever(status);
  }
}

export function providerLabel(provider: GateProvider): string {
  switch (provider) {
    case "jev":
      return "Jev";
    case "shadow":
      return "Shadow Jev";
    default:
      return assertNever(provider);
  }
}

export function memoryKindLabel(kind: MemoryKind): string {
  switch (kind) {
    case "architecture":
      return "Architecture";
    case "convention":
      return "Convention";
    case "ownership":
      return "Ownership";
    case "gotcha":
      return "Gotcha";
    case "decision":
      return "Decision";
    default:
      return assertNever(kind);
  }
}

export function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function titleFromPrompt(prompt: string): string {
  const line = prompt.trim().split("\n")[0]?.trim() ?? "";
  if (line.length <= 72) return line || "Untitled task";
  return `${line.slice(0, 69).trim()}…`;
}
