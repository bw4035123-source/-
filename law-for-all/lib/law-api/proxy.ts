/**
 * 법령 API 중계 서버(proxy/main.py, Render 배포) 설정.
 * 브라우저·앱 서버가 국가법령정보센터를 직접 부르면 미등록 IP로 차단되므로,
 * 기본값으로 모든 실시간 조회를 아래 중계 서버의 /api/raw 로 보낸다(인증키는 중계 서버에만 보관).
 *  - LAW_PROXY_URL=off  → 중계 서버를 쓰지 않고 LAW_API_OC 로 law.go.kr 직접 호출
 *  - LAW_PROXY_TOKEN    → 중계 서버에 PROXY_TOKEN 을 설정했다면 같은 값
 */
export const DEFAULT_LAW_PROXY_URL = "https://law-proxy-api.onrender.com";

const OFF = new Set(["off", "none", "direct", "false", "0"]);

export function lawProxy(): { url: string; token: string } | null {
  const raw = (process.env.LAW_PROXY_URL ?? DEFAULT_LAW_PROXY_URL).trim();
  if (!raw || OFF.has(raw.toLowerCase())) return null;
  return { url: raw.replace(/\/+$/, ""), token: (process.env.LAW_PROXY_TOKEN ?? "").trim() };
}
