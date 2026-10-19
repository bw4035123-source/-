/** next/server 대체 — API 처리기를 브라우저에서 그대로 실행하기 위한 최소 구현 */
export const NextResponse = {
  json(data: unknown, init: ResponseInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json; charset=utf-8");
    return new Response(JSON.stringify(data), { ...init, headers });
  },
};
