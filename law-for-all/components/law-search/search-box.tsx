"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/components/providers/settings-provider";
import { cn } from "@/lib/utils";
import { maskPII } from "@/lib/privacy-mask";
import { useToast } from "@/components/ui/toast";
import { MicButton } from "@/components/ui/mic-button";
import { VoiceAutoNotice, useVoiceAutoSubmit } from "@/components/ui/voice-auto";
import { CITIZEN_SUGGESTIONS, OFFICER_SUGGESTIONS } from "@/lib/suggestions";

/** 이전 이름 호환 */
export const SUGGESTED = CITIZEN_SUGGESTIONS;

interface Props {
  defaultValue?: string;
  variant?: "hero" | "compact";
  autoFocus?: boolean;
}

export function SearchBox({ defaultValue = "", variant = "hero", autoFocus }: Props) {
  const router = useRouter();
  const { mode } = useSettings();
  const [q, setQ] = React.useState(defaultValue);
  React.useEffect(() => setQ(defaultValue), [defaultValue]);

  const toast = useToast();
  const go = (query: string) => {
    // 개인정보는 주소창·서버로 보내기 전에 브라우저에서 가림
    const { text, found } = maskPII(query.trim());
    const t = text;
    if (t.length < 2) return;
    if (found.length) toast(`개인정보 보호를 위해 ${found.join("·")}를 가리고 검색했어요`);
    // 가린 종류는 결과 화면 안내용으로만 전달(원래 값은 보내지 않음)
    router.push(`/search?q=${encodeURIComponent(t)}${found.length ? `&pm=${encodeURIComponent(found.join(","))}` : ""}`);
  };
  // 음성으로 물으면 말이 끝나고 잠시 뒤 자동 검색(그 사이 취소·수정 가능)
  const voice = useVoiceAutoSubmit(go, (t) => setQ(t.slice(0, 500)));

  const hero = variant === "hero";
  const chips = mode === "officer" ? OFFICER_SUGGESTIONS : CITIZEN_SUGGESTIONS;
  const placeholder =
    mode === "officer" ? "법령명·조문·쟁점을 입력하세요 (예: 취업규칙 연차휴가 기준, 공기업 임직원 금품수수 한도)" : "궁금한 상황을 편하게 적어 주세요 (예: 윗집 층간소음 기준이 어떻게 되나요?)";

  return (
    <div className="w-full">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          voice.cancel();
          go(q);
        }}
        className={cn(
          "group flex items-center gap-2 rounded-2xl border-2 bg-card shadow-lg transition-shadow focus-within:border-accent focus-within:shadow-xl",
          hero ? "p-2 pl-4 sm:p-2.5 sm:pl-5" : "p-1.5 pl-3",
        )}
      >
        <Search className={cn("shrink-0 text-accent", hero ? "h-6 w-6" : "h-5 w-5")} aria-hidden />
        <label htmlFor="law-q" className="sr-only">
          법률 통합 검색
        </label>
        <input
          id="law-q"
          value={q}
          onChange={(e) => {
            voice.cancel();
            setQ(e.target.value);
          }}
          placeholder={placeholder}
          autoFocus={autoFocus}
          maxLength={500}
          autoComplete="off"
          enterKeyHint="search"
          className={cn("min-w-0 flex-1 bg-transparent placeholder:text-muted-foreground/80 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0", hero ? "py-2 text-base sm:text-lg" : "py-1.5 text-sm sm:text-base")}
        />
        <MicButton size={hero ? "lg" : "md"} onText={voice.onVoice} />
        <Button type="submit" variant="accent" size={hero ? "lg" : "default"} className="shrink-0 rounded-xl" disabled={q.trim().length < 2}>
          <span className="hidden sm:inline">AI 법률 검색</span>
          <ArrowRight className="sm:hidden" aria-hidden />
          <span className="sr-only sm:hidden">검색</span>
        </Button>
      </form>
      <VoiceAutoNotice pending={voice.pending} onCancel={voice.cancel} />
      {hero && (
        <div className="mt-4 flex flex-wrap justify-center gap-2" aria-label="추천 검색어">
          {chips.map((c, i) => (
            <motion.button
              key={c.label}
              type="button"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.04 }}
              onClick={() => go(c.query)}
              className="rounded-full border bg-card/80 px-3.5 py-1.5 text-sm font-semibold text-foreground/85 shadow-sm transition hover:-translate-y-0.5 hover:border-accent hover:text-accent"
            >
              # {c.label}
            </motion.button>
          ))}
        </div>
      )}
    </div>
  );
}
