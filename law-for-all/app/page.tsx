import Link from "next/link";
import { ArrowRight, BadgeCheck, Briefcase, Building2, FileSearch, Gavel, GitCompareArrows, Layers3, Shield, ShieldCheck, Users } from "lucide-react";
import { SearchBox } from "@/components/law-search/search-box";
import { HeroHeading } from "@/components/law-search/hero-heading";
import { MOCK_LAWS } from "@/lib/law-api/mock";

const FEATURES = [
  { icon: Users, title: "시민 모드", desc: "일상 언어로 물으면 쉬운 용어 풀이와 '지금 해야 할 3단계'를 알려드려요." },
  { icon: Building2, title: "공무원 실무 모드", desc: "행정 요약 보고서, 상위법-시행령-시행규칙 3단 대조, 기안문 인용 복사까지." },
  { icon: ShieldCheck, title: "근거 인용·환각 방지", desc: "모든 답변에 조문 번호와 원문을 인용하고, 근거 밖 인용은 자동 제거합니다." },
  { icon: Gavel, title: "상황 분석 · 3관점", desc: "상황을 말하면 관련 법령을 추천하고 변호사·검사·판사의 시각으로 요건까지 점검합니다." },
  { icon: Layers3, title: "LLM 비종속", desc: "OpenAI·Claude·Ollama(EXAONE·Gemma·Llama·Solar)를 설정 하나로 전환합니다." },
];

export default function HomePage() {
  const laws = MOCK_LAWS.filter((l) => l.kind === "법률");
  return (
    <>
      <section className="relative overflow-hidden border-b">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-br from-navy-50 via-background to-sage-50 dark:from-navy-900 dark:via-background dark:to-sage-800/20" />
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-sage-200/40 blur-3xl dark:bg-sage-700/20" />
        <div className="container relative flex flex-col items-center py-16 text-center sm:py-24">
          <HeroHeading />
          <div className="mt-8 w-full max-w-3xl">
            <SearchBox autoFocus />
          </div>
          <Link
            href="/analyze"
            className="group mt-6 flex w-full max-w-3xl items-center gap-4 rounded-2xl border-2 border-dashed border-accent/40 bg-card/80 p-4 text-left shadow-sm transition hover:border-accent hover:shadow-md"
          >
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
          <p className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <BadgeCheck className="h-4 w-4 text-accent" /> 국가법령정보 Open API 연동
            </span>
            <span className="inline-flex items-center gap-1">
              <FileSearch className="h-4 w-4 text-accent" /> 핵심 법령 {laws.length}종 + 하위법령 내장
            </span>
            <span className="inline-flex items-center gap-1">
              <GitCompareArrows className="h-4 w-4 text-accent" /> 키 없이도 완전 시연
            </span>
          </p>
        </div>
      </section>

      <section className="container py-14" aria-labelledby="feat-h">
        <h2 id="feat-h" className="text-center text-2xl font-extrabold tracking-tight">누구에게나, 정확하게</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border bg-card p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent/10 text-accent">
                <f.icon className="h-6 w-6" aria-hidden />
              </span>
              <h3 className="mt-4 font-extrabold">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="container pb-6" aria-labelledby="laws-h">
        <div className="flex items-end justify-between">
          <h2 id="laws-h" className="text-xl font-extrabold">바로 볼 수 있는 법령</h2>
          <Link href="/laws" className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">
            전체 보기 <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {laws.map((l) => (
            <li key={l.id}>
              <Link href={`/laws/${l.id}`} className="flex h-full flex-col rounded-xl border bg-card p-4 transition hover:border-accent">
                <span className="font-bold">{l.name}</span>
                <span className="mt-1 text-xs text-muted-foreground">
                  {l.ministry} · 조문 {l.articles.length}개{MOCK_LAWS.some((c) => c.parentId === l.id) ? " · 하위법령 연계" : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
