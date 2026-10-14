import { NextResponse } from "next/server";
import { serverConfig } from "@/lib/config";
import { listProviders } from "@/lib/llm/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 사용 가능한 LLM 공급자 목록(키 값은 절대 반환하지 않음) */
export async function GET() {
  const providers = await listProviders(serverConfig.llm);
  return NextResponse.json({ providers, lawApi: serverConfig.lawApiOc ? "live" : "mock" });
}
