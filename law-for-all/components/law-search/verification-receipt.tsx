"use client";
import * as React from "react";
import { CheckCircle2, ClipboardCopy, FileDown, Fingerprint, Printer, ReceiptText, TriangleAlert } from "lucide-react";
import type { AskResult } from "@/lib/answer/types";
import { buildReceipt, receiptText, type Receipt } from "@/lib/receipt";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import { downloadWord } from "@/lib/word-export";

/** AI 답변 검증 영수증 — 근거 원문의 출처·시각·지문과 인용 검증 결과를 한 장으로(보고서·기안문 붙임용) */
export function VerificationReceipt({ result }: { result: AskResult }) {
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [rc, setRc] = React.useState<Receipt | null>(null);

  const start = async () => {
    setOpen(true);
    setRc(await buildReceipt(result));
  };
  const text = rc ? receiptText(rc) : "";
  const print = () => {
    const w = window.open("", "_blank");
    if (!w) return toast("팝업이 차단되어 인쇄 창을 열 수 없습니다");
    const pre = w.document.createElement("pre");
    pre.textContent = text;
    pre.style.cssText = "white-space:pre-wrap;font-family:'Malgun Gothic',sans-serif;font-size:10.5pt;line-height:1.7";
    w.document.title = "AI 답변 검증 영수증";
    w.document.body.appendChild(pre);
    w.print();
  };

  return (
    <>
      <Button variant="outline" onClick={() => void start()}>
        <ReceiptText /> 검증 영수증
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-2xl" aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <ReceiptText className="h-5 w-5 text-accent" /> AI 답변 검증 영수증
            </SheetTitle>
            <SheetDescription>이 답변이 어떤 조문 원문을 언제·어디서 가져와 근거로 삼았는지, 인용 검증에서 무엇을 걸렀는지 기록해요. 보고서·기안문에 붙여 AI 활용의 근거를 남길 수 있어요.</SheetDescription>
          </SheetHeader>
          {rc && (
            <div className="flex-1 space-y-4 overflow-y-auto p-5 text-sm">
              <div className="rounded-xl border-2 border-dashed border-accent/40 bg-secondary/30 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-dashed pb-2">
                  <p className="font-extrabold">법이음(LAW:ON) 검증 영수증</p>
                  <p className="font-mono text-xs text-muted-foreground">No. {rc.id ?? "—"}</p>
                </div>
                <dl className="mt-2 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1 text-[13px]">
                  <dt className="text-muted-foreground">발급 시각</dt>
                  <dd>{rc.issuedAt}</dd>
                  <dt className="text-muted-foreground">질문</dt>
                  <dd className="font-semibold">
                    {rc.query} <span className="font-normal text-muted-foreground">({rc.mode})</span>
                  </dd>
                  <dt className="text-muted-foreground">답변 엔진</dt>
                  <dd>{rc.engine}</dd>
                  <dt className="text-muted-foreground">법령 데이터</dt>
                  <dd>{rc.data}</dd>
                </dl>

                <p className="mt-4 mb-1.5 text-xs font-bold text-muted-foreground">근거 조문 · 원문 지문</p>
                <ol className="space-y-1.5">
                  {rc.rows.map((x) => (
                    <li key={x.key} className="rounded-lg bg-card px-3 py-2 ring-1 ring-border">
                      <p className="flex flex-wrap items-center gap-x-2 font-semibold">
                        <span className="grid h-5 min-w-5 place-items-center rounded bg-accent/15 px-1 text-[11px] text-accent">{x.no}</span>
                        <a href={x.url} target="_blank" rel="noreferrer" className="hover:underline">
                          {x.label}
                        </a>
                        {x.cited && <span className="rounded bg-sage-100 px-1.5 text-[10px] font-bold text-sage-700 dark:bg-sage-800/40 dark:text-sage-300">답변 인용</span>}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                        <span>{x.source}</span>
                        <span className="inline-flex items-center gap-1 font-mono">
                          <Fingerprint className="h-3 w-3" /> {x.fingerprint ?? "—"}
                        </span>
                      </p>
                    </li>
                  ))}
                </ol>

                <p className="mt-4 mb-1.5 text-xs font-bold text-muted-foreground">인용 검증</p>
                <ul className="space-y-1">
                  {rc.checks.map((c) => (
                    <li key={c.label} className="flex items-start gap-2 text-[13px]">
                      {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sage-600" /> : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
                      <span>
                        <b>{c.label}</b> — {c.value}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">원문 지문은 조문 원문 전체를 SHA-256으로 계산한 값의 앞 16자리예요. 같은 원문으로 다시 계산하면 같은 값이 나와, 답변 당시 근거가 바뀌지 않았는지 확인할 수 있어요.</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="accent" onClick={async () => toast((await copyText(text)) ? "검증 영수증을 복사했습니다" : "복사하지 못했습니다")}>
                  <ClipboardCopy /> 복사
                </Button>
                <Button size="sm" variant="outline" onClick={() => downloadWord(`검증영수증_${rc.query}`, [{ body: text }])}>
                  <FileDown /> Word로 저장
                </Button>
                <Button size="sm" variant="outline" onClick={print}>
                  <Printer /> 인쇄
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
