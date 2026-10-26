import { ShieldCheck } from "lucide-react";
import { maskNotice } from "@/lib/privacy-mask";

/** 질문 속 개인정보를 가렸다는 안내(검색 결과·상황 분석 결과 위에 계속 표시) */
export function PrivacyNotice({ kinds, id }: { kinds: string[]; id?: string }) {
  if (!kinds.length) return null;
  return (
    <p id={id} role="status" className="no-print mb-4 flex items-start gap-2 rounded-xl border border-sage-200 bg-sage-50 px-3.5 py-2.5 text-sm leading-6 text-navy-900 dark:border-sage-700 dark:bg-sage-800/30 dark:text-sage-100">
      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-sage-600" aria-hidden />
      <span>{maskNotice(kinds)}</span>
    </p>
  );
}
