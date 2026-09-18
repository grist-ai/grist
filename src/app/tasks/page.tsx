import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TaskForm } from "@/components/task-form";
import { TaskList } from "@/components/task-list";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function IntakePage() {
  const tasks = getStore().listTasks();

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Intake
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Chat, IDE, or CLI — they all hit the same gate. This is the mill&apos;s
          front hopper.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>New task</CardTitle>
          <CardDescription>
            File paths and acceptance criteria keep work local. Vague prompts
            become a human ticket, not a frontier bill.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TaskForm />
        </CardContent>
      </Card>
      <div className="space-y-3">
        <h2 className="font-heading text-lg font-medium">Shift log</h2>
        <TaskList tasks={tasks} />
      </div>
    </div>
  );
}
