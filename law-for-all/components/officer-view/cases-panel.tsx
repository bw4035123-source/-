import { Gavel, ExternalLink } from "lucide-react";
import type { CaseItem } from "@/lib/law-api/types";
import { formatLawDate } from "@/lib/utils";

/** 관련 판례·법령해석례(국가법령정보 Open API 실시간 검색 결과) */
export function CasesPanel({ cases, live }: { cases: CaseItem[]; live: boolean }) {
  return (
    <section aria-labelledby="cases-h" className="rounded-xl border bg-card p-5 shadow-sm">
      <h2 id="cases-h" className="mb-3 flex items-center gap-2 font-extrabold">
        <Gavel className="h-5 w-5 text-accent" /> 관련 판례 · 법령해석례
      </h2>
      {cases.length ? (
        <ul className="divide-y">
          {cases.map((c, i) => (
            <li key={i} className="py-2.5">
              <a href={c.url} target="_blank" rel="noreferrer" className="group flex items-start gap-2 text-sm">
                <span className="mt-0.5 shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-bold">{c.kind}</span>
                <span className="flex-1">
                  <span className="font-semibold group-hover:text-accent group-hover:underline">{c.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {[c.court, c.caseNo, formatLawDate(c.date)].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm leading-6 text-muted-foreground">
          {live
            ? "검색어와 일치하는 판례·해석례가 없습니다."
            : "판례·법령해석례는 국가법령정보 Open API 인증키(LAW_API_OC) 설정 시 실시간으로 조회됩니다. 시연 데이터에는 확인되지 않은 사건번호를 임의로 만들지 않습니다."}
        </p>
      )}
    </section>
  );
}
