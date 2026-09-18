import Link from "next/link";
import { formatWhen } from "@/lib/format";
import { RouteBadge, StatusBadge } from "@/components/route-badge";
import type { Task } from "@/lib/types";

export function TaskList({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
        <p className="font-medium">No tasks this shift</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Submit one on Intake. The gate fires before any model.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
      {tasks.map((task) => (
        <li key={task.id}>
          <Link
            href={`/tasks/${task.id}`}
            className="flex flex-col gap-2 px-4 py-3 hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="truncate font-medium">{task.title}</div>
              <div className="text-xs text-muted-foreground">{formatWhen(task.createdAt)}</div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <RouteBadge route={task.route} />
              <StatusBadge status={task.status} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
