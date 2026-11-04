"use client";
import * as React from "react";
import { ClipboardCopy, FileDown, Sparkles } from "lucide-react";
import { diffCells, quickMarkdown, type QuickResultArticle } from "@/lib/amend-quick";
import { fetchJson } from "@/lib/fetch-json";
import { copyText } from "@/lib/clipboard";
import { downloadWord, escapeHtml } from "@/lib/word-export";
import { Button } from "@/components/ui/button";
import { LawLoader } from "@/components/ui/law-loader";
import { useToast } from "@/components/ui/toast";

const EXAMPLE = `제5조(처리기간) ① 민원은 접수한날부터 7일안에 처리해야 한다.
② 부득이한 경우에는 처리기간을 한번 연장할수 있으며 이경우 민원인에게 알려줘야 한다.
제6조(결과 통지) 처리 결과는 문서로 통지해야 하나 민원인이 원하면 전화로 할 수 있다.
개정해줘`;

type Result = {
  request: string;
  summary: string;
  articles: (QuickResultArticle & { changes: string[]; warnings: string[] })[];
  rejected: { label: string; reason: string }[];
  unchanged: number;
  upper: string[];
  label: string;
  model: string;
};

/** '**굵게**'·'<br>' 표기를 화면 요소로 */
function Cell({ md }: { md: string }) {
  const lines = md.split("<br>");
  return (
    <>
      {lines.map((line, i) => (
        <React.Fragment key={i}>
          {line.split("**").map((t, k) => (k % 2 ? <b key={k} className="font-extrabold text-accent">{t.replace(/\\\|/g, "|")}</b> : <span key={k}>{t.replace(/\\\|/g, "|")}</span>))}
          {i < lines.length - 1 && <br />}
        </React.Fragment>
      ))}
    </>
  );
}

