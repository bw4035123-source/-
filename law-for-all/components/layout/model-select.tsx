"use client";
import * as React from "react";
import { Cpu } from "lucide-react";
import { useSettings } from "@/components/providers/settings-provider";
import type { ProviderInfo } from "@/lib/llm/types";
import { cn } from "@/lib/utils";

/** LLM 공급자 실시간 전환 드롭다운 — 서버에 설정된 공급자만 선택 가능 */
export function ModelSelect({ className }: { className?: string }) {
  const { provider, setProvider, ready } = useSettings();
  const [list, setList] = React.useState<ProviderInfo[]>([]);

  React.useEffect(() => {
    let alive = true;
    fetch("/api/providers")
      .then((r) => r.json())
      .then((j) => alive && setList(j.providers ?? []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const def = list.find((p) => p.isDefault);
  const current = provider || def?.id || "mock";

  React.useEffect(() => {
    // 저장된 공급자가 더 이상 사용 불가하면 서버 기본값으로 복귀
    if (ready && provider && list.length && !list.find((p) => p.id === provider && p.configured)) setProvider("");
  }, [ready, provider, list, setProvider]);

  return (
    <label className={cn("flex items-center gap-1.5 shrink-0 rounded-full border bg-card py-1 pl-3 pr-1 text-xs", className)}>
      <Cpu className="h-4 w-4 text-accent" aria-hidden />
      <span className="sr-only">AI 모델 선택</span>
      <select
        value={current}
        onChange={(e) => setProvider(e.target.value === def?.id ? "" : e.target.value)}
        className="max-w-[7.5rem] cursor-pointer sm:max-w-[11rem] rounded-full bg-transparent py-1 pr-2 font-semibold focus:outline-none"
        aria-label="AI 모델 선택"
      >
        {(list.length ? list : [{ id: "mock", label: "규칙기반 엔진(LLM 없음)", model: "", configured: true } as ProviderInfo]).map((p) => (
          <option key={p.id} value={p.id} disabled={!p.configured} title={p.hint}>
            {p.label}
            {p.model && p.kind === "llm" ? ` · ${p.model}` : ""}
            {!p.configured ? " (미설정)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
