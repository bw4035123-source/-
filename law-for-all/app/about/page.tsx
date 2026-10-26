"use client";
import * as React from "react";
import { ArrowDown, ArrowRight, BarChart3, CheckCircle2, CircleDashed, Database, FileCheck2, Layers3, MessageSquareText, Search, ShieldCheck } from "lucide-react";
import type { ProviderInfo } from "@/lib/llm/types";
import { LLM_SWAP_RESULTS, providerDisplayName } from "@/lib/llm/display";
import { MOCK_LAWS, MOCK_DATASET_DATE } from "@/lib/law-api/mock";
import { TOPICS } from "@/lib/law-api/mock/topics";
import { Badge } from "@/components/ui/badge";
import evalReport from "@/lib/eval/report.json";


const PIPELINE = [
  { icon: MessageSquareText, title: "① 질문 이해", desc: "생활 표현 토픽 라우팅 + 2-gram 조문 검색" },
  { icon: Database, title: "② 원문 확보", desc: "국가법령정보 Open API 실시간 원문(미설정 시 내장 데이터)" },
  { icon: Layers3, title: "③ LLM 어댑터", desc: "공통기반 모델(EXAONE·Gemma·Llama 등) · OpenAI 호환 · Claude · 규칙엔진 중 선택" },
  { icon: ShieldCheck, title: "④ 환각 가드", desc: "인용 화이트리스트 · 조문 언급 대조 · 실패 시 규칙엔진 대체" },
  { icon: FileCheck2, title: "⑤ 근거 카드", desc: "AI 문장과 분리된 법령 원문 · 원문 링크 · 기안문 인용" },
];

const pctOf = (a: number, b: number) => `${Math.round((a / b) * 1000) / 10}%`;
const R = evalReport;
const EVAL_ROWS = [
  { label: "상황 분류 · 블라인드(독립 작성자)", value: `${R.routing.blind.correct}/${R.routing.blind.total} (${pctOf(R.routing.blind.correct, R.routing.blind.total)})`, desc: `엄격 채점 ${pctOf(R.routing.blind.strict, R.routing.blind.total)} · 독립 작성자 첫 측정 ${pctOf(R.routing.history[3].correct, R.routing.history[3].total)} → 6차 · 엉뚱한 상황 ${R.routing.blind.wrongTopic}건` },
  { label: "답변 근거", value: `근거 밖 인용 ${R.grounding.outsideMarkers}건`, desc: `답변 ${R.grounding.answers}건(국민·공직자) 인용 검증 통과 ${R.grounding.guardPassed}건 · 근거 없으면 '찾지 못함' 안내` },
  { label: "환각 주입 차단", value: `${R.injection.blocked}/${R.injection.injected} (${pctOf(R.injection.blocked, R.injection.injected)})`, desc: "없는 조문 번호·없는 조문·근거 밖 법령·지어낸 인용을 섞었을 때 가드가 거름" },
  { label: "개인정보 가림", value: `${R.privacy.masked}/${R.privacy.positives} · 오탐 ${R.privacy.falsePositives}`, desc: `주민번호·전화·카드·이메일·계좌·여권 여러 표기 / 일반 질문 ${R.privacy.negatives}건 중 잘못 가림` },
  { label: "생활 용어 → 법령 사전", value: `${R.alias.correct}/${R.alias.total}`, desc: "'산재'·'보이스피싱' 같은 일상어가 가리키는 법령" },
  { label: "Next.js ↔ Python 동일성", value: R.parity.passed ? `${R.parity.cases}건 일치` : "불일치", desc: "같은 질문에 두 실행판이 같은 답·같은 근거" },
];

