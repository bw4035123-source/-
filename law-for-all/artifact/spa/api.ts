/**
 * /api/* 요청을 브라우저 안에서 처리 — 앱의 실제 API 처리기(app/api/…/route.ts)를 그대로 실행한다.
 * 실시간 서버(기본 https://lawon.onrender.com, 빌드 때 LAW_ON_REMOTE 로 변경)가 응답하면 그 서버 API로 판례·실시간 법령을 받고,
 * 잠들어 있거나 연결이 안 되면 내장 공식 원문 + 규칙기반 엔진으로 처리한다(인증키는 서버에만 있고 이 파일에는 없다).
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

// ───── 실시간 서버 연결(있으면 사용, 없으면 내장 엔진)
declare const __LAW_ON_REMOTE__: string;
const REMOTE = (typeof __LAW_ON_REMOTE__ === "string" ? __LAW_ON_REMOTE__ : "").replace(/\/$/, "");
let remoteLive = false;
let probing: Promise<boolean> | null = null;
let retries = 0;

async function timed(url: string, init: RequestInit, ms: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await nativeFetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function probe(ms = 6000): Promise<boolean> {
  if (!REMOTE) return Promise.resolve(false);
  probing ??= timed(`${REMOTE}/api/health`, { cache: "no-store" }, ms)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => j?.lawApi === "live")
    .catch(() => false)
    .then((ok) => {
      remoteLive = ok;
      probing = null;
      // 무료 클라우드는 잠들어 있다 깨어나는 데 30초~1분 — 뒤에서 몇 번 더 확인해 깨어나면 그때부터 사용
      if (!ok && retries++ < 6) setTimeout(() => void probe(20000), 15000);
      return ok;
    });
  return probing;
}
const firstProbe = probe();

window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  // 공유판에는 로컬 LLM(Ollama)이 없으므로 상태 확인 요청을 보내지 않고 바로 '연결 안 됨'으로 처리
  if (/^https?:\/\/(localhost|127\.0\.0\.1):11434\//.test(url)) return Promise.reject(new TypeError("공유판에서는 로컬 LLM에 연결하지 않습니다"));
  if (!url.startsWith("/api/")) return nativeFetch(input, init);
  await Promise.race([firstProbe, new Promise((r) => setTimeout(r, 6500))]);
  // 판례는 실시간 서버에서만 나온다 — 서버가 잠들어 있으면(무료 클라우드는 깨어나는 데 30초~1분) 깨어날 때까지 기다린다(화면은 '찾는 중' 표시)
  if (!remoteLive && REMOTE && url.startsWith("/api/cases")) await probe(50000);
  if (remoteLive) {
    try {
      const { signal: _ignored, ...rest } = init ?? {};
      const r = await timed(REMOTE + url, rest, /\/api\/(ask|analyze|cases)/.test(url) ? 40000 : 20000);
      if (r.status < 500) return r;
    } catch {
      /* 아래 내장 엔진으로 */
    }
    remoteLive = false;
    retries = 0;
    void probe(20000);
  }
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
