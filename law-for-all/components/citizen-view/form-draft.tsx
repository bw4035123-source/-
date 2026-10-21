"use client";
import * as React from "react";
import { ClipboardCopy, FileDown, FilePen, Lock, Printer, Send } from "lucide-react";
import type { AskResult } from "@/lib/answer/types";
import { citeFrom, formForTopic, todayKo } from "@/lib/citizen-forms";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import { downloadWord } from "@/lib/word-export";

/** 국민 모드 서류 초안 — 상황에 맞는 진정서·내용증명·신청서를 근거 조문을 넣어 작성(입력값은 저장·전송하지 않음) */
export function FormDraft({ result }: { result: AskResult }) {
  const form = formForTopic(result.topic?.id);
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [edited, setEdited] = React.useState<string | null>(null);
  if (!form) return null;

  const generated = form.build(values, citeFrom(result.citations), todayKo());
  const text = edited ?? generated;
  const set = (k: string, v: string) => {
    setEdited(null);
    setValues((p) => ({ ...p, [k]: v }));
  };
  const print = () => {
    const w = window.open("", "_blank");
    if (!w) return toast("팝업이 차단되어 인쇄 창을 열 수 없습니다");
    const pre = w.document.createElement("pre");
    pre.textContent = text;
    pre.style.cssText = "white-space:pre-wrap;font-family:'Malgun Gothic',sans-serif;font-size:11pt;line-height:1.8";
    w.document.title = form.title;
    w.document.body.appendChild(pre);
    w.print();
  };

  return (
    <section aria-labelledby="form-draft-h" className="no-print rounded-2xl border bg-gradient-to-br from-sky-50 to-white p-4 shadow-sm dark:from-sky-950/30 dark:to-transparent sm:p-5">
      <h2 id="form-draft-h" className="flex items-center gap-2 text-lg font-extrabold">
        <FilePen className="h-5 w-5 text-accent" /> 필요한 서류, 초안을 만들어 드려요
      </h2>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold">{form.title}</p>
          <p className="text-sm text-muted-foreground">{form.desc}</p>
        </div>
        <Button variant="accent" onClick={() => setOpen(true)}>
          <FilePen /> 초안 만들기
        </Button>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-5xl" aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <FilePen className="h-5 w-5 text-accent" /> {form.title} 초안
            </SheetTitle>
            <SheetDescription>빈칸을 채우면 오른쪽 초안이 바로 바뀌어요. 법적 근거는 이 답변의 근거 조문(원문 확인)만 넣었어요.</SheetDescription>
          </SheetHeader>
          <div className="grid flex-1 gap-4 overflow-y-auto p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <div className="space-y-3">
              <p className="flex items-center gap-1.5 rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
                <Lock className="h-3.5 w-3.5 shrink-0" /> 입력한 내용은 이 화면 안에서만 쓰고 저장하거나 서버로 보내지 않아요.
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                {form.fields.map((f) => (
                  <label key={f.id} className={`flex flex-col gap-1 text-xs font-semibold text-muted-foreground ${f.half ? "" : "col-span-2"}`}>
                    {f.label}
                    {f.multiline ? (
                      <textarea value={values[f.id] ?? ""} onChange={(e) => set(f.id, e.target.value)} placeholder={f.placeholder} rows={3} className="rounded-md border bg-card px-2.5 py-1.5 text-sm font-normal text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
                    ) : (
                      <input value={values[f.id] ?? ""} onChange={(e) => set(f.id, e.target.value)} placeholder={f.placeholder} className="h-9 rounded-md border bg-card px-2.5 text-sm font-normal text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
                    )}
                  </label>
                ))}
              </div>
              <p className="flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
                <Send className="mt-0.5 h-3.5 w-3.5 shrink-0" /> 제출처: {form.submitTo}
              </p>
            </div>
            <div className="flex min-h-0 flex-col gap-2">
              <textarea
                value={text}
                onChange={(e) => setEdited(e.target.value)}
                aria-label={`${form.title} 초안`}
                spellCheck={false}
                className="min-h-[50vh] flex-1 resize-y rounded-xl border bg-card p-4 font-mono text-[0.85rem] leading-6 focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="accent" onClick={async () => toast((await copyText(text)) ? "초안을 복사했습니다" : "복사하지 못했습니다")}>
                  <ClipboardCopy /> 복사
                </Button>
                <Button size="sm" variant="outline" onClick={() => downloadWord(form.title, [{ body: text }])}>
                  <FileDown /> Word로 저장
                </Button>
                <Button size="sm" variant="outline" onClick={print}>
                  <Printer /> 인쇄
                </Button>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">※ 근거 조문으로 만든 초안이며 법률 자문이 아닙니다. 사실관계·금액·날짜를 확인하고, 필요하면 대한법률구조공단(☎132) 상담을 받아 보세요.</p>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