export default function AboutPage() {
  const [providers, setProviders] = React.useState<ProviderInfo[]>([]);
  const [lawApi, setLawApi] = React.useState<string>("mock");
  React.useEffect(() => {
    document.title = "서비스 구조 · 법이음";
    fetch("/api/providers")
      .then((r) => r.json())
      .then((j) => {
        setProviders(j.providers ?? []);
        setLawApi(j.lawApi ?? "mock");
      })
      .catch(() => {});
  }, []);
  const articleCount = MOCK_LAWS.reduce((n, l) => n + l.articles.length, 0);
  return (
    <div className="container max-w-5xl py-10">
      <h1 className="text-2xl font-extrabold">서비스 구조 · AI 검증 방식</h1>
      <p className="mt-2 text-muted-foreground">법이음은 “근거 없는 답변을 하지 않는 법률 AI”를 목표로 설계되었습니다.</p>

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

      <section id="eval" className="mt-10 rounded-xl border bg-card p-5" aria-labelledby="eval-h">
        <h2 id="eval-h" className="flex flex-wrap items-baseline gap-x-2 font-extrabold">
          <span>
            <BarChart3 className="mr-1 inline h-5 w-5 text-accent" /> 정확도 성적표
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            측정 {evalReport.generatedAt} · 누구나 재현: <code className="rounded bg-secondary px-1">{evalReport.command}</code> (인증키·네트워크 불필요)
          </span>
        </h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {EVAL_ROWS.map((r) => (
            <div key={r.label} className="rounded-lg bg-secondary/50 p-3">
              <p className="text-xs font-semibold text-muted-foreground">{r.label}</p>
              <p className="mt-0.5 text-xl font-extrabold text-accent">{r.value}</p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{r.desc}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          블라인드 시험 문항은 로컬 EXAONE 3.5가 상황 이름만 보고 쓰고(규칙 사전 미제공), 규칙을 고치는 동안 열어 보지 않은 채 한 번만 쟀으며(1~6차 이력은 성적표 문서에 공개), 틀린 {evalReport.routing.blind.total - evalReport.routing.blind.correct}건도 고치지 않고 그대로 공개합니다
          (그중 {evalReport.routing.blind.total - evalReport.routing.blind.correct - evalReport.routing.blind.wrongTopic}건은 엉뚱한 답 대신 전체 법령 실시간 검색으로 넘어감). 문항·결과: tests/fixtures/, submission/정확도_성적표.md
        </p>
      </section>

      <section className="mt-10 grid gap-6 md:grid-cols-2">
        <div id="llm" className="rounded-xl border bg-card p-5">
          <h2 className="font-extrabold">LLM 공급자 상태</h2>
          <p className="mt-1 text-xs text-muted-foreground">환경변수 LLM_PROVIDER 하나로 기본값을 바꾸고, 화면 상단 메뉴에서 실시간 전환합니다. 행정안전부 AI 공통기반 모델(EXAONE·Gemma·Llama·Solar·GPT-OSS·HyperCLOVA X)은 Ollama 또는 OpenAI 호환 연결로 코드 수정 없이 붙습니다.</p>
          <ul className="mt-4 space-y-2">
            {providers.map((p) => (
              <li key={p.id} className="flex items-start gap-2 text-sm">
                {p.configured ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /> : <CircleDashed className="mt-0.5 h-4 w-4 text-muted-foreground" />}
                <span className="flex-1">
                  <span className="font-semibold">{providerDisplayName(p)}</span> <span className="text-muted-foreground">{p.model}</span>
                  {!p.configured && <span className="ml-1 text-xs text-muted-foreground">(연결 시 사용)</span>}
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
          <div className="mt-4 rounded-lg bg-secondary/60 p-3 text-xs">
            <p className="font-bold text-foreground">모델 교체 실측({LLM_SWAP_RESULTS.date}) — 2종 모두 통과</p>
            <ul className="mt-1.5 space-y-0.5">
              {LLM_SWAP_RESULTS.models.map((m) => (
                <li key={m.name} className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> {m.name} — {m.passed}/{m.total}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-muted-foreground">{LLM_SWAP_RESULTS.cases}, 모델이 직접 답변하고 인용 검증 통과. 재현: <code className="rounded bg-card px-1">{LLM_SWAP_RESULTS.command}</code></p>
          </div>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <h2 className="font-extrabold">법령 데이터</h2>
          <ul className="mt-3 space-y-1.5 text-sm">
            <li>
              · 연동 상태: <strong>{lawApi === "live" ? "국가법령정보 Open API 실시간" : `내장 데이터(국가법령정보센터 원문 ${MOCK_DATASET_DATE} 수집)`}</strong>
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
          <li>원문의 개정 표시를 읽어 최근 1년 안에 바뀐 근거 조문은 ‘최근 개정’으로 알리고, 검증 영수증에 최종 개정일을 남깁니다.</li>
          <li>근거 조문이 검색되지 않으면 생성형 AI를 호출하지 않습니다.</li>
          <li>질문 속 주민등록번호·전화번호·계좌번호 등은 브라우저와 서버에서 ○○○ 으로 가린 뒤 검색·AI에 넘깁니다.</li>
          <li>음성 질문은 브라우저 내장 음성 인식을 씁니다(크롬·엣지는 음성을 브라우저 제공사 서버에서 글로 바꿈). 법이음 서버에는 인식된 글만, 개인정보를 가린 뒤 전달됩니다.</li>
        </ol>
      </section>
    </div>
  );
}
