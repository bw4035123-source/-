import { LLMError, type ProviderId } from "./types";

/** 제한시간·오류 메시지 정규화가 포함된 JSON POST */
export async function postJson<T>(provider: ProviderId, url: string, body: unknown, headers: Record<string, string>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("timeout")), timeoutMs);
  const onAbort = () => ctrl.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      cache: "no-store",
    });
    const raw = await res.text();
    if (!res.ok) {
      let detail = raw.slice(0, 300);
      try {
        const j = JSON.parse(raw);
        detail = j?.error?.message ?? j?.error ?? detail;
      } catch {
        /* 원문 유지 */
      }
      throw new LLMError(`${provider} API 오류(${res.status}): ${detail}`, provider, res.status);
    }
    return JSON.parse(raw) as T;
  } catch (e) {
    if (e instanceof LLMError) throw e;
    const msg = ctrl.signal.aborted ? `응답 제한시간(${Math.round(timeoutMs / 1000)}초) 초과` : (e as Error).message;
    throw new LLMError(`${provider} 연결 실패: ${msg}`, provider);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
