"use client";
import * as React from "react";
import { ClipboardCopy, FileDown, FileStack, Loader2, Printer, RefreshCw } from "lucide-react";
import type { AskResult } from "@/lib/answer/types";
import type { CaseItem } from "@/lib/law-api/types";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { attachmentArticles, civilReply, defaultTitle, draftDocument, reviewReport } from "@/lib/documents";
import { downloadWord } from "@/lib/word-export";
import { copyText } from "@/lib/clipboard";
import { fetchJson } from "@/lib/fetch-json";

const PROFILE_KEY = "law-for-all:officer-profile:v1";
type Profile = { dept: string; author: string; phone: string };
const DOCS = [
  { id: "report", label: "검토 보고서" },
  { id: "draft", label: "기안문" },
  { id: "reply", label: "민원 회신문" },
  { id: "attach", label: "붙임(조문 원문)" },
] as const;
type DocId = (typeof DOCS)[number]["id"];

function loadProfile(): Profile {
  try {
    return { dept: "", author: "", phone: "", ...JSON.parse(localStorage.getItem(PROFILE_KEY) ?? "{}") };
  } catch {
    return { dept: "", author: "", phone: "" };
  }
}

/** 공직자 실무: 검토 보고서·기안문·민원 회신문·붙임을 한 번에 작성(편집·복사·Word·인쇄) */
export function DocumentPack({ result }: { result: AskResult }) {
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [profile, setProfile] = React.useState<Profile>({ dept: "", author: "", phone: "" });
  const [title, setTitle] = React.useState(defaultTitle(result));
  const [cases, setCases] = React.useState<CaseItem[] | null>(null);
  const [texts, setTexts] = React.useState<Record<DocId, string> | null>(null);
  const [tab, setTab] = React.useState<DocId>("report");

  React.useEffect(() => setProfile(loadProfile()), []);

  const generate = React.useCallback(
    (cs: CaseItem[] | null, p: Profile, t: string) => {
      const o = { dept: p.dept || undefined, author: p.author || undefined, phone: p.phone || undefined, title: t, cases: cs ?? undefined };
      setTexts({ report: reviewReport(result, o), draft: draftDocument(result, o), reply: civilReply(result, o), attach: attachmentArticles(result) });
    },
    [result],
  );

  const start = () => {
    setOpen(true);
    generate(cases, profile, title);
    // 관련 판례를 붙여 넣기 위해 조회(실패·미연동이면 판례 없이 작성)
    if (cases === null && result.caseQuery) {
      fetchJson<{ cases: CaseItem[] }>(`/api/cases?q=${encodeURIComponent(result.caseQuery)}&limit=5`, { timeoutMs: 20000 })
        .then((j) => {
          const prec = j.cases.filter((c) => c.kind === "판례").slice(0, 3);
          setCases(prec);
          if (prec.length) generate(prec, profile, title);
        })
        .catch(() => setCases([]));
    }
  };

  const regenerate = () => {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch {
      /* 저장 불가 환경 */
    }
    generate(cases, profile, title);
    toast("입력한 정보로 문서를 다시 작성했습니다");
  };

  const copy = async (t: string, m: string) => toast((await copyText(t)) ? m : "복사하지 못했습니다");
  const print = (t: string) => {
    const w = window.open("", "_blank");
    if (!w) return toast("팝업이 차단되어 인쇄 창을 열 수 없습니다");
    const pre = w.document.createElement("pre");
    pre.textContent = t;
    pre.style.cssText = "white-space:pre-wrap;font-family:'Malgun Gothic',sans-serif;font-size:11pt;line-height:1.7";
    w.document.title = title;
    w.document.body.appendChild(pre);
    w.print();
  };

  const field = (k: keyof Profile, label: string, ph: string) => (
    <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
      {label}
      <input value={profile[k]} onChange={(e) => setProfile({ ...profile, [k]: e.target.value })} placeholder={ph} className="h-9 rounded-md border bg-card px-2.5 text-sm font-normal text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
    </label>
  );

  return (
    <>
      <Button variant="accent" onClick={start}>
        <FileStack /> 보고서 한 번에 작성
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-4xl" aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <FileStack className="h-5 w-5 text-accent" /> 실무 문서 한 번에 작성
            </SheetTitle>
            <SheetDescription>검토 결과와 근거 조문 원문으로 검토 보고서·기안문·민원 회신문·붙임을 만들었어요. 내용을 고쳐 쓴 뒤 복사하거나 Word(한글 호환)로 내려받으세요.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            <div className="grid gap-3 rounded-xl border bg-secondary/40 p-3 sm:grid-cols-4">
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground sm:col-span-4">
                제목
                <input value={title} onChange={(e) => setTitle(e.target.value)} className="h-9 rounded-md border bg-card px-2.5 text-sm font-normal text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
              </label>
              {field("dept", "부서", "예: 민원정책과")}
              {field("author", "담당자", "예: 홍길동")}
              {field("phone", "연락처", "예: 02-000-0000")}
              <div className="flex items-end">
                <Button variant="outline" size="sm" className="w-full" onClick={regenerate}>
                  <RefreshCw /> 다시 작성
                </Button>
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-4">
                {cases === null && result.caseQuery ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> 관련 판례를 찾아 보고서에 넣는 중…
                  </span>
                ) : cases?.length ? (
                  `관련 판례 ${cases.length}건을 검토 보고서에 넣었어요.`
                ) : (
                  "관련 판례 없이 작성했어요(인증키 미설정이거나 검색 결과 없음)."
                )}{" "}
                부서·담당자 정보는 이 브라우저에만 저장돼요.
              </p>
            </div>

            {texts && (
              <Tabs value={tab} onValueChange={(v) => setTab(v as DocId)}>
                <TabsList>
                  {DOCS.map((d) => (
                    <TabsTrigger key={d.id} value={d.id}>
                      {d.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {DOCS.map((d) => (
                  <TabsContent key={d.id} value={d.id} className="space-y-2">
                    <textarea
                      value={texts[d.id]}
                      onChange={(e) => setTexts({ ...texts, [d.id]: e.target.value })}
                      aria-label={d.label}
                      spellCheck={false}
                      className="h-[52vh] w-full resize-y rounded-xl border bg-card p-4 font-mono text-[0.85rem] leading-6 focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="accent" onClick={() => copy(texts[d.id], `${d.label}을(를) 복사했습니다`)}>
                        <ClipboardCopy /> 복사
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => downloadWord(`${title}_${d.label}`, [{ body: texts[d.id] }])}>
                        <FileDown /> Word로 저장
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => print(texts[d.id])}>
                        <Printer /> 인쇄
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto"
                        onClick={() => downloadWord(title, DOCS.map((x) => ({ title: x.label, body: texts[x.id] })))}
                      >
                        <FileStack /> 4종 한 파일로 저장
                      </Button>
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
            )}
            <p className="text-xs leading-5 text-muted-foreground">※ AI가 근거 조문으로 만든 초안입니다. 결재 전 사실관계·수치·서식을 반드시 확인하세요.</p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
