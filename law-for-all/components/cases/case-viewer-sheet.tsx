"use client";
import * as React from "react";
import { ClipboardCopy, ExternalLink, Loader2, Lightbulb } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useSettings } from "@/components/providers/settings-provider";
import type { CaseDetail, CaseItem } from "@/lib/law-api/types";
import { copyText } from "@/lib/clipboard";
import { formatLawDate } from "@/lib/utils";

/** 판례 인용 표기: 대법원 2026. 1. 29. 선고 2023두54914 판결 */
export function caseCitation(d: Pick<CaseDetail, "kind" | "court" | "date" | "caseNo" | "judgmentType" | "title">): string {
  if (d.kind === "법령해석례") return `${d.court ?? "법제처"} 법령해석례 ${d.caseNo ?? ""}(${formatLawDate(d.date)}) 「${d.title}」`.trim();
  return [d.court, formatLawDate(d.date), "선고", d.caseNo, d.judgmentType ?? "판결"].filter(Boolean).join(" ");
}

const HELP: Record<string, string> = {
  판시사항: "이 사건에서 법원이 판단한 법률 문제(쟁점)를 요약한 부분이에요.",
  판결요지: "법원의 핵심 판단이에요. 비슷한 사건에서 가장 많이 인용되는 부분이에요.",
  참조조문: "판결의 근거가 된 법 조항이에요.",
  질의요지: "행정기관이 법제처에 물어본 내용이에요.",
  회답: "법제처의 공식 해석 결론이에요.",
};

/** 판례·법령해석례 상세 슬라이드 뷰어(국가법령정보 실시간 원문, 텍스트로만 출력) */
export function CaseViewerSheet({ item, onOpenChange }: { item: CaseItem | null; onOpenChange: (open: boolean) => void }) {
  const toast = useToast();
  const { mode } = useSettings();
  const [state, setState] = React.useState<{ detail?: CaseDetail; error?: string } | null>(null);

  React.useEffect(() => {
    if (!item) return;
    setState(null);
    const ctrl = new AbortController();
    fetch(`/api/cases/detail?kind=${item.kind === "판례" ? "prec" : "expc"}&id=${encodeURIComponent(item.id)}`, { signal: ctrl.signal })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "판례를 불러오지 못했습니다.");
        setState({ detail: j.detail });
      })
      .catch((e) => !ctrl.signal.aborted && setState({ error: (e as Error).message }));
    return () => ctrl.abort();
  }, [item]);

  const d = state?.detail;
  const citizen = mode === "citizen";
  return (
    <Sheet open={!!item} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby={undefined}>
        {item && (
          <>
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="accent">{item.kind}</Badge>
                {(d?.court ?? item.court) && <Badge variant="secondary">{d?.court ?? item.court}</Badge>}
                <Badge variant="success">국가법령정보 실시간</Badge>
              </div>
              <SheetTitle className="mt-1 text-lg leading-snug">{d?.title ?? item.title}</SheetTitle>
              <SheetDescription>{[d?.caseNo ?? item.caseNo, formatLawDate(d?.date ?? item.date), d?.judgmentType].filter(Boolean).join(" · ")}</SheetDescription>
            </SheetHeader>
            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              {!state ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> 판례 원문을 불러오는 중…
                </p>
              ) : state.error ? (
                <p className="rounded-lg bg-secondary p-4 text-sm text-muted-foreground">{state.error}</p>
              ) : (
                d && (
                  <>
                    {citizen && (
                      <p className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-950 dark:bg-amber-900/20 dark:text-amber-100">
                        <Lightbulb className="h-5 w-5 shrink-0 text-amber-500" aria-hidden />
                        판례는 비슷한 사건에서 법원이 어떻게 판단했는지 보여 줘요. 다만 사실관계가 조금만 달라도 결론이 달라질 수 있으니 참고로 활용하세요.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="accent" onClick={async () => toast((await copyText(caseCitation(d))) ? "판례 인용 표기를 복사했습니다" : "복사 실패")}>
                        <ClipboardCopy /> 인용 표기 복사
                      </Button>
                      <Button size="sm" variant="ghost" asChild>
                        <a href={d.url} target="_blank" rel="noreferrer">
                          <ExternalLink /> 국가법령정보센터
                        </a>
                      </Button>
                    </div>
                    {d.sections.map((s, i) => {
                      const long = s.label === "판결 전문" || s.label === "이유";
                      const body = <p className="whitespace-pre-line text-[0.93rem] leading-7">{s.text}</p>;
                      return (
                        <section key={s.label} className="rounded-xl border bg-card p-4">
                          <h3 className="mb-1 font-bold text-primary">{s.label}</h3>
                          {citizen && HELP[s.label] && <p className="mb-2 text-xs text-muted-foreground">{HELP[s.label]}</p>}
                          {long ? (
                            <details open={i === 0}>
                              <summary className="cursor-pointer text-sm font-semibold text-accent">펼쳐 보기 ({s.text.length.toLocaleString()}자)</summary>
                              <div className="mt-2 max-h-[60vh] overflow-y-auto">{body}</div>
                            </details>
                          ) : (
                            body
                          )}
                        </section>
                      );
                    })}
                    <p className="text-xs leading-5 text-muted-foreground">※ 국가법령정보센터 공동활용 Open API 원문입니다. 개인정보는 원문에서 비실명 처리되어 제공됩니다.</p>
                  </>
                )
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
