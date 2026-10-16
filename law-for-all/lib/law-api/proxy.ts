/**
 * 법령 API 중계 서버(proxy/main.py) 설정 — 선택 사항.
 * 기본은 중계 서버 없이 앱 서버가 LAW_API_OC(법제처 Open API 인증키)로 www.law.go.kr 을 직접 호출한다
 * (인증키에 등록한 IP의 PC·서버에서 실행).
 *  - LAW_PROXY_URL=https://…  → 그 중계 서버의 /api/raw 로 대신 호출(인증키는 중계 서버에 보관)
 *  - LAW_PROXY_TOKEN          → 중계 서버에 PROXY_TOKEN 을 설정했다면 같은 값
 */
export const DEFAULT_LAW_PROXY_URL = "";

const OFF = new Set(["off", "none", "direct", "false", "0"]);

export function lawProxy(): { url: string; token: string } | null {
  const raw = (process.env.LAW_PROXY_URL ?? DEFAULT_LAW_PROXY_URL).trim();
  if (!raw || OFF.has(raw.toLowerCase())) return null;
  return { url: raw.replace(/\/+$/, ""), token: (process.env.LAW_PROXY_TOKEN ?? "").trim() };
}
