"use client";
import Link from "next/link";
import { ArrowRight, Briefcase, Building2, FilePenLine, FileStack, Gavel, Landmark, Layers3, ScanSearch, Shield, ShieldCheck, Users } from "lucide-react";
import { useSettings } from "@/components/providers/settings-provider";

/** 메인 화면 큰 바로가기 — 국민: AI 법률 상황 분석실 / 공직자: 내규 교차검증 */
export function ModeCta() {
  const { mode, ready } = useSettings();
  if (!ready) return <div className="mt-6 h-[84px] w-full max-w-3xl" aria-hidden />;
  const cls = "group mt-6 flex w-full max-w-3xl items-center gap-4 rounded-2xl border-2 border-dashed border-accent/40 bg-card/80 p-4 text-left shadow-sm transition hover:border-accent hover:shadow-md";
  if (mode === "officer")
    return (
      <Link href="/compliance" className={cls}>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-navy-700 to-sage-600 text-white shadow" aria-hidden>
          <ScanSearch className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-extrabold">내규 교차검증</span>
          <span className="block text-sm text-muted-foreground">우리 기관 규정을 붙여 넣으면 상위법령과 조문 단위로 대조해 상충 조항·근거 조문·개정안을 보여 드려요.</span>
        </span>
        <ArrowRight className="h-5 w-5 shrink-0 text-accent transition group-hover:translate-x-1" aria-hidden />
      </Link>
    );
  return (
    <Link href="/analyze" className={cls}>
      <span className="flex shrink-0 -space-x-2" aria-hidden>
        <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-sky-600 to-indigo-600 text-white ring-2 ring-card"><Briefcase className="h-4 w-4" /></span>
        <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-rose-600 to-red-700 text-white ring-2 ring-card"><Shield className="h-4 w-4" /></span>
        <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-white ring-2 ring-card"><Gavel className="h-4 w-4" /></span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-extrabold">복잡한 상황이라면? AI 법률 상황 분석실</span>
        <span className="block text-sm text-muted-foreground">겪은 일을 이야기하면 관련 법령을 추천하고 변호사·검사·판사의 시각으로 검토해 드려요.</span>
      </span>
      <ArrowRight className="h-5 w-5 shrink-0 text-accent transition group-hover:translate-x-1" aria-hidden />
    </Link>
  );
}

const CITIZEN = [
  { icon: Users, title: "쉬운 법률 안내", desc: "일상 언어로 물으면 쉬운 용어 풀이와 '지금 해야 할 3단계'를 알려드려요." },
  { icon: Gavel, title: "AI 법률 상황 분석실", desc: "상황을 말하면 관련 법령을 추천하고 변호사·검사·판사의 시각으로 검토해요." },
  { icon: Landmark, title: "판례 보기", desc: "비슷한 사건에서 법원이 어떻게 판단했는지 쉬운 설명과 함께 보여드려요." },
  { icon: ShieldCheck, title: "근거 인용·환각 방지", desc: "모든 답변에 조문 번호와 원문을 인용하고, 근거 밖 인용은 자동 제거합니다." },
  { icon: Layers3, title: "LLM 비종속", desc: "OpenAI·Claude·Ollama(EXAONE·Gemma·Llama·Solar)를 설정 하나로 전환합니다." },
];
const OFFICER = [
  { icon: Building2, title: "행정 검토 보고", desc: "검토 결론·근거 체계·쟁점·유의사항·체크리스트를 보고서 형식으로 정리해요." },
  { icon: FileStack, title: "보고서 한 번에 작성", desc: "검토 보고서·기안문·민원 회신문·붙임을 한 번에 만들고 Word로 저장해요." },
  { icon: ScanSearch, title: "내규 교차검증", desc: "우리 기관 규정을 근로기준법·청탁금지법·공직선거법·지방공기업법·공유재산법과 조문 단위로 대조해요." },
  { icon: FilePenLine, title: "규정 제·개정 지원", desc: "개정안·신구조문 대비표·정합성 점검·개정이유·부칙·입법예고문 초안." },
  { icon: ShieldCheck, title: "근거 인용·환각 방지", desc: "근거 밖 인용 자동 제거, 원문 대조, 인용 표기 복사로 공문서에 바로 활용." },
];

/** 메인 화면 기능 소개 — 모드별 */
export function FeatureGrid() {
  const { mode } = useSettings();
  const list = mode === "officer" ? OFFICER : CITIZEN;
  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {list.map((f) => (
        <div key={f.title} className="rounded-2xl border bg-card p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent/10 text-accent">
            <f.icon className="h-6 w-6" aria-hidden />
          </span>
          <h3 className="mt-4 font-extrabold">{f.title}</h3>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{f.desc}</p>
        </div>
      ))}
    </div>
  );
}
