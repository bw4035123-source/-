"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import type { AskResult } from "@/lib/answer/types";
import { Button } from "@/components/ui/button";
import { REPORT_STORAGE_KEY } from "@/lib/report-text";
import { fetchJson } from "@/lib/fetch-json";
import { articleLabel } from "@/lib/law-api/util";
import { ArticleText } from "@/components/law-search/article-text";
import { useSettings } from "@/components/providers/settings-provider";
import { MOCK_DATASET_DATE } from "@/lib/law-api/mock/dataset-date";

const strip = (t: string, keys: string[]) => t.replace(/\[\[([^\]]+)\]\]/g, (_, k: string) => (keys.indexOf(k) >= 0 ? `[${keys.indexOf(k) + 1}]` : "")).trim();

/** 인쇄·PDF 저장용 법률 리포트(브라우저 '인쇄 → PDF로 저장' — 한글 글꼴 깨짐 없음) */
export function ReportView() {
  const q = useSearchParams().get("q") ?? "";
  const router = useRouter();
  const { mode, provider, ready } = useSettings();
  const [r, setR] = React.useState<AskResult | null>(null);
  const [err, setErr] = React.useState("");

  React.useEffect(() => {
    if (!ready) return;
    try {
      const saved = JSON.parse(localStorage.getItem(REPORT_STORAGE_KEY) ?? "null") as AskResult | null;
      if (saved && saved.query === q) return setR(saved);
    } catch {
      /* 재조회 */
    }
    if (!q) return setErr("리포트로 만들 검색 결과가 없습니다.");
    fetchJson<AskResult>("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q, mode, provider: provider || undefined }) })
      .then(setR)
      .catch((e) => setErr((e as Error).message || "리포트를 불러오지 못했습니다."));
  }, [q, ready, mode, provider]);

  if (err) return <p className="container py-20 text-center text-muted-foreground">{err}</p>;
  if (!r)
    return (
      <p className="container flex items-center justify-center gap-2 py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" /> 리포트를 준비하고 있어요…
      </p>
    );

  const keys = r.citations.map((c) => c.key);
  const officer = r.mode === "officer" && r.officer;
  return (
    <div className="container max-w-3xl py-8">
      <div className="no-print mb-6 flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft /> 돌아가기
        </Button>
        <Button variant="accent" onClick={() => window.print()}>
          <Printer /> 인쇄 · PDF로 저장
        </Button>
      </div>
      <p className="no-print mb-4 rounded-lg bg-secondary px-4 py-2 text-xs text-muted-foreground">인쇄 창에서 대상(프린터)을 ‘PDF로 저장’으로 선택하면 PDF 파일로 내려받을 수 있어요.</p>

      <article className="rounded-xl border bg-white p-8 text-slate-900 shadow-sm print:border-0 print:p-0 print:shadow-none">
        <header className="border-b-2 border-slate-900 pb-4">
          <p className="text-xs font-bold tracking-widest text-teal-700">법이음 · {officer ? "법령 검토 요약 보고" : "생활 법률 리포트"}</p>
          <h1 className="mt-2 text-2xl font-black leading-snug">{r.query}</h1>
          <p className="mt-2 text-xs text-slate-500">
            작성 {new Date(r.generatedAt).toLocaleString("ko-KR")} · {r.provider.label} · 근거 {r.citations.length}건 · {r.dataSource === "live" ? "국가법령정보 실시간 원문" : `국가법령정보센터 원문(${MOCK_DATASET_DATE} 수집)`}
          </p>
        </header>

        <section className="mt-6">
          <h2 className="text-lg font-extrabold">핵심 요약</h2>
          <p className="mt-2 leading-8">{strip(r.summary, keys)}</p>
        </section>

        {!officer && r.citizen && (
          <>
            {r.citizen.steps.length > 0 && (
              <section className="mt-6">
                <h2 className="text-lg font-extrabold">지금 해야 할 일</h2>
                <ol className="mt-2 space-y-3">
                  {r.citizen.steps.map((s, i) => (
                    <li key={i} className="rounded-lg border border-slate-300 p-3">
                      <p className="font-bold">
                        {i + 1}단계. {s.title}
                      </p>
                      <p className="mt-1 text-sm leading-6">{strip(s.detail, keys)}</p>
                    </li>
                  ))}
                </ol>
              </section>
            )}
            {r.citizen.easyTerms.length > 0 && (
              <section className="mt-6">
                <h2 className="text-lg font-extrabold">용어 풀이</h2>
                <dl className="mt-2 grid gap-2 text-sm">
                  {r.citizen.easyTerms.map((t) => (
                    <div key={t.term}>
                      <dt className="inline font-bold">{t.term}</dt> — <dd className="inline">{t.meaning}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
          </>
        )}

        {officer && (
          <section className="mt-6 space-y-3 text-sm leading-7">
            {r.officer!.background && (
              <p>
                <strong>법적 근거 체계 </strong>
                {strip(r.officer!.background, keys)}
              </p>
            )}
            <ul className="list-disc pl-5">
              {r.officer!.keyPoints.map((k, i) => (
                <li key={i}>{strip(k, keys)}</li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-6">
          <h2 className="text-lg font-extrabold">도움받을 수 있는 곳</h2>
          <ul className="mt-2 text-sm leading-7">
            {r.contacts.map((c) => (
              <li key={c.name}>
                · <strong>{c.name}</strong> {c.phone && `☎ ${c.phone}`} {c.url && <a href={c.url}>{c.url.replace(/^https?:\/\//, "")}</a>} — {c.desc}
              </li>
            ))}
          </ul>
        </section>

        <section className="print-break mt-8">
          <h2 className="text-lg font-extrabold">근거 법령 원문</h2>
          <ol className="mt-3 space-y-4">
            {r.citations.map((c, i) => (
              <li key={c.key} className="rounded-lg border border-slate-300 p-4">
                <p className="mb-2 font-bold">
                  [{i + 1}] 「{c.lawName}」 {articleLabel(c.articleNo)}({c.title})
                </p>
                <ArticleText text={c.text} className="text-sm leading-6" />
              </li>
            ))}
          </ol>
        </section>
        <footer className="mt-8 border-t border-slate-300 pt-3 text-[11px] leading-5 text-slate-500">
          본 리포트는 법률 정보 제공 목적의 AI 보조 결과이며 법률 자문이 아닙니다. 법령은 개정될 수 있으므로 국가법령정보센터(www.law.go.kr)에서 현행 원문을 확인하시기 바랍니다.
        </footer>
      </article>
    </div>
  );
}
