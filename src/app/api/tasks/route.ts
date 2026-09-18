import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ tasks: getStore().listTasks() });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { prompt?: string };
    const prompt = body.prompt?.trim() ?? "";
    if (!prompt) {
      return NextResponse.json({ error: "Describe the task first." }, { status: 400 });
    }
    const task = await getStore().submitTask(prompt);
    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not submit task.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
