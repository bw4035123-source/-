"use client";
import * as React from "react";
import { AlertTriangle, ArrowRight, FileSearch, History, Info, Loader2, Replace, SearchX } from "lucide-react";
import { LawCombobox, type LawPick } from "./law-combobox";
import { WatchButton } from "@/components/officer-view/law-watch";
import { impactOn, type ImpactHit, type Part, type UpperChange } from "@/lib/upper-change";
import { fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { RegFileDrop } from "@/components/ui/reg-file-drop";
import { cn } from "@/lib/utils";

/** 개정 탭으로 넘길 내용(우리 규정 조문 + 개정 방향) */
export interface AmendHandoff {
  name: string;
  label: string;
  text: string;
  instruction: string;
  /** 개정 방향으로 바로 반영되지 않는 확인 사항(삭제·개정된 상위 조문 인용 등) */
  notes: string[];
  /** 개정이유에 쓸 근거 — 「근로기준법」 일부개정(2026. 4. 7. 공포, 2026. 10. 8. 시행) */
  basis: string;
}

// 가상 기관 규정(모의데이터) — 상위법 개정 전 용어·조문을 인용
const EXAMPLE = `○○시설관리공단 취업규칙(모의데이터)
제1조(목적) 이 규칙은 ○○시설관리공단 직원의 채용·복무·근로조건에 관한 사항을 정함을 목적으로 한다.
제12조(근로감독 대응) ① 공단은 근로감독관의 사업장 현장조사에 성실히 협조하여야 한다.
② 「근로기준법」 제102조에 따라 근로감독관이 서류의 제출을 요구하면 담당 부서는 지체 없이 제출한다.
제13조(신고자 보호) 「근로기준법」 제104조에 따라 위반 사실을 근로감독관에게 통보한 직원에게 해고나 그 밖에 불리한 처우를 하지 아니한다.
제20조(임금 지급) 임금은 「근로기준법」 제43조에 따라 매월 1회 이상 일정한 날짜를 정하여 지급한다.
제31조(직장 내 괴롭힘) 직장 내 괴롭힘이 발생한 경우 「근로기준법」 제76조의3에 따라 조사하고 조치한다.`;

function Marked({ parts, side }: { parts: Part[]; side: "old" | "new" }) {
  if (!parts.length) return <p className="text-sm text-muted-foreground">{side === "old" ? "<신설>" : "<삭제>"}</p>;
  return (
    <p className="whitespace-pre-wrap font-serif text-sm leading-7">
      {parts.map((p, i) =>
        !p.m ? (
          <span key={i}>{p.t}</span>
        ) : side === "old" ? (
          <del key={i} className="bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200">{p.t}</del>
        ) : (
          <ins key={i} className="bg-sky-100 font-semibold text-sky-900 underline dark:bg-sky-900/40 dark:text-sky-100">{p.t}</ins>
        ),
      )}
    </p>
  );
}

/** 우리 규정 조문에서 바뀌기 전 용어를 강조 */
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return (
    <>
      {text.split(re).map((s, i) => (terms.includes(s) ? <mark key={i} className="rounded bg-amber-200 px-0.5 dark:bg-amber-700/60">{s}</mark> : <span key={i}>{s}</span>))}
    </>
  );
}

