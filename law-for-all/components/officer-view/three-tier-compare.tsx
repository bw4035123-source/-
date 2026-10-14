import { ArrowRight } from "lucide-react";
import type { LawArticle, LawDoc } from "@/lib/law-api/types";
import { articleLabel } from "@/lib/law-api/util";
import { ArticleText } from "@/components/law-search/article-text";
import { cn } from "@/lib/utils";

const tierOf = (l: LawDoc): 0 | 1 | 2 => (l.kind === "법률" ? 0 : l.kind === "대통령령" ? 1 : 2);
const TIER_LABEL = ["법률", "시행령(대통령령)", "시행규칙(부령)"];

interface Row {
  base: { law: LawDoc; article: LawArticle };
  linked: [LawArticleRef[], LawArticleRef[], LawArticleRef[]];
}
type LawArticleRef = { law: LawDoc; article: LawArticle };

/** 상위법령-시행령-시행규칙 3단 대조표(위임 관계 기준) */
export function ThreeTierCompare({ root, lawsChildren }: { root: LawDoc; lawsChildren: LawDoc[] }) {
  const all = [root, ...lawsChildren];
  const find = (lawId: string, no: string) => {
    const law = all.find((l) => l.id === lawId);
    const article = law?.articles.find((a) => a.no === no);
    return law && article ? { law, article } : null;
  };
  const used = new Set<string>();
  const rows: Row[] = root.articles
    .filter((a) => a.delegates?.length)
    .map((a) => {
      const linked: Row["linked"] = [[], [], []];
      linked[0].push({ law: root, article: a });
      a.delegates!.forEach((d) => {
        const hit = find(d.lawId, d.articleNo);
        if (!hit) return;
        used.add(`${d.lawId}:${d.articleNo}`);
        linked[tierOf(hit.law)].push(hit);
        // 시행령 조문이 다시 시행규칙에 위임한 경우(2단계 위임)
        hit.article.delegates?.forEach((d2) => {
          const h2 = find(d2.lawId, d2.articleNo);
          if (h2) {
            used.add(`${d2.lawId}:${d2.articleNo}`);
            linked[tierOf(h2.law)].push(h2);
          }
        });
      });
      return { base: { law: root, article: a }, linked };
    });

  const hasTier = [true, lawsChildren.some((l) => tierOf(l) === 1), lawsChildren.some((l) => tierOf(l) === 2)];
  const cols = hasTier.filter(Boolean).length;
  const unlinked = lawsChildren.flatMap((l) => l.articles.filter((a) => !used.has(`${l.id}:${a.no}`)).map((a) => ({ law: l, article: a })));

  if (!lawsChildren.length) {
    return <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">이 법령에 연결된 하위법령(시행령·시행규칙) 데이터가 없습니다.</p>;
  }

  return (
    <div className="space-y-4">
      <div className={cn("hidden gap-3 px-1 text-sm font-bold text-muted-foreground md:grid", cols === 3 ? "md:grid-cols-3" : "md:grid-cols-2")}>
        {TIER_LABEL.map((t, i) => hasTier[i] && <div key={t}>{t}</div>)}
      </div>
      {rows.map((r) => (
        <div key={r.base.article.no} className={cn("grid gap-3 rounded-xl border bg-card p-3 shadow-sm", cols === 3 ? "md:grid-cols-3" : "md:grid-cols-2")}>
          {r.linked.map((cell, i) =>
            hasTier[i] ? (
              <div key={i} className={cn("rounded-lg p-3", i === 0 ? "bg-navy-50 dark:bg-navy-800/50" : i === 1 ? "bg-sage-50 dark:bg-sage-800/20" : "bg-amber-50 dark:bg-amber-900/20")}>
                <p className="mb-1 text-xs font-bold text-muted-foreground md:hidden">{TIER_LABEL[i]}</p>
                {cell.length ? (
                  cell.map((x) => (
                    <div key={`${x.law.id}-${x.article.no}`} className="mb-3 last:mb-0">
                      <p className="mb-1 flex items-center gap-1 text-sm font-bold">
                        {i > 0 && <ArrowRight className="h-3.5 w-3.5 text-accent" aria-label="위임" />}
                        {i > 0 ? `「${x.law.shortName ?? x.law.name}」 ` : ""}
                        {articleLabel(x.article.no)}({x.article.title})
                      </p>
                      <ArticleText text={x.article.text} className="text-sm leading-6" />
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">해당 위임 조문 없음</p>
                )}
              </div>
            ) : null,
          )}
        </div>
      ))}
      {unlinked.length > 0 && (
        <details className="rounded-xl border bg-card p-4">
          <summary className="cursor-pointer text-sm font-bold">위임 관계가 지정되지 않은 하위법령 조문 {unlinked.length}개</summary>
          <ul className="mt-3 space-y-3">
            {unlinked.map((x) => (
              <li key={`${x.law.id}-${x.article.no}`}>
                <p className="text-sm font-bold">
                  「{x.law.name}」 {articleLabel(x.article.no)}({x.article.title})
                </p>
                <ArticleText text={x.article.text} className="text-sm" />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
