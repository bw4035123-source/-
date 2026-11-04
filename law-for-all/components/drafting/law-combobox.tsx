"use client";
import * as React from "react";
import { Check, Loader2, Search, Star } from "lucide-react";
import type { ChangeLawHit } from "@/lib/law-api/client";
import { fetchJson } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";

/** 자주 쓰는 상위법(검색어가 없을 때 추천 목록) */
export const RECOMMENDED_LAWS = [
  "근로기준법",
  "산업안전보건법",
  "중대재해 처벌 등에 관한 법률",
  "개인정보 보호법",
  "지방공기업법",
  "공직자의 이해충돌 방지법",
  "부정청탁 및 금품등 수수의 금지에 관한 법률",
  "지방자치단체를 당사자로 하는 계약에 관한 법률",
  "공공기관의 정보공개에 관한 법률",
  "민원 처리에 관한 법률",
];

export type LawPick = { name: string; mst?: string; revision?: string };

const ymd = (s: string) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}. ${Number(s.slice(4, 6))}. ${Number(s.slice(6))}.` : "");

/**
 * 법령 검색창(콤보박스) — 법령명·약칭을 입력하면 국가법령정보 법령 목록(현행)에서 찾아 보여 주고,
 * 고르면 법령일련번호(MST)와 함께 onPick. 비어 있으면 자주 쓰는 법령을 추천.
 * 키보드: ↑↓ 이동 · Enter 선택 · Esc 닫기
 */
export function LawCombobox({ value, onPick, onNoResult, disabled }: { value: string; onPick: (p: LawPick) => void; onNoResult?: (q: string) => void; disabled?: boolean }) {
  const [q, setQ] = React.useState(value);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [hits, setHits] = React.useState<ChangeLawHit[] | null>(null);
  const [active, setActive] = React.useState(0);
  const listId = React.useId();
  const boxRef = React.useRef<HTMLDivElement>(null);
  const seq = React.useRef(0);

  React.useEffect(() => setQ(value), [value]);

  // 입력이 멈추면(0.3초) 검색
  React.useEffect(() => {
    const term = q.trim();
    if (!open || !term || term === value) {
      setHits(null);
      return;
    }
    const my = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const j = await fetchJson<{ laws: ChangeLawHit[] }>(`/api/law-changes/search?q=${encodeURIComponent(term)}`, { timeoutMs: 20000 });
        if (my !== seq.current) return;
        setHits(j.laws);
        setActive(0);
        if (!j.laws.length) onNoResult?.(term);
      } catch {
        if (my === seq.current) setHits([]);
      } finally {
        if (my === seq.current) setBusy(false);
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open]);

  // 바깥을 누르면 닫기
  React.useEffect(() => {
    const h = (e: MouseEvent) => boxRef.current && !boxRef.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const showRecommended = !q.trim() || q.trim() === value;
  const options: { name: string; hit?: ChangeLawHit }[] = showRecommended ? RECOMMENDED_LAWS.map((name) => ({ name })) : (hits ?? []).map((h) => ({ name: h.name, hit: h }));

  const pick = (o: { name: string; hit?: ChangeLawHit }) => {
    setQ(o.name);
    setOpen(false);
    onPick({ name: o.name, mst: o.hit?.mst || undefined, revision: o.hit?.revision || undefined });
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, Math.max(options.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && options[active]) pick(options[active]);
      else if (q.trim()) setOpen(true);
    } else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          value={q}
          disabled={disabled}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder="법령명·약칭으로 검색 (예: 산업안전보건법, 청탁금지법)"
          className="h-10 w-full rounded-md border bg-card pl-8 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
          aria-label="개정된 상위법 검색"
        />
        {busy && <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />}
      </div>
      {open && (
        <div id={listId} role="listbox" className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border bg-card p-1 shadow-lg">
          {showRecommended && <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-bold text-muted-foreground">자주 쓰는 법령</p>}
          {!showRecommended && busy && !hits && <p className="px-2.5 py-2 text-xs text-muted-foreground">국가법령정보에서 찾는 중…</p>}
          {!showRecommended && hits && !hits.length && <p className="px-2.5 py-2 text-xs text-muted-foreground">‘{q.trim()}’과(와) 일치하는 현행 법령이 없어요. 법령명을 다시 확인하세요.</p>}
          {options.map((o, i) => (
            <button
              key={`${o.name}-${o.hit?.mst ?? i}`}
              id={`${listId}-${i}`}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}
              className={cn("flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left text-sm", i === active ? "bg-accent/10 text-accent" : "hover:bg-secondary")}
            >
              {showRecommended ? <Star className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden /> : o.name === value ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : <span className="w-3.5 shrink-0" />}
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{o.name}</span>
                {o.hit && (
                  <span className="block text-[11px] text-muted-foreground">
                    {[o.hit.kind, o.hit.ministry.split(",")[0], o.hit.promulgated && `최근 ${o.hit.revision || "개정"} ${ymd(o.hit.promulgated)} 공포`].filter(Boolean).join(" · ")}
                    {!o.hit.mst && (o.hit.snapshot ? " · 내장 비교 자료" : " · 실시간 연결 필요")}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
