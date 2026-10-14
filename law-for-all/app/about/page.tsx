import type { Metadata } from "next";
import { ArrowDown, ArrowRight, CheckCircle2, CircleDashed, Database, FileCheck2, Layers3, MessageSquareText, Search, ShieldCheck } from "lucide-react";
import { serverConfig } from "@/lib/config";
import { listProviders } from "@/lib/llm/registry";
import { MOCK_LAWS, MOCK_DATASET_DATE } from "@/lib/law-api/mock";
import { TOPICS } from "@/lib/law-api/mock/topics";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "서비스 구조" };
export const dynamic = "force-dynamic";

const PIPELINE = [
  { icon: MessageSquareText, title: "① 질문 이해", desc: "생활 표현 토픽 라우팅 + 2-gram 조문 검색" },
  { icon: Database, title: "② 원문 확보", desc: "국가법령정보 Open API 실시간 원문(미설정 시 내장 데이터)" },
  { icon: Layers3, title: "③ LLM 어댑터", desc: "OpenAI · Claude · Ollama · 규칙엔진 중 선택" },
  { icon: ShieldCheck, title: "④ 환각 가드", desc: "인용 화이트리스트 · 조문 언급 대조 · 실패 시 규칙엔진 대체" },
  { icon: FileCheck2, title: "⑤ 근거 카드", desc: "AI 문장과 분리된 법령 원문 · 원문 링크 · 기안문 인용" },
];

export default async function AboutPage() {
  const providers = await listProviders(serverConfig.llm);
  const articleCount = MOCK_LAWS.reduce((n, l) => n + l.articles.length, 0);
  return (
    <div className="container max-w-5xl py-10">
      <h1 className="text-2xl font-extrabold">서비스 구조 · AI 검증 방식</h1>
      <p className="mt-2 text-muted-foreground">모두의 법은 “근거 없는 답변을 하지 않는 법률 AI”를 목표로 설계되었습니다.</p>

      <section className="mt-8" aria-labelledby="pipe-h">
        <h2 id="pipe-h" className="mb-4 font-extrabold">
          <Search className="mr-1 inline h-5 w-5 text-accent" /> 답변 파이프라인
        </h2>
        <ol className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">
          {PIPELINE.map((p, i) => (
            <li key={p.title} className="contents">
              <div className="flex-1 rounded-xl border bg-card p-4 shadow-sm">
                <p.icon className="h-6 w-6 text-accent" aria-hidden />
                <p className="mt-2 text-sm font-bold">{p.title}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{p.desc}</p>
              </div>
              {i < PIPELINE.length - 1 && (
                <span className="flex justify-center text-muted-foreground" aria-hidden>
                  <ArrowRight className="hidden h-5 w-5 md:block" />
                  <ArrowDown className="h-5 w-5 md:hidden" />
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-10 grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border bg-card p-5">
          <h2 className="font-extrabold">LLM 공급자 상태</h2>
          <p className="mt-1 text-xs text-muted-foreground">환경변수 LLM_PROVIDER 하나로 기본값을 바꾸고, 화면 상단 메뉴에서 실시간 전환합니다.</p>
          <ul className="mt-4 space-y-2">
            {providers.map((p) => (
              <li key={p.id} className="flex items-start gap-2 text-sm">
                {p.configured ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /> : <CircleDashed className="mt-0.5 h-4 w-4 text-muted-foreground" />}
                <span className="flex-1">
                  <span className="font-semibold">{p.label}</span> <span className="text-muted-foreground">{p.model}</span>
                  {p.isDefault && (
                    <Badge variant="accent" className="ml-1">
                      기본
                    </Badge>
                  )}
                  <span className="block text-xs text-muted-foreground">{p.hint}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <h2 className="font-extrabold">법령 데이터</h2>
          <ul className="mt-3 space-y-1.5 text-sm">
            <li>
              · 연동 상태: <strong>{serverConfig.lawApiOc ? "국가법령정보 Open API 실시간" : "내장 시연 데이터"}</strong>
            </li>
            <li>
              · 내장 법령: 법률 {MOCK_LAWS.filter((l) => l.kind === "법률").length}종 + 하위법령 {MOCK_LAWS.filter((l) => l.kind !== "법률").length}종 · 조문 {articleCount}개 (기준 {MOCK_DATASET_DATE})
            </li>
            <li>· 생활 법률 상황 토픽: {TOPICS.length}개 (검수된 쉬운 설명·행동 가이드·기관 연락처)</li>
            <li>· 상황 분석 3관점(변호사·검사·판사) 지식베이스: 토픽별 주장·증거·전략, 위법성·제재, 법률 요건 사전</li>
            <li>· 판례·해석례: Open API 연동 시 실시간 조회(시연 데이터에 사건번호를 지어내지 않음)</li>
          </ul>
        </div>
      </section>

      <section className="mt-10 rounded-xl border bg-card p-5">
        <h2 className="font-extrabold">환각 방지 장치</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6">
          <li>LLM에는 검색된 근거 조문만 제공하고, 답변 문장마다 [[조문키]] 인용을 요구합니다.</li>
          <li>근거 목록 밖의 인용 키는 서버에서 자동 제거하고, 인용이 하나도 없으면 답변을 폐기하고 규칙엔진으로 대체합니다.</li>
          <li>본문의 “「법령」 제N조” 표현을 근거 원문과 대조하여 확인되지 않으면 ‘확인 필요’로 표시합니다.</li>
          <li>근거 조문 카드에는 AI가 쓴 문장이 아니라 법령 원문만 표시하고 국가법령정보센터 원문 링크를 제공합니다.</li>
          <li>기관 연락처·전화번호는 LLM이 만들지 않고 검수된 데이터만 사용합니다.</li>
          <li>근거 조문이 검색되지 않으면 생성형 AI를 호출하지 않습니다.</li>
        </ol>
      </section>
    </div>
  );
}
