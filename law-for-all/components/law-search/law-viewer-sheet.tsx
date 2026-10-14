"use client";
import * as React from "react";
import Link from "next/link";
import { ClipboardCopy, ExternalLink, FileText, GitBranch, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ArticleText } from "./article-text";
import type { Citation, LawArticle, LawDoc } from "@/lib/law-api/types";
import { articleAnchor, articleLabel, draftQuote, formalCitation, lawGoKrUrl } from "@/lib/law-api/util";
import { copyText } from "@/lib/clipboard";
import { MOCK_DATASET_DATE } from "@/lib/law-api/mock/dataset-date";

interface Linked {
  law: LawDoc;
  article: LawArticle;
  relation: "상위" | "하위";
}

/** 근거 조문 원문 전문 슬라이드 오버 뷰어 + 연결된 상·하위법령 조문 */
export function LawViewerSheet({ citation, onOpenChange }: { citation: Citation | null; onOpenChange: (open: boolean) => void }) {
  const toast = useToast();
  const [linked, setLinked] = React.useState<Linked[] | null>(null);

  React.useEffect(() => {
    if (!citation) return;
    setLinked(null);
    const ctrl = new AbortController();
    fetch(`/api/laws/${citation.lawId}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((h: { root: LawDoc; children: LawDoc[] } | null) => {
        if (!h) return setLinked([]);
        const all = [h.root, ...h.children];
        const self = all.find((l) => l.id === citation.lawId);
        const art = self?.articles.find((a) => a.no === citation.articleNo);
        const out: Linked[] = [];
        // 이 조문이 위임한 하위법령 조문
        art?.delegates?.forEach((d) => {
          const law = all.find((l) => l.id === d.lawId);
          const a = law?.articles.find((x) => x.no === d.articleNo);
          if (law && a) out.push({ law, article: a, relation: "하위" });
        });
        // 이 조문에 위임한 상위법 조문
        all.forEach((law) =>
          law.articles.forEach((a) => {
            if (a.delegates?.some((d) => d.lawId === citation.lawId && d.articleNo === citation.articleNo)) out.push({ law, article: a, relation: "상위" });
          }),
        );
        setLinked(out);
      })
      .catch(() => setLinked([]));
    return () => ctrl.abort();
  }, [citation]);

  const copy = async (text: string, msg: string) => {
    toast((await copyText(text)) ? msg : "복사하지 못했습니다. 직접 선택해 복사해 주세요.");
  };

  return (
    <Sheet open={!!citation} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby={undefined}>
        {citation && (
          <>
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary">{citation.lawKind}</Badge>
                <Badge variant={citation.source === "live" ? "success" : "outline"}>{citation.source === "live" ? "국가법령정보 실시간 원문" : `국가법령정보센터 원문 · ${MOCK_DATASET_DATE} 수집`}</Badge>
              </div>
              <SheetTitle className="mt-1 text-xl">
                「{citation.lawName}」 {articleLabel(citation.articleNo)}
              </SheetTitle>
              <SheetDescription className="text-base font-semibold text-foreground/80">{citation.title}</SheetDescription>
            </SheetHeader>
            <div className="flex-1 space-y-6 overflow-y-auto p-5">
              <section aria-label="조문 원문" className="rounded-xl border bg-card p-5">
                <ArticleText text={citation.text} />
              </section>

              <div className="flex flex-wrap gap-2">
                <Button variant="accent" size="sm" onClick={() => copy(draftQuote(citation), "기안문 인용문을 복사했습니다")}>
                  <ClipboardCopy /> 기안문 인용문 복사
                </Button>
                <Button variant="outline" size="sm" onClick={() => copy(formalCitation(citation), "조문 표기를 복사했습니다")}>
                  <FileText /> 조문 표기 복사
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/laws/${citation.lawId}#${articleAnchor(citation.articleNo)}`}>
                    <GitBranch /> 법령 전문·3단 대조
                  </Link>
                </Button>
                <Button variant="ghost" size="sm" asChild>
                  <a href={lawGoKrUrl(citation.lawName, citation.articleNo)} target="_blank" rel="noreferrer">
                    <ExternalLink /> 국가법령정보센터
                  </a>
                </Button>
              </div>

              <section aria-label="연결된 상·하위법령">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-muted-foreground">
                  <GitBranch className="h-4 w-4" /> 위임 관계로 연결된 조문
                </h3>
                {linked === null ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
                  </p>
                ) : linked.length === 0 ? (
                  <p className="text-sm text-muted-foreground">이 조문과 위임 관계로 연결된 상·하위법령 조문이 없습니다.</p>
                ) : (
                  <ul className="space-y-3">
                    {linked.map((l) => (
                      <li key={`${l.law.id}-${l.article.no}`} className="rounded-lg border-l-4 border-accent bg-secondary/60 p-4">
                        <p className="mb-2 text-sm font-bold">
                          <Badge variant="accent" className="mr-2">
                            {l.relation}법령
                          </Badge>
                          「{l.law.name}」 {articleLabel(l.article.no)}({l.article.title})
                        </p>
                        <ArticleText text={l.article.text} className="text-sm" />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <p className="text-xs leading-5 text-muted-foreground">
                ※ 법률 정보 제공 목적의 화면입니다. 시행일·개정 여부는 국가법령정보센터 원문으로 최종 확인하세요.
              </p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