/** 한 번에 개정 — 조문을 붙여 넣고 "개정해줘"라고만 하면 3가지 양식으로 */
export function QuickAmend() {
  const toast = useToast();
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [r, setR] = React.useState<Result | null>(null);

  const run = async () => {
    if (text.trim().length < 5) return;
    setBusy(true);
    setR(null);
    try {
      setR(await fetchJson<Result>("/api/amend-quick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }), timeoutMs: 120000 }));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const md = r && r.articles.length ? quickMarkdown(r.summary, r.articles) : "";
  const saveWord = () => {
    if (!r) return;
    const cell = (s: string) => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/&lt;br&gt;/g, "<br>");
    const rows = r.articles.map((a) => {
      const c = diffCells(a.current, a.amended);
      const head = a.label === "(조문)" ? "" : `${escapeHtml(a.label)} `;
      return `<tr><td>${head}${cell(c.old)}</td><td>${head}${cell(c.new)}</td></tr>`;
    });
    downloadWord("개정안", [
      { title: "1. 개정 이유 및 핵심 요약", body: r.summary },
      { title: "2. 개정 조문 전문", body: r.articles.map((a) => `${a.label === "(조문)" ? "" : `${a.label} `}${a.amended}`).join("\n") },
      { title: "3. 신·구조문대비표", html: `<table border="1" cellspacing="0" cellpadding="6"><tr><th>현 행</th><th>개 정 안</th></tr>${rows.join("")}</table>` },
    ]);
  };

  return (
    <section className="mb-6 rounded-2xl border border-sky-200 bg-sky-50/60 p-5 shadow-sm dark:border-sky-800 dark:bg-sky-900/10" aria-label="한 번에 개정">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-extrabold">
          <Sparkles className="h-4 w-4 text-accent" /> 한 번에 개정 — 조문을 붙여 넣고 “개정해줘”
        </p>
        <button type="button" onClick={() => setText(EXAMPLE)} className="rounded-full border bg-card px-2.5 py-0.5 text-[11px] font-semibold hover:border-accent hover:text-accent">
          예시 채우기
        </button>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">규정·조례·법령 조문을 붙여 넣고 끝에 “개정해줘”(또는 “○○를 ○○로 수정해줘”)라고 적으면, 상위법령을 확인해 개정 이유·개정 조문 전문·신·구조문대비표를 바로 만들어요.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder={"제5조(처리기간) ① 민원은 접수한 날부터 7일 안에 처리해야 한다.\n…\n개정해줘"} className="mt-2 w-full rounded-md border bg-card p-2.5 font-serif text-sm leading-6" aria-label="개정할 조문과 요청" />
      <Button variant="accent" className="mt-2 w-full sm:w-auto" onClick={run} disabled={busy || text.trim().length < 5}>
        <Sparkles /> 개정안 작성
      </Button>

      {busy && <LawLoader className="mt-4" message="상위법령을 확인하고 개정안을 쓰고 있어요" />}

      {r && (
        <div className="mt-4 space-y-4 rounded-xl border bg-card p-4">
          {!r.articles.length ? (
            <p className="text-sm">
              {r.rejected.length ? "AI가 쓴 개정안이 검증을 통과하지 못했어요. 개정 내용을 구체적으로 적어 다시 요청해 주세요." : "고칠 곳을 찾지 못했어요 — 이미 상위법 기준과 법제 문체에 맞는 조문이에요."}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  AI({r.label} · {r.model}) 작성 · 검증 통과 {r.articles.length}개 조문{r.unchanged ? ` · 고칠 곳 없는 조문 ${r.unchanged}개` : ""} — 담당자 확인 필요
                </p>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" onClick={async () => toast((await copyText(md)) ? "3가지 양식(마크다운)을 복사했어요" : "복사 실패")}>
                    <ClipboardCopy /> 마크다운 복사
                  </Button>
                  <Button size="sm" variant="outline" onClick={saveWord}>
                    <FileDown /> Word 저장
                  </Button>
                </div>
              </div>
              <div>
                <h3 className="text-sm font-extrabold">1. [개정 이유 및 핵심 요약]</h3>
                <p className="mt-1 text-sm leading-7">{r.summary}</p>
              </div>
              <div>
                <h3 className="text-sm font-extrabold">2. [개정 조문 전문]</h3>
                <pre className="law-text mt-1 whitespace-pre-wrap rounded-lg bg-secondary/50 p-3 font-serif text-sm leading-7">{r.articles.map((a) => `${a.label === "(조문)" ? "" : `${a.label} `}${a.amended}`).join("\n")}</pre>
              </div>
              <div>
                <h3 className="text-sm font-extrabold">3. [신·구조문대비표]</h3>
                <div className="mt-1 overflow-x-auto">
                  <table className="w-full min-w-[560px] border-collapse text-sm leading-7">
                    <thead>
                      <tr className="bg-secondary/70">
                        <th className="w-1/2 border px-3 py-1.5 text-left">현행</th>
                        <th className="w-1/2 border px-3 py-1.5 text-left">개정안</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.articles.map((a) => {
                        const c = diffCells(a.current, a.amended);
                        const head = a.label === "(조문)" ? "" : `${a.label} `;
                        return (
                          <tr key={a.label} className="align-top">
                            <td className="border px-3 py-2 font-serif">
                              {head}
                              <Cell md={c.old} />
                            </td>
                            <td className="border px-3 py-2 font-serif">
                              {head}
                              <Cell md={c.new} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
          {(r.rejected.length > 0 || r.articles.some((a) => a.warnings.length) || r.upper.length > 0) && (
            <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
              {r.rejected.map((x) => (
                <p key={x.label} className="text-amber-800 dark:text-amber-300">△ {x.label}: 검증에 걸려 현행 유지 — {x.reason}</p>
              ))}
              {r.articles.flatMap((a) => a.warnings.map((w, i) => <p key={a.label + i} className="text-amber-800 dark:text-amber-300">! {a.label}: {w}</p>))}
              {r.upper.length > 0 && <p>참고한 상위 조문(국가법령정보): {r.upper.join(" · ")}</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
