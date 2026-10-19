import * as React from "react";
import { getRoute, navigate, subscribe } from "../router";

/** next/navigation 대체 — 해시 라우터 기준 */
const useRoute = () => React.useSyncExternalStore(subscribe, getRoute, getRoute);

export function useSearchParams() {
  const { qs } = useRoute();
  return React.useMemo(() => new URLSearchParams(qs), [qs]);
}

export function usePathname() {
  return useRoute().path;
}

export function useRouter() {
  return React.useMemo(
    () => ({
      push: (href: string) => navigate(href),
      replace: (href: string) => navigate(href, true),
      back: () => history.back(),
      forward: () => history.forward(),
      refresh: () => undefined,
      prefetch: () => undefined,
    }),
    [],
  );
}

export function notFound(): never {
  throw new Error("not found");
}
