import type { ProviderInfo } from "./types";

/** 화면 표시용 공급자 이름 — 행정안전부 AI 공통기반 모델을 어떻게 연결하는지 함께 보이게 */
export function providerDisplayName(p: Pick<ProviderInfo, "id" | "label">): string {
  if (p.id === "ollama") return "공통기반 모델(EXAONE·Gemma·Llama) · Ollama";
  if (p.id === "openai") return "OpenAI 호환(Solar·HyperCLOVA X·GPT-OSS 등)";
  return p.label;
}

/** 모델 교체 실측 결과(python run.py --llm-test, submission/LLM_검증결과_20261022.md) */
export const LLM_SWAP_RESULTS = {
  date: "2026-10-22",
  cases: "같은 질문 4건(국민 질문 2·공직자 질문 1·상황 분석 1)",
  models: [
    { name: "Llama 3.2 (3B)", passed: 4, total: 4 },
    { name: "EXAONE 3.5 (7.8B)", passed: 4, total: 4 },
  ],
  command: "python run.py --llm-test ollama:llama3.2:3b,ollama:exaone3.5:7.8b",
};
