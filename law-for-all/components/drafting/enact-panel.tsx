"use client";
import * as React from "react";
import { AlertTriangle, CheckCircle2, ClipboardCopy, FileDown, Info, Plus, X } from "lucide-react";
import type { LawDoc, LawSummary } from "@/lib/law-api/types";
import { articleLabel } from "@/lib/law-api/util";
import type { DraftKind } from "@/lib/drafting";
import { enactDraft, type Basis } from "@/lib/enact";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import { downloadWord } from "@/lib/word-export";
import { cn } from "@/lib/utils";

type Hier = { root: LawDoc; children: LawDoc[] };
const inputCls = "h-10 w-full rounded-md border bg-card px-2.5 text-sm";

// 예시: 공공기관 직원이 실제로 만드는 내부 지침(근거 조문은 내장 공식 원문에서 불러옴)
const EXAMPLE = {
  name: "○○공단 외부강의등 신고 처리 지침",
  kind: "행정규칙" as DraftKind,
  org: "○○공단",
  purpose: "직원의 외부강의등 신고 절차와 초과사례금 처리 기준을 정하기 위함",
  items: "신고 절차\n사례금 상한 확인\n초과사례금 반환\n운영 점검",
  terms: "외부강의등",
  basis: { lawId: "anti-graft", no: "10" },
};

