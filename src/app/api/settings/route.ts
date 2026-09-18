import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = getStore();
  return NextResponse.json({
    settings: store.settings,
    appliance: store.appliance,
    liveJevConfigured: Boolean(process.env.TYPESAFE_API_KEY?.trim()),
  });
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as {
    confidenceThreshold?: number;
    unknownThreshold?: number;
    highStakesThreshold?: number;
    preferLiveJev?: boolean;
  };
  const patch: {
    confidenceThreshold?: number;
    unknownThreshold?: number;
    highStakesThreshold?: number;
    preferLiveJev?: boolean;
  } = {};
  if (typeof body.confidenceThreshold === "number") {
    patch.confidenceThreshold = clamp01(body.confidenceThreshold);
  }
  if (typeof body.unknownThreshold === "number") {
    patch.unknownThreshold = clamp01(body.unknownThreshold);
  }
  if (typeof body.highStakesThreshold === "number") {
    patch.highStakesThreshold = clamp01(body.highStakesThreshold);
  }
  if (typeof body.preferLiveJev === "boolean") {
    patch.preferLiveJev = body.preferLiveJev;
  }
  const settings = getStore().updateSettings(patch);
  return NextResponse.json({ settings });
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
