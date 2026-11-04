"use client";
import Link from "next/link";
import { ArrowRight, Briefcase, Building2, FilePenLine, FileStack, FileText, Gavel, Landmark, Layers3, ScanSearch, Shield, ShieldCheck, Users } from "lucide-react";
import { useSettings } from "@/components/providers/settings-provider";
import { OFFICER_REG_TEMPLATES } from "@/lib/suggestions";

/** 메인 화면 큰 바로가기 — 국민: 법률 상황 분석실 / 공직자: 자체규정 점검 */
export function ModeCta() {
  const { mode, ready } = useSettings();
  if (!ready) return <div className="mt-6 h-[84px] w-full max-w-3xl" aria-hidden />;
  const cls = "group mt-6 flex w-full max-w-3xl items-center gap-4 rounded-2xl border-2 border-dashed border-accent/40 bg-card/80 p-4 text-left shadow-sm transition hover:border-accent hover:shadow-md";
  if (mode === "officer")
    return (
      <section className="mt-8 w-full max-w-3xl rounded-2xl border bg-card/90 p-5 text-left shadow-sm" aria-label="규정 바로 만들기">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="flex items-center gap-1.5 font-extrabold">
              <FilePenLine className="h-4 w-4 text-accent" aria-hidden /> 규정 바로 만들기
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">고르면 국가법령정보에서 상위법령을 찾아 AI가 제정안을 써요</p>
          </div>
          <Link href="/drafting" className="inline-flex items-center gap-1 text-xs font-bold text-accent hover:underline">
            직접 작성·개정하기 <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="자주 만드는 내부 규정">
          {OFFICER_REG_TEMPLATES.map((t) => (
            <Link
              key={t.label}
              href={`/drafting?mode=enact&one=${encodeURIComponent(t.request)}`}
              className="group/t flex min-w-0 items-center gap-2 rounded-lg border border-transparent bg-secondary/60 px-3 py-2.5 text-[13px] font-semibold text-foreground/85 transition hover:border-accent/40 hover:bg-accent/5 hover:text-accent"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover/t:text-accent" aria-hidden />
              <span className="truncate">{t.label}</span>
            </Link>
          ))}
        </div>
      </section>
    );
  return (
    <Link href="/analyze" className={cls}>
      <span className="flex shrink-0 -space-x-2" aria-hidden>
        <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-sky-600 to-indigo-600 text-white ring-2 ring-card"><Briefcase className="h-4 w-4" /></span>
        <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-rose-600 to-red-700 text-white ring-2 ring-card"><Shield className="h-4 w-4" /></span>
        <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-white ring-2 ring-card"><Gavel className="h-4 w-4" /></span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-extrabold">복잡한 상황이라면? 법률 상황 분석실</span>
        <span className="block text-sm text-muted-foreground">겪은 일을 이야기하면 관련 법령을 추천하고 AI 변호사·검사·판사의 시각으로 검토해 드려요.</span>
      </span>
      <ArrowRight className="h-5 w-5 shrink-0 text-accent transition group-hover:translate-x-1" aria-hidden />
    </Link>
  );
}

const CITIZEN = [
  { icon: Users, title: "쉬운 법률 안내", desc: "일상 언어로 물으면 쉬운 용어 풀이와 '지금 해야 할 3단계'를 알려드려요." },
  { icon: Gavel, title: "법률 상황 분석실", desc: "상황을 말하면 관련 법령을 추천하고 AI 변호사·검사·판사의 시각으로 검토해요." },
  { icon: Landmark, title: "판례 보기", desc: "비슷한 사건에서 법원이 어떻게 판단했는지 쉬운 설명과 함께 보여드려요." },
  { icon: ShieldCheck, title: "근거 인용·환각 방지", desc: "모든 답변에 조문 번호와 원문을 인용하고, 근거 밖 인용은 자동 제거합니다." },
  { icon: Layers3, title: "LLM 비종속", desc: "OpenAI·Claude·Ollama(EXAONE·Gemma·Llama·Solar)를 설정 하나로 전환합니다." },
];
const OFFICER = [
  { icon: Building2, title: "행정 검토 보고", desc: "검토 결론·근거 체계·쟁점·유의사항·체크리스트를 보고서 형식으로 정리해요." },
  { icon: FileStack, title: "보고서 한 번에 작성", desc: "검토 보고서·기안문·민원 회신문·붙임을 한 번에 만들고 Word로 저장해요." },
  { icon: FilePenLine, title: "규정 제·개정 지원", desc: "한 줄로 제정안, 조문을 붙여 “개정해줘”면 개정 이유·전문·신구조문대비표까지." },
  { icon: ScanSearch, title: "자체규정 점검", desc: "규정 파일을 AI가 국가법령정보 상위 조문과 조문별로 대조하고 법정 기준도 점검해요." },
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
