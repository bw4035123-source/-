"use client";
import * as React from "react";
import type { UserMode } from "@/lib/answer/types";

export type FontScale = 1 | 1.15 | 1.3;

interface Settings {
  mode: UserMode;
  fontScale: FontScale;
  highContrast: boolean;
  dark: boolean;
  provider: string; // "" = 서버 기본값
}

interface Ctx extends Settings {
  setMode: (m: UserMode) => void;
  setFontScale: (s: FontScale) => void;
  setHighContrast: (v: boolean) => void;
  setDark: (v: boolean) => void;
  setProvider: (p: string) => void;
  ready: boolean;
}

const DEFAULTS: Settings = { mode: "citizen", fontScale: 1, highContrast: false, dark: false, provider: "" };
const KEY = "law-for-all:settings:v1";
// 모드는 탭 안에서만 유지 — 새로 들어오면 항상 국민 모드로 시작(?mode=officer 로 바로 열 수 있음)
const MODE_KEY = "law-for-all:mode";
const SettingsCtx = React.createContext<Ctx | null>(null);

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

/** 사용자 보기 설정(모드·글자 크기·고대비·다크·LLM). 브라우저에만 저장되는 개인 편의 설정 */
export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [s, setS] = React.useState<Settings>(DEFAULTS);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    const loaded = load();
    loaded.dark = false; // 화이트 & 블루 단일 테마(어두운 화면·고대비 없음)
    loaded.highContrast = false;
    loaded.mode = "citizen";
    try {
      const m = sessionStorage.getItem(MODE_KEY);
      if (m === "citizen" || m === "officer") loaded.mode = m;
    } catch {
      /* 저장 불가 환경 */
    }
    const url = new URL(window.location.href).searchParams.get("mode");
    if (url === "citizen" || url === "officer") loaded.mode = url;
    setS(loaded);
    setReady(true);
  }, []);

  React.useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    root.style.setProperty("--font-scale", String(s.fontScale));
    root.dataset.contrast = s.highContrast ? "high" : "normal";
    root.dataset.mode = s.mode;
    root.classList.toggle("dark", s.dark);
    try {
      const { mode, ...rest } = s;
      localStorage.setItem(KEY, JSON.stringify(rest));
      sessionStorage.setItem(MODE_KEY, mode);
    } catch {
      /* 저장 불가 환경(사생활 보호 모드 등)에서도 동작 */
    }
  }, [s, ready]);

  const value = React.useMemo<Ctx>(
    () => ({
      ...s,
      ready,
      setMode: (mode) => setS((p) => ({ ...p, mode })),
      setFontScale: (fontScale) => setS((p) => ({ ...p, fontScale })),
      setHighContrast: () => setS((p) => ({ ...p, highContrast: false })),
      setDark: () => setS((p) => ({ ...p, dark: false })),
      setProvider: (provider) => setS((p) => ({ ...p, provider })),
    }),
    [s, ready],
  );
  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

export function useSettings(): Ctx {
  const c = React.useContext(SettingsCtx);
  if (!c) throw new Error("useSettings must be used within SettingsProvider");
  return c;
}
