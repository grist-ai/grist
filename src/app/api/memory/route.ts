import { NextResponse } from "next/server";
import { BOOTSTRAP_STEPS, MEMORY_CATALOG, TEAM_NAME } from "@/lib/memory/catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    team: TEAM_NAME,
    catalog: MEMORY_CATALOG,
    bootstrap: BOOTSTRAP_STEPS,
  });
}
