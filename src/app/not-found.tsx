import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="font-heading text-2xl font-semibold">No such task</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        It may have been from a previous mill process. Submit it again from intake.
      </p>
      <Link href="/tasks" className={cn(buttonVariants(), "mt-6 inline-flex")}>
        Back to intake
      </Link>
    </div>
  );
}
