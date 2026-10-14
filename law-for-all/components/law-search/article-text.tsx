import { cn } from "@/lib/utils";

/** 조문 본문 렌더링: 항(①)은 문단, 호(1.)·목(가.)은 들여쓰기 */
export function ArticleText({ text, className, clamp }: { text: string; className?: string; clamp?: boolean }) {
  const lines = text.split("\n").filter((l) => l.trim());
  return (
    <div className={cn("law-text space-y-1.5 text-[0.95rem]", clamp && "line-clamp-4", className)}>
      {lines.map((l, i) => {
        const depth = l.match(/^ */)?.[0].length ?? 0;
        const isNote = /^\[(별표|비고)/.test(l.trim());
        return (
          <p key={i} className={cn(depth >= 4 ? "pl-10" : depth >= 2 ? "pl-5" : "", isNote && "mt-2 rounded-md bg-secondary px-3 py-2 font-sans text-sm")}>
            {l.trim()}
          </p>
        );
      })}
    </div>
  );
}
