"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Cpu,
  Gauge,
  Library,
  Rows3,
  Wheat,
} from "lucide-react";
import { MillMark } from "@/components/mill-mark";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";

const NAV = [
  { href: "/", label: "Floor", icon: Rows3 },
  { href: "/tasks", label: "Intake", icon: Wheat },
  { href: "/memory", label: "Memory", icon: Library },
  { href: "/gate", label: "Gate", icon: Gauge },
  { href: "/hardware", label: "Box", icon: Cpu },
] as const;

export function AppShell({
  children,
  team,
  threshold,
}: {
  children: React.ReactNode;
  team: string;
  threshold: number;
}) {
  const pathname = usePathname();

  return (
    <TooltipProvider>
      <div className="flex min-h-full flex-1">
        <aside className="sticky top-0 hidden h-dvh w-[220px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-4 py-5 md:flex">
          <Link href="/" className="flex items-center gap-2.5 px-1">
            <MillMark className="size-7 text-primary" />
            <div>
              <div className="font-heading text-base font-semibold tracking-tight">
                Grist
              </div>
              <div className="text-[11px] tracking-wide text-muted-foreground uppercase">
                {team} mill
              </div>
            </div>
          </Link>
          <nav className="mt-8 flex flex-1 flex-col gap-1">
            {NAV.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors",
                    active
                      ? "bg-sidebar-accent text-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-3 py-3 text-xs">
            <div className="text-muted-foreground">Gate threshold</div>
            <div className="mt-1 font-medium tabular">
              {Math.round(threshold * 100)}% local confidence
            </div>
            <div className="mt-2 text-[11px] leading-snug text-muted-foreground">
              Calibrated in shadow burn-in. Not a pricing claim.
            </div>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-border px-4 py-3 md:px-8">
            <div className="flex items-center gap-2 md:hidden">
              <MillMark className="size-6 text-primary" />
              <span className="font-semibold">Grist</span>
            </div>
            <p className="hidden text-sm text-muted-foreground md:block">
              Local-first coding agents. Frontier is the exception.
            </p>
            <div className="text-xs text-muted-foreground">
              Sovereignty on. Code stays on the box unless the gate escalates.
            </div>
          </header>
          <nav className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2 md:hidden">
            {NAV.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "rounded-full px-3 py-1 text-sm whitespace-nowrap",
                    active
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}
