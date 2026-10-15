/** JSON POST/GET + 제한시간 — 서버가 응답하지 않아도 화면이 무한 대기하지 않도록 */
export async function fetchJson<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 40000, signal, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException("timeout", "TimeoutError")), timeoutMs);
  const onAbort = () => ctrl.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort);
  try {
    const r = await fetch(url, { ...rest, signal: ctrl.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j as { error?: string }).error ?? `요청 실패(${r.status})`);
    return j as T;
  } catch (e) {
    if (ctrl.signal.aborted && !signal?.aborted) throw new Error("응답이 너무 오래 걸립니다. 잠시 후 다시 시도해 주세요.");
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
