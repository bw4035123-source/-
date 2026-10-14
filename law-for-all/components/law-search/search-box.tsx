"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/components/providers/settings-provider";
import { cn } from "@/lib/utils";

export const SUGGESTED = [
  { label: "층간소음", query: "윗집 층간소음 기준이 어떻게 되나요?" },
  { label: "전세사기 예방", query: "전세 계약할 때 전세사기 예방하려면 뭘 확인해야 하나요?" },
  { label: "보증금 반환", query: "계약이 끝났는데 집주인이 보증금을 안 돌려줘요" },
  { label: "육아휴직 급여", query: "육아휴직 급여는 얼마나 받을 수 있나요?" },
  { label: "민원 처리 기한", query: "민원 처리 기한은 며칠인가요?" },
  { label: "임금체불", query: "퇴사했는데 마지막 월급을 안 줘요" },
  { label: "음주운전 처벌", query: "음주운전 처벌 기준이 궁금해요" },
  { label: "정보공개 청구", query: "정보공개 청구하면 언제까지 결정해야 하나요?" },
];

const OFFICER_SUGGESTED = [
  { label: "질의민원 처리기간", query: "질의민원 처리기간과 기간 계산 방법" },
  { label: "최우선변제 기준", query: "주택임대차 소액임차인 최우선변제 기준 금액" },
  { label: "층간소음 기준", query: "공동주택 층간소음 기준 데시벨과 관리주체 조치" },
  { label: "육아휴직 급여 산정", query: "육아휴직 급여 월 지급액 상한액 기준" },
  { label: "정보공개 결정기한", query: "정보공개 청구 결정 기한과 이의신청 기간" },
  { label: "행정심판 청구기간", query: "행정심판 청구기간 90일 180일 기준" },
];

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

  const go = (query: string) => {
    const t = query.trim();
    if (t.length < 2) return;
    router.push(`/search?q=${encodeURIComponent(t)}`);
  };

  const hero = variant === "hero";
  const chips = mode === "officer" ? OFFICER_SUGGESTED : SUGGESTED;
  const placeholder =
    mode === "officer" ? "법령명·조문·쟁점을 입력하세요 (예: 질의민원 처리기간, 최우선변제 기준)" : "궁금한 상황을 편하게 적어 주세요 (예: 윗집 층간소음 기준이 어떻게 되나요?)";

  return (
    <div className="w-full">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
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
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          maxLength={500}
          autoComplete="off"
          enterKeyHint="search"
          className={cn("min-w-0 flex-1 bg-transparent placeholder:text-muted-foreground/80 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0", hero ? "py-2 text-base sm:text-lg" : "py-1.5 text-sm sm:text-base")}
        />
        <Button type="submit" variant="accent" size={hero ? "lg" : "default"} className="shrink-0 rounded-xl" disabled={q.trim().length < 2}>
          <span className="hidden sm:inline">AI 법률 검색</span>
          <ArrowRight className="sm:hidden" aria-hidden />
          <span className="sr-only sm:hidden">검색</span>
        </Button>
      </form>
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
