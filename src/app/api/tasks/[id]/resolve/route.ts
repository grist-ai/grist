import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const body = (await request.json()) as { action?: string };
    const action = body.action;
    if (action !== "local" && action !== "frontier" && action !== "dismiss") {
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
    const task = await getStore().resolveHuman(id, action);
    return NextResponse.json({ task });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not resolve task.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
