"use client";
import { ClipboardCopy, ExternalLink, Hash } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import type { LawArticle, LawDoc } from "@/lib/law-api/types";
import { articleAnchor, draftQuote, formalCitation, lawGoKrUrl, toCitation } from "@/lib/law-api/util";
import { copyText } from "@/lib/clipboard";

/** 조문별 공문서 인용 도구 */
export function ArticleActions({ law, article }: { law: LawDoc; article: LawArticle }) {
  const toast = useToast();
  const c = toCitation(law, article);
  const copy = async (t: string, m: string) => toast((await copyText(t)) ? m : "복사 실패");
  const btn = "inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs font-semibold hover:border-accent hover:text-accent";
  return (
    <div className="no-print flex flex-wrap gap-1.5">
      <button type="button" className={btn} onClick={() => copy(draftQuote(c), "기안문 인용문을 복사했습니다")}>
        <ClipboardCopy className="h-3.5 w-3.5" /> 기안문 인용
      </button>
      <button type="button" className={btn} onClick={() => copy(formalCitation(c), "조문 표기를 복사했습니다")}>
        「」 표기
      </button>
      <button
        type="button"
        className={btn}
        onClick={() => copy(`${window.location.origin}/laws/${law.id}#${articleAnchor(article.no)}`, "조문 링크를 복사했습니다")}
        aria-label="조문 링크 복사"
      >
        <Hash className="h-3.5 w-3.5" />
      </button>
      <a className={btn} href={lawGoKrUrl(law.name, article.no)} target="_blank" rel="noreferrer" aria-label="국가법령정보센터에서 보기">
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}
