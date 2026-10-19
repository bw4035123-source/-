/**
 * /api/* 요청을 브라우저 안에서 처리 — 앱의 실제 API 처리기(app/api/…/route.ts)를 그대로 실행한다.
 * 서버·인증키가 없으므로 법령은 내장 공식 원문, 답변은 규칙기반 엔진, 판례는 '실시간 연결 필요' 안내.
 */
import * as ask from "@/app/api/ask/route";
import * as analyze from "@/app/api/analyze/route";
import * as cases from "@/app/api/cases/route";
import * as caseDetail from "@/app/api/cases/detail/route";
import * as health from "@/app/api/health/route";
import * as laws from "@/app/api/laws/route";
import * as lawOne from "@/app/api/laws/[id]/route";
import * as providers from "@/app/api/providers/route";

type Handler = (req: Request, ctx?: { params: Record<string, string> }) => Response | Promise<Response>;

function resolve(method: string, path: string): { fn: Handler; params?: Record<string, string> } | null {
  const table: Record<string, Partial<Record<string, Handler>>> = {
    "/api/ask": ask as never,
    "/api/analyze": analyze as never,
    "/api/cases": cases as never,
    "/api/cases/detail": caseDetail as never,
    "/api/health": health as never,
    "/api/laws": laws as never,
    "/api/providers": providers as never,
  };
  const fixed = table[path]?.[method];
  if (fixed) return { fn: fixed };
  const m = path.match(/^\/api\/laws\/([^/]+)$/);
  if (m && method === "GET") return { fn: (lawOne as unknown as { GET: Handler }).GET, params: { id: m[1] } };
  return null;
}

const nativeFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  // 공유판에는 로컬 LLM(Ollama)이 없으므로 상태 확인 요청을 보내지 않고 바로 '연결 안 됨'으로 처리
  if (/^https?:\/\/(localhost|127\.0\.0\.1):11434\//.test(url)) return Promise.reject(new TypeError("공유판에서는 로컬 LLM에 연결하지 않습니다"));
  if (!url.startsWith("/api/")) return nativeFetch(input, init);
  const u = new URL(url, "http://law-on.local");
  const method = (init?.method ?? "GET").toUpperCase();
  const hit = resolve(method, u.pathname);
  if (!hit) return new Response(JSON.stringify({ error: "지원하지 않는 요청입니다." }), { status: 404, headers: { "content-type": "application/json" } });
  const req = new Request(u.href, { method, headers: init?.headers, body: method === "GET" ? undefined : init?.body });
  try {
    return await hit.fn(req, { params: hit.params ?? {} });
  } catch (e) {
    console.error("[공유판 API]", e);
    return new Response(JSON.stringify({ error: "처리 중 오류가 발생했습니다." }), { status: 500, headers: { "content-type": "application/json" } });
  }
};
