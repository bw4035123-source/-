"use client";
import * as React from "react";
import { AlertTriangle, ClipboardCopy, Info, ListOrdered } from "lucide-react";
import { renumber, type RefFix } from "@/lib/renumber";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

// 가상 기관 규정(모의데이터) — 같은 규정 안 인용, 다른 법령 인용, 없는 조문 인용이 섞여 있음
const EXAMPLE = `○○공단 민원 처리 규정(모의데이터)
제1조(목적) 이 규정은 ○○공단의 민원 처리에 필요한 사항을 정함을 목적으로 한다.
제2조(정의) 이 규정에서 "민원"이란 「민원 처리에 관한 법률」 제2조제1호에 따른 민원을 말한다.
제3조(접수) ① 민원은 제4조에 따른 신청서로 접수한다.
② 제5조제1항에 따른 처리기간은 접수한 날부터 계산한다.
제4조(신청서) 민원 신청서는 별지 제1호서식에 따른다.
제5조(처리기간) ① 질의민원은 7일 이내에 처리한다.
② 제1항에도 불구하고 법 제17조에 따른 처리기간이 있으면 그에 따른다.
제6조(이의신청) 제5조에 따른 처리 결과에 이의가 있는 사람은 제9조에 따라 이의신청을 할 수 있다.
제7조(위임) 이 규정의 시행에 필요한 사항은 이사장이 정한다.`;

function FixList({ title, items, tone }: { title: string; items: RefFix[]; tone: "ok" | "warn" | "info" }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-bold text-muted-foreground">
        {title} {items.length}건
      </p>
      <ul className="space-y-1.5">
        {items.map((f, i) => (
          <li key={i} className={cn("rounded-lg p-2.5 text-sm", tone === "warn" ? "bg-amber-50 text-amber-950 dark:bg-amber-900/20 dark:text-amber-100" : tone === "ok" ? "bg-sky-50 dark:bg-sky-900/20" : "bg-secondary/60")}>
            <p>
              <strong>{f.where}</strong> · {f.from} {f.to !== f.from && <>→ <strong>{f.to}</strong></>}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{f.context}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 조 번호 정리: 조문 신설·삭제로 번호가 바뀔 때 같은 규정 안의 인용 정정 대상을 모두 찾고 정정 전문을 만든다 */
export function RenumberPanel() {
  const toast = useToast();
  const [text, setText] = React.useState("");
  const [type, setType] = React.useState<"insert" | "delete">("insert");
  const [no, setNo] = React.useState(4);
  const r = React.useMemo(() => (text.trim() ? renumber(text, type === "insert" ? { type, at: no } : { type, no }) : null), [text, type, no]);
  const found = r && r.articles.length > 0;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <section className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm" aria-label="규정 전문과 변경">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-bold">① 규정 전문</p>
          <button type="button" onClick={() => setText(EXAMPLE)} className="rounded-full border bg-secondary/60 px-2.5 py-0.5 text-[11px] font-semibold hover:border-accent hover:text-accent">
            예시 채우기
          </button>
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} placeholder={"규정 전문을 붙여 넣으세요.\n제1조(목적) …\n제2조(정의) …"} className="w-full rounded-md border bg-card p-2.5 font-serif text-sm leading-6" aria-label="규정 전문" />
        <div>
          <p className="mb-2 text-sm font-bold">② 바꿀 내용</p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>제</span>
            <input type="number" min={1} value={no} onChange={(e) => setNo(Math.max(1, Number(e.target.value) || 1))} className="h-10 w-20 rounded-md border bg-card px-2 text-sm" aria-label="조 번호" />
            <span>조를</span>
            <select value={type} onChange={(e) => setType(e.target.value as "insert" | "delete")} className="h-10 rounded-md border bg-card px-2 text-sm" aria-label="신설 또는 삭제">
              <option value="insert">새로 넣기(뒤 조문 번호가 밀림)</option>
              <option value="delete">삭제하기(뒤 조문 번호가 당겨짐)</option>
            </select>
          </div>
          <p className="mt-2 flex gap-1.5 text-xs leading-5 text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> 가지번호(제4조의2)로 넣거나 ‘제4조 삭제’로 자리를 남기면 번호가 바뀌지 않아 인용 정정이 필요 없어요. 번호를 바꿔야 할 때 이 기능으로 고칠 곳을 한 번에 찾으세요.
          </p>
        </div>
      </section>

      <section className="min-w-0 space-y-5" aria-label="인용 정정 결과">
        {!r ? (
          <div className="grid min-h-[300px] place-items-center rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            <div>
              <ListOrdered className="mx-auto h-9 w-9 text-accent/60" />
              <p className="mt-3 font-semibold text-foreground">규정 전문을 붙여 넣고 신설·삭제할 조를 고르면, 고쳐야 할 인용을 모두 찾아 드려요.</p>
              <p className="mt-1">‘예시 채우기’로 바로 체험할 수 있어요.</p>
            </div>
          </div>
        ) : !found ? (
          <div className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">조문 머리(‘제1조(목적)’처럼 줄 맨 앞의 조 번호)를 찾지 못했어요. 조문마다 줄을 바꿔 붙여 넣어 주세요.</div>
        ) : (
          <>
            <div className="rounded-2xl border bg-card p-5 shadow-sm">
              <h2 className="mb-1 font-extrabold">고칠 곳</h2>
              <p className="mb-3 text-xs text-muted-foreground">
                조문 {r.articles.length}개 · 번호가 바뀌는 조문 {r.headingChanges.length}개 · 같은 규정 안 인용 정정 {r.fixes.length}건 · 다른 법령 인용(「…」 제N조, 법 제N조)은 건드리지 않음 · ‘어디’는 정정 전 번호
              </p>
              <div className="space-y-4">
                <FixList title="인용 번호 정정" items={r.fixes} tone="ok" />
                <FixList title="삭제되는 조문을 가리키는 인용(내용 정비 필요)" items={r.dangling} tone="warn" />
                <FixList title="지금도 없는 조문을 가리키는 인용(기존 오류)" items={r.broken} tone="warn" />
                {!r.fixes.length && !r.dangling.length && !r.broken.length && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <AlertTriangle className="h-4 w-4" /> 고칠 인용이 없어요(번호가 바뀌는 조문을 가리키는 인용이 없음).
                  </p>
                )}
              </div>
            </div>
            <div className="rounded-2xl border bg-card p-5 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-extrabold">정정한 전문</h2>
                <Button size="sm" variant="outline" onClick={async () => toast((await copyText(r.text)) ? "정정한 전문을 복사했습니다" : "복사 실패")}>
                  <ClipboardCopy /> 복사
                </Button>
              </div>
              <pre className="law-text max-h-[55vh] overflow-y-auto whitespace-pre-wrap rounded-xl bg-secondary/50 p-4 font-serif text-sm leading-7">{r.text}</pre>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">※ 별표·별지 서식 번호, ‘같은 조’ 같은 표현과 다른 규정이 이 규정을 인용하는 부분은 자동으로 고치지 않으니 함께 확인하세요.</p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
