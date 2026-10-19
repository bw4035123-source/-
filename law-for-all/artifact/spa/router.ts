/** 단일 파일 공유판의 해시 라우터 — "#/search?q=…" 를 경로·검색어로 나눠 구독자에게 알린다 */
export interface Route {
  path: string;
  qs: string;
}

const listeners = new Set<() => void>();
let current: Route = parse(window.location.hash) ?? { path: "/", qs: "" };

function parse(hash: string): Route | null {
  if (!hash.startsWith("#/")) return null; // "#main" 같은 일반 앵커는 경로가 아님
  const [path, qs = ""] = hash.slice(1).split("?");
  return { path: path.replace(/\/$/, "") || "/", qs };
}

window.addEventListener("hashchange", () => {
  const r = parse(window.location.hash);
  if (!r) return;
  current = r;
  listeners.forEach((l) => l());
});

export const getRoute = () => current;
export const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function navigate(href: string, replace = false) {
  const target = `#${href.startsWith("/") ? href : `/${href}`}`;
  if (replace) {
    history.replaceState(null, "", target);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else window.location.hash = target;
}

// law-page-client 등 window.location.pathname 을 읽는 코드가 현재 경로를 보도록(빌드 때 치환)
(window as unknown as { __spaPathname: () => string }).__spaPathname = () => current.path;
