/**
 * 법령 API 중계 서버 설정.
 * 기본(비워 둠)은 법이음 클라우드 서버(인증키·등록 IP 보유)의 /api/raw 로 대신 호출 — IP 미등록 PC에서도 판례·실시간 법령.
 *  - LAW_PROXY_URL=off        → 앱 서버가 LAW_API_OC 로 www.law.go.kr 을 직접 호출(인증키에 등록한 IP에서 실행)
 *  - LAW_PROXY_URL=https://…  → 그 중계 서버(proxy/main.py 등)의 /api/raw 로 대신 호출
 *  - LAW_PROXY_TOKEN          → 중계 서버에 PROXY_TOKEN 을 설정했다면 같은 값
 */
export const DEFAULT_LAW_PROXY_URL = "https://lawon.onrender.com";

const OFF = new Set(["off", "none", "direct", "false", "0"]);

export function lawProxy(): { url: string; token: string } | null {
  const raw = (process.env.LAW_PROXY_URL ?? "").trim() || DEFAULT_LAW_PROXY_URL;
  if (!raw || OFF.has(raw.toLowerCase())) return null;
  return { url: raw.replace(/\/+$/, ""), token: (process.env.LAW_PROXY_TOKEN ?? "").trim() };
}