/** 규정 제정 지원: 제정 목적·상위법 위임 조항·담을 내용 → 조문 체계·표준 조문 초안·위임 사항 대조·제정이유·입법예고문 */
export function EnactPanel({ laws }: { laws: LawSummary[] }) {
  const toast = useToast();
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<DraftKind>("행정규칙");
  const [org, setOrg] = React.useState("");
  const [purpose, setPurpose] = React.useState("");
  const [items, setItems] = React.useState("");
  const [terms, setTerms] = React.useState("");
  const [basis, setBasis] = React.useState<Basis[]>([]);
  const [dept, setDept] = React.useState("");
  const [days, setDays] = React.useState(0);
  // 근거 조문 고르기
  const [lawId, setLawId] = React.useState("");
  const [no, setNo] = React.useState("");
  const [hier, setHier] = React.useState<Hier | null>(null);
  const [own, setOwn] = React.useState({ label: "", text: "" });

  const loadLaw = React.useCallback(async (id: string): Promise<Hier | null> => {
    if (!id) return null;
    try {
      const j = await (await fetch(`/api/laws/${encodeURIComponent(id)}`)).json();
      return j.root ? j : null;
    } catch {
      return null;
    }
  }, []);

  React.useEffect(() => {
    let alive = true;
    setHier(null);
    loadLaw(lawId).then((h) => alive && setHier(h));
    return () => {
      alive = false;
    };
  }, [lawId, loadLaw]);

  const all = hier ? [hier.root, ...hier.children] : [];
  const law = all.find((l) => l.id === lawId) ?? hier?.root ?? null;
  const addBasis = (b: Basis) => setBasis((v) => (v.some((x) => x.label === b.label) ? v : [...v, b]));
  const addSelected = () => {
    const a = law?.articles.find((x) => x.no === no);
    if (!law || !a) return;
    addBasis({ label: `「${law.name}」 ${articleLabel(a.no)}(${a.title})`, text: a.text });
    setNo("");
  };

  const fillExample = async () => {
    setName(EXAMPLE.name);
    setKind(EXAMPLE.kind);
    setOrg(EXAMPLE.org);
    setPurpose(EXAMPLE.purpose);
    setItems(EXAMPLE.items);
    setTerms(EXAMPLE.terms);
    const h = await loadLaw(EXAMPLE.basis.lawId);
    const a = h?.root.articles.find((x) => x.no === EXAMPLE.basis.no);
    setBasis(h && a ? [{ label: `「${h.root.name}」 ${articleLabel(a.no)}(${a.title})`, text: a.text }] : []);
    toast("예시를 채웠어요. 내용을 바꾸면 초안이 바로 다시 만들어져요");
  };

  const ready = !!(name.trim() || purpose.trim() || basis.length);
  const d = React.useMemo(
    () =>
      enactDraft({
        kind,
        name,
        purpose,
        items: items.split("\n"),
        terms: terms.split(/[,，\n]/),
        basis,
        org: org || undefined,
        dept: dept || undefined,
        effectiveDays: days,
      }),
    [kind, name, purpose, items, terms, basis, org, dept, days],
  );
  const docs = [
    { id: "reason", label: "제정이유·주요내용", body: d.reason },
    { id: "notice", label: "입법예고문", body: d.notice },
    { id: "steps", label: "절차 체크리스트", body: d.steps.map((s, i) => `□ ${i + 1}. ${s}`).join("\n") },
  ];
  const exportAll = () => downloadWord(`${name.trim() || "제정안"} 제정안`, [{ title: "제정안", body: d.fullText }, ...docs.map((x) => ({ title: x.label, body: x.body }))]);
  const lawGroups = laws.filter((l) => !l.parentId);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <section className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm" aria-label="제정 정보 입력">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-bold">① 제정할 규정</p>
          <button type="button" onClick={fillExample} className="rounded-full border bg-secondary/60 px-2.5 py-0.5 text-[11px] font-semibold hover:border-accent hover:text-accent">
            예시 채우기
          </button>
        </div>
        <div className="grid gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="규정명 (예: ○○공단 재택근무 운영 지침)" className={inputCls} aria-label="규정명" />
          <div className="grid grid-cols-2 gap-2">
            <select value={kind} onChange={(e) => setKind(e.target.value as DraftKind)} className={inputCls} aria-label="규범 종류">
              <option value="행정규칙">훈령·예규·내부 규정</option>
              <option value="자치법규">조례·규칙(자치법규)</option>
              <option value="법령">법령</option>
            </select>
            <input value={org} onChange={(e) => setOrg(e.target.value)} placeholder="기관명 (예: ○○공단)" className={inputCls} aria-label="기관명" />
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-bold">② 제정 목적</p>
          <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={2} placeholder="예) 직원의 재택근무 신청·승인과 복무 관리 기준을 정하기 위함" className="w-full rounded-md border bg-card p-2.5 text-sm leading-6" aria-label="제정 목적" />
        </div>

        <div>
          <p className="mb-2 text-sm font-bold">③ 상위법 근거·위임 조항</p>
          <div className="grid gap-2">
            <select value={lawId} onChange={(e) => { setLawId(e.target.value); setNo(""); }} className={inputCls} aria-label="근거 법령 선택">
              <option value="">법령을 선택하세요</option>
              {lawGroups.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <select value={no} onChange={(e) => setNo(e.target.value)} disabled={!law} className={cn(inputCls, "min-w-0 flex-1 disabled:opacity-50")} aria-label="근거 조문 선택">
                <option value="">{lawId && !law ? "불러오는 중…" : "조문을 선택하세요"}</option>
                {law?.articles.map((a) => (
                  <option key={a.no} value={a.no}>
                    {articleLabel(a.no)}({a.title})
                  </option>
                ))}
              </select>
              <Button type="button" variant="outline" onClick={addSelected} disabled={!no}>
                <Plus /> 추가
              </Button>
            </div>
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-accent">목록에 없는 조문 직접 입력</summary>
              <div className="mt-2 grid gap-2">
                <input value={own.label} onChange={(e) => setOwn({ ...own, label: e.target.value })} placeholder="「○○법」 제○조(제목)" className={inputCls} />
                <textarea value={own.text} onChange={(e) => setOwn({ ...own, text: e.target.value })} rows={3} placeholder="조문 원문을 붙여 넣으세요 (위임 문구를 찾아 조문으로 배정해요)" className="rounded-md border bg-card p-2.5 text-sm leading-6" />
                <Button type="button" size="sm" variant="outline" disabled={!own.label.trim()} onClick={() => { addBasis({ label: own.label.trim(), text: own.text }); setOwn({ label: "", text: "" }); }}>
                  <Plus /> 근거 조문 추가
                </Button>
              </div>
            </details>
            {basis.length > 0 && (
              <ul className="space-y-1">
                {basis.map((b) => (
                  <li key={b.label} className="flex items-start justify-between gap-2 rounded-lg bg-secondary/60 px-2.5 py-1.5 text-xs">
                    <span className="font-semibold">{b.label}</span>
                    <button type="button" onClick={() => setBasis((v) => v.filter((x) => x.label !== b.label))} aria-label={`${b.label} 빼기`} className="text-muted-foreground hover:text-foreground">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-bold">④ 담을 내용 <span className="font-normal text-muted-foreground">(한 줄에 하나 · 비우면 위임 사항으로)</span></p>
          <textarea value={items} onChange={(e) => setItems(e.target.value)} rows={4} placeholder={"예) 신청 절차\n승인 및 취소\n근무 시간\n정보 보안"} className="w-full rounded-md border bg-card p-2.5 text-sm leading-6" aria-label="담을 내용" />
          <input value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="정의할 용어 (쉼표로 구분, 예: 재택근무, 원격근무)" className={cn(inputCls, "mt-2")} aria-label="정의할 용어" />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
            소관 부서
            <input value={dept} onChange={(e) => setDept(e.target.value)} placeholder="○○과" className="h-9 rounded-md border bg-card px-2 text-sm font-normal text-foreground" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
            시행 시기
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-9 rounded-md border bg-card px-2 text-sm font-normal text-foreground">
              <option value={0}>공포(발령)한 날부터</option>
              <option value={30}>공포 후 30일</option>
              <option value={90}>공포 후 3개월</option>
            </select>
          </label>
        </div>
      </section>

      <section className="min-w-0 space-y-5" aria-label="제정안과 검토 결과">
        {!ready ? (
          <div className="grid min-h-[300px] place-items-center rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            <div>
              <p className="font-semibold text-foreground">규정명·제정 목적·근거 조문을 넣으면 조문 체계와 제정안 초안이 바로 만들어져요.</p>
              <p className="mt-1">처음이라면 왼쪽 위 ‘예시 채우기’를 눌러 보세요.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="rounded-2xl border bg-card p-5 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-extrabold">조문 체계 · 제정안 초안</h2>
                <Button size="sm" variant="outline" onClick={async () => toast((await copyText(d.fullText)) ? "제정안을 복사했습니다" : "복사 실패")}>
                  <ClipboardCopy /> 제정안 복사
                </Button>
              </div>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {d.articles.map((a) => (
                  <Badge key={a.label} variant="secondary">
                    {a.label}
                  </Badge>
                ))}
                <Badge variant="secondary">부칙</Badge>
              </div>
              <pre className="law-text max-h-[55vh] overflow-y-auto whitespace-pre-wrap rounded-xl bg-secondary/50 p-4 font-serif text-sm leading-7">{d.fullText}</pre>
            </div>

            {(d.delegated.length > 0 || d.limits.length > 0) && (
              <div className="rounded-2xl border bg-card p-5 shadow-sm">
                <h2 className="mb-3 font-extrabold">상위법 대조</h2>
                {d.delegated.length > 0 && (
                  <>
                    <p className="mb-1 text-xs font-bold text-muted-foreground">이 {d.unit}에 맡긴 사항(위임 사항)</p>
                    <ul className="mb-3 space-y-1 text-sm">
                      {d.delegated.map((x) => (
                        <li key={x.basis + x.matter} className="flex items-start gap-2">
                          {x.covered ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
                          <span>
                            {x.matter} <span className="text-xs text-muted-foreground">— {x.basis} · {x.covered ? "조문에 반영" : "조문 없음"}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {d.limits.length > 0 && (
                  <>
                    <p className="mb-1 text-xs font-bold text-muted-foreground">상위 조문의 기한·금액 기준(초안 수치를 맞출 때 참고)</p>
                    <ul className="space-y-0.5 text-sm">
                      {d.limits.map((l) => (
                        <li key={l}>· {l}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            <div className="rounded-2xl border bg-card p-5 shadow-sm">
              <h2 className="mb-3 font-extrabold">정합성 점검</h2>
              <ul className="space-y-2">
                {d.checks.map((c, i) => {
                  const Icon = c.level === "warn" ? AlertTriangle : c.level === "ok" ? CheckCircle2 : Info;
                  return (
                    <li key={i} className={cn("flex gap-2 rounded-lg p-3 text-sm", c.level === "warn" ? "bg-amber-50 text-amber-950 dark:bg-amber-900/20 dark:text-amber-100" : c.level === "ok" ? "bg-emerald-50 text-emerald-950 dark:bg-emerald-900/20 dark:text-emerald-100" : "bg-secondary/60")}>
                      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      <span>
                        <strong>{c.title}</strong> — {c.detail}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="rounded-2xl border bg-card p-5 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-extrabold">제정 문서 초안</h2>
                <Button size="sm" variant="accent" onClick={exportAll}>
                  <FileDown /> 제정안 포함 전체 Word 저장
                </Button>
              </div>
              <Tabs defaultValue="reason">
                <TabsList>
                  {docs.map((x) => (
                    <TabsTrigger key={x.id} value={x.id}>
                      {x.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {docs.map((x) => (
                  <TabsContent key={x.id} value={x.id} className="space-y-2">
                    <pre className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded-xl bg-secondary/50 p-4 text-sm leading-7">{x.body}</pre>
                    <Button size="sm" variant="outline" onClick={async () => toast((await copyText(x.body)) ? `${x.label}을(를) 복사했습니다` : "복사 실패")}>
                      <ClipboardCopy /> 복사
                    </Button>
                  </TabsContent>
                ))}
              </Tabs>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">※ 법제 표준 문형으로 자동 조립한 초안입니다. ○○ 표시를 기관 실정에 맞게 채우고, 상위법 위임 범위·관계 부서 의견을 반영해 확정하세요.</p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
