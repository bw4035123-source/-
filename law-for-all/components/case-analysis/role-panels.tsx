"use client";
import * as React from "react";
import { motion } from "framer-motion";
import { CheckCircle2, CircleHelp, XCircle } from "lucide-react";
import type { IssueAnalysis, ReqStatus, RoleId } from "@/lib/answer/types";
import { CitedText } from "@/components/law-search/cited-text";
import { useCitations } from "@/components/law-search/citation-context";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { articleLabel } from "@/lib/law-api/util";
import { cn } from "@/lib/utils";
import { ROLES } from "./roles";

function Block({ title, items, empty }: { title: string; items: string[]; empty?: string }) {
  if (!items.length && !empty) return null;
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {items.length ? (
        <ul className="space-y-1.5 text-sm leading-6">
          {items.map((t, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-40" />
              <span>
                <CitedText text={t} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

const STATUS: Record<ReqStatus, { icon: React.ElementType; label: string; cls: string }> = {
  met: { icon: CheckCircle2, label: "확인됨", cls: "text-emerald-600 dark:text-emerald-400" },
  unclear: { icon: CircleHelp, label: "확인 필요", cls: "text-slate-500 dark:text-slate-400" },
  unmet: { icon: XCircle, label: "불충족 가능", cls: "text-rose-600 dark:text-rose-400" },
};

function RoleBody({ role, a }: { role: RoleId; a: IssueAnalysis }) {
  const { open, citations } = useCitations();
  const p = a.perspectives;
  if (role === "lawyer")
    return (
      <div className="space-y-4">
        <Block title="주장할 수 있는 권리·근거" items={p.lawyer.arguments} />
        <Block title="지금 준비할 증거" items={p.lawyer.evidence} />
        <Block title="대응 전략" items={p.lawyer.strategy} />
      </div>
    );
  if (role === "prosecutor")
    return (
      <div className="space-y-4">
        <Block title="위법·범죄 성립 가능성" items={p.prosecutor.violations} empty="형벌 조항 해당 사항이 근거 조문에서 확인되지 않음" />
        <Block title="적용 가능한 제재" items={p.prosecutor.sanctions} />
        <Block title="입증이 필요한 사항" items={p.prosecutor.proofPoints} />
      </div>
    );
  const req = p.judge.requirements;
  const met = req.filter((r) => r.status === "met").length;
  return (
    <div className="space-y-4">
      <Block title="쟁점 정리" items={p.judge.issues} />
      {req.length > 0 && (
        <div>
          <h4 className="mb-1.5 flex items-center justify-between text-xs font-bold uppercase tracking-wide text-muted-foreground">
            <span>법률 요건 ↔ 사실관계 대조</span>
            <span className="normal-case">
              {req.length}개 중 <strong className="text-emerald-600 dark:text-emerald-400">{met}개 확인</strong>
            </span>
          </h4>
          <ul className="space-y-1.5">
            {req.map((r, i) => {
              const s = STATUS[r.status];
              const c = r.ref ? citations.find((x) => x.key === r.ref) : undefined;
              return (
                <li key={i} className="rounded-lg border bg-background/60 p-2.5 text-sm">
                  <p className="flex items-start gap-2">
                    <s.icon className={cn("mt-0.5 h-4 w-4 shrink-0", s.cls)} aria-label={s.label} />
                    <span className="flex-1 font-semibold">{r.label}</span>
                    <span className={cn("shrink-0 text-[11px] font-bold", s.cls)}>{s.label}</span>
                  </p>
                  <p className="ml-6 mt-0.5 text-xs text-muted-foreground">
                    {r.basis}
                    {c && (
                      <>
                        {" · "}
                        <button type="button" onClick={() => open(c.key)} className="font-semibold text-accent hover:underline">
                          {articleLabel(c.articleNo)}
                        </button>
                      </>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {p.judge.outlook && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-950 dark:bg-amber-900/20 dark:text-amber-100">
          <p className="mb-1 text-xs font-bold">예상 판단 방향(참고)</p>
          <CitedText text={p.judge.outlook} />
        </div>
      )}
    </div>
  );
}

function stanceOf(role: RoleId, a: IssueAnalysis) {
  return a.perspectives[role].stance;
}

function RoleCard({ role, a, index }: { role: RoleId; a: IssueAnalysis; index: number }) {
  const R = ROLES[role];
  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 * index }}
      className={cn("flex flex-col overflow-hidden rounded-2xl border-2 bg-card shadow-sm", R.ring)}
      aria-label={`${R.name}의 관점`}
    >
      <header className={cn("flex items-center gap-3 bg-gradient-to-r px-4 py-3 text-white", R.head)}>
        <span className="grid h-10 w-10 place-items-center rounded-full bg-white/20">
          <R.icon className="h-5 w-5" aria-hidden />
        </span>
        <span>
          <span className="block text-base font-extrabold">{R.name}의 시각</span>
          <span className="block text-xs text-white/85">{R.tagline}</span>
        </span>
      </header>
      <div className="flex-1 space-y-4 p-4">
        <p className={cn("rounded-xl rounded-tl-sm px-3.5 py-2.5 text-sm font-semibold leading-6", R.chip)}>
          “<CitedText text={stanceOf(role, a)} />”
        </p>
        <RoleBody role={role} a={a} />
      </div>
    </motion.article>
  );
}

const ORDER: RoleId[] = ["lawyer", "prosecutor", "judge"];

/** 변호사·검사·판사 3관점 패널 — 데스크톱 3열, 모바일 탭 */
export function RolePanels({ analyses }: { analyses: IssueAnalysis[] }) {
  const [idx, setIdx] = React.useState(0);
  const a = analyses[Math.min(idx, analyses.length - 1)];
  if (!a) return null;
  return (
    <section aria-labelledby="roles-h">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="roles-h" className="text-lg font-extrabold">
            AI 모의 법정 · 3가지 시각
          </h2>
          <p className="text-xs text-muted-foreground">같은 사실관계를 변호사·검사·판사의 입장에서 각각 검토했어요.</p>
        </div>
        {analyses.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="쟁점 선택">
            {analyses.map((x, i) => (
              <button
                key={x.issue.id}
                type="button"
                role="tab"
                aria-selected={i === idx}
                onClick={() => setIdx(i)}
                className={cn("rounded-full border px-3 py-1 text-xs font-bold", i === idx ? "border-primary bg-primary text-primary-foreground" : "hover:border-accent hover:text-accent")}
              >
                쟁점: {x.issue.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="hidden gap-4 lg:grid lg:grid-cols-3">
        {ORDER.map((r, i) => (
          <RoleCard key={`${a.issue.id}-${r}`} role={r} a={a} index={i} />
        ))}
      </div>
      <Tabs defaultValue="lawyer" className="lg:hidden">
        <TabsList className="grid w-full grid-cols-3">
          {ORDER.map((r) => {
            const R = ROLES[r];
            return (
              <TabsTrigger key={r} value={r}>
                <R.icon className="h-4 w-4" /> {R.name}
              </TabsTrigger>
            );
          })}
        </TabsList>
        {ORDER.map((r, i) => (
          <TabsContent key={r} value={r}>
            <RoleCard role={r} a={a} index={i} />
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}
