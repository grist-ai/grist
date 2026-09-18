import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const task = getStore().getTask(id);
  if (!task) {
    return NextResponse.json({ error: "Unknown task." }, { status: 404 });
  }
  return NextResponse.json({ task });
}