export function UpperPanel({ onAmend, initialLaw }: { onAmend: (h: AmendHandoff) => void; initialLaw?: string }) {
  const toast = useToast();
  const [pickd, setPickd] = React.useState<LawPick | null>(initialLaw ? { name: initialLaw } : null);
  const name = pickd?.name ?? "";
  // 오른쪽 안내: 검색 결과 없음 / 최근 개정 내역 없음 / 조회 실패
  const [notice, setNotice] = React.useState<{ kind: "empty" | "no-history" | "error"; text: string } | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [data, setData] = React.useState<{ change: UpperChange; source: "live" | "snapshot"; warnings: string[] } | null>(null);
  const [showAll, setShowAll] = React.useState(false);
  const [reg, setReg] = React.useState("");
  const [hits, setHits] = React.useState<ImpactHit[] | null>(null);

  const load = async (p: LawPick | null = pickd) => {
    if (!p?.name.trim()) return;
    setLoading(true);
    setHits(null);
    setNotice(null);
    setData(null);
    try {
      const qs = new URLSearchParams({ name: p.name.trim(), ...(p.mst ? { mst: p.mst } : {}), ...(p.revision ? { revision: p.revision } : {}) });
      const j = await fetchJson<{ change: UpperChange; source: "live" | "snapshot"; warnings: string[] }>(`/api/law-changes?${qs}`, { timeoutMs: 40000 });
      setData(j);
      setShowAll(false);
    } catch (e) {
      const msg = (e as Error).message;
      setNotice({ kind: /가져오지 못했|연결|시간/.test(msg) ? "error" : "no-history", text: msg });
    } finally {
      setLoading(false);
    }
  };
  const onPick = (p: LawPick) => {
    setPickd(p);
    void load(p);
  };
  React.useEffect(() => {
    if (initialLaw) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const c = data?.change;
  const check = () => {
    if (!c || !reg.trim()) return;
    const h = impactOn(reg, c);
    setHits(h);
    toast(h.length ? `정비가 필요한 조문 ${h.length}개를 찾았어요` : "상위법 개정과 관련해 정비가 필요한 조문을 찾지 못했어요");
  };
  const regName = reg.trim().split("\n")[0]?.replace(/\(모의데이터\)$/, "").trim() || "(규정명)";
  const rows = c ? (showAll ? c.rows : c.rows.slice(0, 6)) : [];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      {/* 왼쪽: 상위법 선택 + 우리 규정 */}
      <section className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm" aria-label="상위법과 우리 규정">
        <div>
          <p className="mb-2 text-sm font-bold">① 개정된 상위법</p>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <LawCombobox value={name} onPick={onPick} onNoResult={(q) => { setData(null); setNotice({ kind: "empty", text: `‘${q}’(으)로 찾은 현행 법령이 없어요. 법령명이나 약칭을 다시 확인해 주세요(예: 청탁금지법 → 부정청탁 및 금품등 수수의 금지에 관한 법률).` }); }} />
            </div>
            <Button onClick={() => load()} disabled={loading || !name}>
              {loading ? <Loader2 className="animate-spin" /> : <History />} 개정 전후 보기
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">대한민국 모든 현행 법령을 국가법령정보 ‘법령 목록’에서 찾아, 고른 법령의 가장 최근 개정분 개정 전·후 조문(신구법 비교)을 가져와요.</p>
        </div>

        <div className={cn(!c && "pointer-events-none opacity-50")}>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-bold">② 우리 기관 규정 전문</p>
            <button type="button" onClick={() => { setReg(EXAMPLE); if (!pickd) onPick({ name: "근로기준법" }); }} className="rounded-full border bg-secondary/60 px-2.5 py-0.5 text-[11px] font-semibold hover:border-accent hover:text-accent">
              예시 채우기
            </button>
          </div>
          <RegFileDrop
            compact
            className="mb-2"
            hint="규정 전문을 이 브라우저에서 읽어요(서버로 보내지 않음)"
            onLoaded={({ info }) => {
              setReg(info.text.trim());
              const n = (info.text.match(/^\s*제\s*\d+\s*조/gm) ?? []).length;
              toast(`${info.format} 문서에서 ${n ? `조문 ${n}개를` : "내용을"} 불러왔어요 — ‘개정 영향 점검’을 누르세요`);
            }}
          />
          <textarea value={reg} onChange={(e) => setReg(e.target.value)} rows={9} placeholder={"규정 파일을 올리거나 전문을 붙여 넣으세요(첫 줄은 규정명).\n제1조(목적) …\n제2조(…) …"} className="w-full rounded-md border bg-card p-2.5 text-sm leading-6" aria-label="우리 기관 규정 전문" />
          <Button variant="accent" size="lg" className="mt-2 w-full" onClick={check} disabled={!c || c.noTable || !reg.trim()}>
            <FileSearch /> 개정 영향 점검
          </Button>
          <p className="mt-1.5 text-xs text-muted-foreground">바뀌기 전 용어를 쓰거나, 개정·삭제된 상위법 조문을 인용한 조문을 찾아요. 규정은 서버로 보내지 않고 이 화면에서만 대조해요.</p>
        </div>
      </section>

      {/* 오른쪽: 결과 */}
      <section className="min-w-0 space-y-5" aria-label="개정 전후 비교와 영향">
        {!c ? (
          <div className="grid min-h-[300px] place-items-center rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> 국가법령정보에서 「{name}」 개정 전후 조문을 가져오는 중…
              </span>
            ) : notice ? (
              <div className="max-w-md space-y-2" role="status">
                {notice.kind === "empty" ? <SearchX className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden /> : notice.kind === "error" ? <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" aria-hidden /> : <Info className="mx-auto h-8 w-8 text-accent" aria-hidden />}
                <p className="font-bold text-foreground">{notice.kind === "empty" ? "검색 결과가 없어요" : notice.kind === "error" ? "개정 전후 자료를 가져오지 못했어요" : "최근 개정 내역이 없어요"}</p>
                <p className="leading-6">{notice.text}</p>
                {notice.kind !== "empty" && name && (
                  <a href={`https://www.law.go.kr/lsSc.do?query=${encodeURIComponent(name)}`} target="_blank" rel="noreferrer" className="inline-block text-xs font-semibold text-accent underline">
                    국가법령정보센터에서 「{name}」 연혁 확인
                  </a>
                )}
              </div>
            ) : (
              "왼쪽 검색창에서 개정된 상위법을 찾아 고르세요. 고르면 바로 개정 전후 조문을 보여 드려요."
            )}
          </div>
        ) : (
          <>
            {hits && (
              <div className="rounded-2xl border bg-card p-5 shadow-sm">
                <h2 className="mb-1 font-extrabold">우리 규정 정비 대상 {hits.length}개 조문</h2>
                <p className="mb-3 text-xs text-muted-foreground">용어 변경은 개정 방향까지 채워 개정 화면으로 넘겨요(규칙으로 정확히 반영). 인용 조문 정비는 내용을 확인해 고쳐 주세요.</p>
                {!hits.length ? (
                  <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-950 dark:bg-emerald-900/20 dark:text-emerald-100">상위법 개정과 관련해 자동으로 찾을 수 있는 정비 대상이 없어요.</p>
                ) : (
                  <ul className="space-y-3">
                    {hits.map((h, i) => (
                      <li key={i} className="rounded-xl border p-3">
                        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                          <p className="font-bold">{h.article.label}</p>
                          <Button
                            size="sm"
                            variant={h.instruction ? "accent" : "outline"}
                            onClick={() =>
                              onAmend({
                                name: regName,
                                label: h.article.label,
                                text: h.article.text.replace(/^\s*제\s*\d+\s*조(?:\s*의\s*\d+)?\s*(?:\([^)]*\))?\s*/, ""),
                                instruction: h.instruction,
                                notes: h.reasons.filter((r) => r.kind !== "용어").map((r) => r.detail),
                                basis: `「${c.law}」 ${c.after.type}(${c.after.promulgated} 공포, ${c.after.effective} 시행)`,
                              })
                            }
                          >
                            {h.instruction ? "개정안 만들기" : "개정 화면에서 고치기"} <ArrowRight />
                          </Button>
                        </div>
                        <ul className="mb-2 space-y-1 text-xs">
                          {h.reasons.map((r, k) => (
                            <li key={k} className={cn("flex gap-1.5", r.kind === "인용-삭제" ? "text-rose-700 dark:text-rose-300" : r.kind === "용어" ? "text-amber-800 dark:text-amber-200" : "text-sky-800 dark:text-sky-200")}>
                              {r.kind === "용어" ? <Replace className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />} {r.detail}
                            </li>
                          ))}
                        </ul>
                        <p className="whitespace-pre-wrap rounded-lg bg-secondary/50 p-2 font-serif text-sm leading-6">
                          <Highlight text={h.article.text} terms={c.terms.map((t) => t.from)} />
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="rounded-2xl border bg-card p-5 shadow-sm">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h2 className="font-extrabold">「{c.law}」 {c.after.type}</h2>
                <Badge variant="outline">{data!.source === "live" ? "국가법령정보 실시간" : "내장 스냅샷"}</Badge>
                <WatchButton names={[c.law]} source="상위법 개정 반영" label="다음 개정도 알림 받기" className="ml-auto" />
              </div>
              <p className="text-sm text-muted-foreground">
                공포 {c.after.promulgated} · 시행 {c.after.effective} ({c.after.kind} 제{c.after.number}호) ← 개정 전: {c.before.type} 공포 {c.before.promulgated}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5 text-xs font-semibold">
                <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100">개정 {c.amended.length}개 조</span>
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100">신설 {c.added.length}개 조{c.added.length ? `(${c.added.join("·")})` : ""}</span>
                <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100">삭제 {c.deleted.length}개 조{c.deleted.length ? `(${c.deleted.join("·")})` : ""}</span>
              </div>
              {(c.terms.length > 0 || c.numbers.length > 0) && (
                <div className="mt-3 space-y-1.5 rounded-xl bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-900/20 dark:text-amber-100">
                  {c.terms.map((t, i) => (
                    <p key={i} className="flex flex-wrap items-center gap-1.5">
                      <Replace className="h-4 w-4" /> <b>용어 변경</b> ‘{t.from}’ → ‘{t.to}’ <span className="text-xs opacity-80">(개정 전 조문에서 {t.count}곳 · {t.articles.join("·")})</span>
                    </p>
                  ))}
                  {c.numbers.map((n, i) => (
                    <p key={`n${i}`} className="flex flex-wrap items-center gap-1.5">
                      <AlertTriangle className="h-4 w-4" /> <b>수치 변경</b> {n.article}: {n.from.join("·") || "-"} → {n.to.join("·") || "-"}
                    </p>
                  ))}
                </div>
              )}
              {c.noTable && (
                <p className="mt-3 rounded-lg bg-secondary/60 p-3 text-sm">
                  이번 개정은 국가법령정보에 신·구조문 대비가 제공되지 않아요(별표·서식만 바뀐 경우 등).{" "}
                  <a href={`https://www.law.go.kr/lsSc.do?query=${encodeURIComponent(c.law)}`} target="_blank" rel="noreferrer" className="font-semibold text-accent underline">
                    국가법령정보센터에서 원문 확인
                  </a>
                </p>
              )}
              {data!.warnings.length > 0 && <p className="mt-2 text-xs text-muted-foreground">※ {data!.warnings[0]}</p>}
            </div>

            {!c.noTable && (
            <div className="rounded-2xl border bg-card p-5 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-extrabold">신·구조문 대비 ({c.rows.length}곳)</h2>
                <span className="text-xs text-muted-foreground">
                  <del className="bg-rose-100 px-1 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200">개정 전</del> · <ins className="bg-sky-100 px-1 font-bold text-sky-900 underline dark:bg-sky-900/40 dark:text-sky-100">개정 후</ins>
                </span>
              </div>
              <ul className="space-y-3">
                {rows.map((r, i) => (
                  <li key={i} className="rounded-xl border p-3">
                    <p className="mb-2 flex items-center gap-2 text-xs font-bold">
                      <span className={cn("rounded px-1.5 py-0.5", r.kind === "신설" ? "bg-emerald-100 text-emerald-900" : r.kind === "삭제" ? "bg-rose-100 text-rose-900" : "bg-sky-100 text-sky-900")}>{r.kind}</span>
                      {r.article}
                      {r.title ? `(${r.title})` : ""}
                    </p>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-lg bg-secondary/50 p-2.5">
                        <p className="mb-1 text-[11px] font-bold text-muted-foreground">개정 전</p>
                        <Marked parts={r.old} side="old" />
                      </div>
                      <div className="rounded-lg bg-sky-50/60 p-2.5 dark:bg-sky-900/10">
                        <p className="mb-1 text-[11px] font-bold text-muted-foreground">개정 후</p>
                        <Marked parts={r.new} side="new" />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              {c.rows.length > 6 && (
                <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-3 text-sm font-semibold text-accent">
                  {showAll ? "접기" : `나머지 ${c.rows.length - 6}곳 더 보기`}
                </button>
              )}
              <p className="mt-3 text-xs text-muted-foreground">출처: 국가법령정보 신구법 비교 · 개정 표시는 원문 그대로이며, 바뀐 용어·수치·신설·삭제는 규칙으로 뽑았어요(생성형 AI 사용 안 함).</p>
            </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
