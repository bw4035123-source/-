"use client";
import { DocSaveButtons } from "@/components/ui/doc-save";
import * as React from "react";
import { ClipboardCopy, FileStack, Printer, RefreshCw } from "lucide-react";
import type { RegDocs, ReportProfile } from "@/lib/reg-report";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

import { copyRich, copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

// 검토 보고서 한 번에 작성(document-pack)과 같은 저장 키 — 부서·담당자를 한 번만 적으면 됨
const PROFILE_KEY = "law-for-all:officer-profile:v1";
type Profile = { dept: string; author: string; phone: string };
const loadProfile = (): Profile => {
  try {
    return { dept: "", author: "", phone: "", ...JSON.parse(localStorage.getItem(PROFILE_KEY) ?? "{}") };
  } catch {
    return { dept: "", author: "", phone: "" };
  }
};

/**
 * 보고서 바로 만들기 — 자체규정 점검·개정·제정 결과로 결재용 보고서·기안문·붙임(점검표·신구조문대비표)을 만들어
 * 고쳐 쓰고 복사·Word(한글 호환)·인쇄. 문서 조립은 lib/reg-report.ts(검증된 결과만 서식에 배치).
 */
export function RegReportPack({ build, label = "보고서 바로 만들기", disabled, className, size = "sm", variant = "accent" }: { build: (o: ReportProfile) => RegDocs; label?: string; disabled?: boolean; className?: string; size?: "sm" | "default" | "lg"; variant?: "accent" | "outline" }) {
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [profile, setProfile] = React.useState<Profile>({ dept: "", author: "", phone: "" });
  const [title, setTitle] = React.useState("");
  const [docs, setDocs] = React.useState<RegDocs | null>(null);
  const [text, setText] = React.useState({ report: "", draft: "" });
  const [tab, setTab] = React.useState("report");

  const make = (p: Profile, t?: string) => {
    const d = build({ dept: p.dept || undefined, author: p.author || undefined, phone: p.phone || undefined, title: t || undefined });
    setDocs(d);
    setTitle(d.title);
    setText({ report: d.report, draft: d.draft });
  };
  const start = () => {
    const p = loadProfile();
    setProfile(p);
    make(p);
    setTab("report");
    setOpen(true);
  };
  const regenerate = () => {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch {
      /* 저장 불가 환경 */
    }
    make(profile, title);
    toast("입력한 정보로 다시 만들었어요");
  };
  const copy = async (t: string, m: string) => toast((await copyText(t)) ? m : "복사하지 못했어요");
  const reportSections = () => (docs ? [{ body: text.report }, ...docs.attachments.map((a) => ({ title: a.title, html: a.html }))] : []);
  const print = () => {
    if (!docs) return;
    const w = window.open("", "_blank");
    if (!w) return toast("팝업이 차단되어 인쇄 창을 열 수 없어요");
    const body = tab === "draft" ? `<pre>${esc(text.draft)}</pre>` : tab === "attach" ? docs.attachments.map((a) => `<h3>${esc(a.title)}</h3>${a.html}`).join("") : `<pre>${esc(text.report)}</pre>`;
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:'Malgun Gothic',sans-serif;font-size:11pt;line-height:1.7}pre{white-space:pre-wrap;font-family:inherit}table{border-collapse:collapse;width:100%}td,th{border:1px solid #333;padding:6pt;vertical-align:top;font-size:10pt}th{background:#eee}</style>${body}`);
    w.document.close();
    w.print();
  };
  const field = (k: keyof Profile, l: string, ph: string) => (
    <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
      {l}
      <input value={profile[k]} onChange={(e) => setProfile({ ...profile, [k]: e.target.value })} placeholder={ph} className="h-9 rounded-md border bg-card px-2.5 text-sm font-normal text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
    </label>
  );

  return (
    <>
      <Button size={size} variant={variant} onClick={start} disabled={disabled} className={className}>
        <FileStack /> {label}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-4xl" aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <FileStack className="h-5 w-5 text-accent" /> 보고서 바로 만들기
            </SheetTitle>
            <SheetDescription>화면의 검토 결과로 결재용 보고서·기안문·붙임(표)을 만들었어요. 고쳐 쓴 뒤 복사하거나 한글·Word 파일로 내려받으세요.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            <div className="grid gap-3 rounded-xl border bg-secondary/40 p-3 sm:grid-cols-4">
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground sm:col-span-4">
                제목
                <input value={title} onChange={(e) => setTitle(e.target.value)} className="h-9 rounded-md border bg-card px-2.5 text-sm font-normal text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
              </label>
              {field("dept", "부서", "예: 경영지원팀")}
              {field("author", "담당자", "예: 홍길동")}
              {field("phone", "연락처", "예: 02-000-0000")}
              <div className="flex items-end">
                <Button variant="outline" size="sm" className="w-full" onClick={regenerate}>
                  <RefreshCw /> 다시 만들기
                </Button>
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-4">부서·담당자 정보는 이 브라우저에만 저장돼요. 보고서는 화면의 결과(판정·근거·신구대비·개정이유)만 서식에 옮겨 쓴 것으로, AI가 새 내용을 지어내지 않아요.</p>
            </div>

            {docs && (
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList>
                  <TabsTrigger value="report">결재 보고서</TabsTrigger>
                  <TabsTrigger value="draft">기안문</TabsTrigger>
                  <TabsTrigger value="attach">붙임 ({docs.attachments.length})</TabsTrigger>
                </TabsList>
                {(["report", "draft"] as const).map((k) => (
                  <TabsContent key={k} value={k} className="space-y-2">
                    <textarea value={text[k]} onChange={(e) => setText({ ...text, [k]: e.target.value })} rows={22} className="w-full rounded-xl border bg-card p-4 font-mono text-[13px] leading-6 focus:outline-none focus:ring-2 focus:ring-ring" aria-label={k === "report" ? "결재 보고서" : "기안문"} />
                  </TabsContent>
                ))}
                <TabsContent value="attach" className="space-y-4">
                  {docs.attachments.map((a) => (
                    <div key={a.title} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-bold">{a.title}</p>
                        <Button size="sm" variant="outline" onClick={async () => toast((await copyRich(a.html, a.html.replace(/<br>/g, "\n").replace(/<\/(td|th)>/g, "\t").replace(/<\/tr>/g, "\n").replace(/<[^>]+>/g, ""))) ? "표를 복사했어요 — 한글·Word에 붙이면 표로 들어가요" : "복사 실패")}>
                          <ClipboardCopy /> 표 복사
                        </Button>
                      </div>
                      {/* 붙임 HTML은 lib/reg-report.ts 가 모든 글자를 이스케이프해 만든 표 */}
                      <div className={cn("reg-attach overflow-x-auto rounded-xl border bg-card p-3 text-sm leading-6 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:p-2 [&_td]:align-top [&_th]:border [&_th]:bg-secondary [&_th]:p-2 [&_u]:font-bold [&_u]:text-sky-800 [&_s]:text-rose-700 dark:[&_u]:text-sky-300")} dangerouslySetInnerHTML={{ __html: a.html }} />
                    </div>
                  ))}
                </TabsContent>
              </Tabs>
            )}
          </div>
          {/* 저장은 [이름 | 한글 | Word] 한 덩어리 — 휴대폰은 한 줄씩, 복사·인쇄는 반반 */}
          <div className="grid gap-2 border-t p-4 sm:flex sm:flex-wrap sm:items-center">
            <DocSaveButtons name={title} sections={reportSections} label="보고서+붙임" size="default" />
            <DocSaveButtons name={`${title} (기안문)`} sections={() => [{ body: text.draft }]} label="기안문" size="default" />
            <div className="grid grid-cols-2 gap-2 sm:ml-auto sm:flex">
              <Button variant="outline" onClick={() => copy(tab === "draft" ? text.draft : text.report, tab === "draft" ? "기안문을 복사했어요" : "보고서를 복사했어요")}>
                <ClipboardCopy /> {tab === "draft" ? "기안문" : "보고서"} 복사
              </Button>
              <Button variant="outline" onClick={print}>
                <Printer /> 인쇄
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
