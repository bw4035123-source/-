import { NextResponse } from "next/server";
import { serverConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok", lawApi: serverConfig.lawApiOc ? "live" : "mock", llm: serverConfig.llm.defaultProvider, time: new Date().toISOString() });
}
