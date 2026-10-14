"use client";
import * as React from "react";
import type { Citation } from "@/lib/law-api/types";
import { LawViewerSheet } from "./law-viewer-sheet";

interface Ctx {
  citations: Citation[];
  indexOf: (key: string) => number;
  open: (key: string) => void;
}
const CitationCtx = React.createContext<Ctx>({ citations: [], indexOf: () => -1, open: () => {} });

/** 답변 본문의 인용 표식과 근거 조문 카드·원문 슬라이드 뷰어를 연결 */
export function CitationProvider({ citations, children }: { citations: Citation[]; children: React.ReactNode }) {
  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const value = React.useMemo<Ctx>(
    () => ({ citations, indexOf: (k) => citations.findIndex((c) => c.key === k), open: (k) => setOpenKey(k) }),
    [citations],
  );
  const current = citations.find((c) => c.key === openKey) ?? null;
  return (
    <CitationCtx.Provider value={value}>
      {children}
      <LawViewerSheet citation={current} onOpenChange={(o) => !o && setOpenKey(null)} />
    </CitationCtx.Provider>
  );
}

export const useCitations = () => React.useContext(CitationCtx);
