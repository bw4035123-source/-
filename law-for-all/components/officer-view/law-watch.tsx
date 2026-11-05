"use client";
import * as React from "react";
import Link from "next/link";
import { Bell, BellPlus, BellRing, Check, Loader2, Settings2, Trash2, X } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { WATCH_EVENT, fmtYmd, fromDateInput, loadWatch, mergeWatch, pendingUpdates, recentAmendments, saveWatch, toDateInput, ymd, type WatchItem, type WatchLaw } from "@/lib/law-watch";
import { LawCombobox } from "@/components/drafting/law-combobox";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/** 지켜보는 법령 목록(이 브라우저) — 다른 화면에서 등록해도 바로 반영 */
export function useWatch(): [WatchItem[], (items: WatchItem[]) => void] {
  const [items, setItems] = React.useState<WatchItem[]>([]);
  React.useEffect(() => {
    const read = () => setItems(loadWatch());
    read();
    window.addEventListener(WATCH_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(WATCH_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);
  return [items, (v) => (setItems(v), saveWatch(v))];
}

const today = () => toDateInput(ymd(new Date()));

/**
 * 개정 알림 받기 — 법령(들)을 '지켜볼 법령'으로 등록. 기준일(우리 규정 최종 정비일) 이후 개정되면 공직자 첫 화면에서 알림.
 * 자체규정 점검(규정이 인용·근거로 삼은 법령), 상위법 개정 반영(보고 있는 법령)에서 씀
 */
export function WatchButton({ names, source, label = "개정 알림 받기", className }: { names: string[]; source?: string; label?: string; className?: string }) {
  const toast = useToast();
  const [items, setItems] = useWatch();
  const [open, setOpen] = React.useState(false);
  const [date, setDate] = React.useState(today());
  const list = names.filter(Boolean);
  const already = list.length > 0 && list.every((n) => items.some((x) => x.name.replace(/\s/g, "") === n.replace(/\s/g, "")));
  if (!list.length) return null;
  const add = () => {
    const base = fromDateInput(date) || ymd(new Date());
    setItems(mergeWatch(items, list, base, source));
    setOpen(false);
    toast(`「${list[0]}」${list.length > 1 ? ` 등 ${list.length}개 법령` : ""}의 개정 알림을 등록했어요 — ${fmtYmd(base)} 이후 개정되면 공직자 첫 화면에서 알려 드려요`);
  };
  return (
    <span className={cn("relative inline-flex", className)}>
      <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {already ? <BellRing className="text-accent" /> : <BellPlus />} {already ? "알림 등록됨" : label}
      </Button>
      {open && (
        <span className="absolute right-0 top-full z-30 mt-1 block w-72 rounded-xl border bg-card p-3 text-left text-xs shadow-lg" role="dialog" aria-label="개정 알림 등록">
          <span className="block font-bold text-foreground">상위법 개정 알림 등록</span>
          <span className="mt-1 block text-muted-foreground">
            {list.slice(0, 4).map((n) => `「${n}」`).join(" ")}
            {list.length > 4 ? ` 외 ${list.length - 4}개` : ""}
          </span>
          <label className="mt-2 flex flex-col gap-1 font-semibold text-muted-foreground">
            기준일 — 우리 규정 최종 정비일(이 날 이후 개정되면 알림)
            <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className="h-8 rounded-md border bg-card px-2 text-sm font-normal text-foreground" aria-label="기준일" />
          </label>
          <span className="mt-2 flex gap-1.5">
            <Button size="sm" variant="accent" onClick={add}>
              <BellPlus /> 등록
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              닫기
            </Button>
          </span>
          <span className="mt-1.5 block text-[11px] text-muted-foreground">목록은 이 브라우저에만 저장돼요(서버로 보내는 것은 법령 이름뿐).</span>
        </span>
      )}
    </span>
  );
}

/** 공직자 첫 화면 — 지켜보는 상위법이 기준일 이후 개정됐으면 알림 + 목록 관리 */
export function LawWatchPanel() {
  const toast = useToast();
  const [items, setItems] = useWatch();
  const [laws, setLaws] = React.useState<WatchLaw[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [checkedAt, setCheckedAt] = React.useState<string>("");
  const [manage, setManage] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newDate, setNewDate] = React.useState(today());
  const key = items.map((x) => x.name).sort().join("|");

  React.useEffect(() => {
    if (!key) return setLaws([]);
    let live = true;
    setBusy(true);
    setFailed(false);
    fetchJson<{ laws: WatchLaw[]; checkedAt: string }>(`/api/law-watch?names=${encodeURIComponent(key)}`, { timeoutMs: 30000 })
      .then((j) => {
        if (!live) return;
        setLaws(j.laws);
        setCheckedAt(j.checkedAt);
      })
      .catch(() => live && setFailed(true))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [key]);

  const pending = laws ? pendingUpdates(items, laws) : [];
  const ack = (name: string, to: string) => setItems(items.map((x) => (x.name === name ? { ...x, baseline: to } : x)));
  const remove = (name: string) => setItems(items.filter((x) => x.name !== name));
  const addNew = () => {
    if (!newName) return;
    setItems(mergeWatch(items, [newName], fromDateInput(newDate) || ymd(new Date()), "직접 등록"));
    toast(`「${newName}」 개정 알림을 등록했어요`);
    setNewName("");
  };
  const time = checkedAt ? new Date(checkedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <section className={cn("mt-6 w-full max-w-3xl rounded-2xl border p-4 text-left shadow-sm", pending.length ? "border-amber-300 bg-amber-50/80 dark:border-amber-700 dark:bg-amber-950/30" : "bg-card/90")} aria-label="상위법 개정 알림" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-extrabold">
          {pending.length ? <BellRing className="h-4 w-4 text-amber-600" aria-hidden /> : <Bell className="h-4 w-4 text-accent" aria-hidden />}
          상위법 개정 알림
          {items.length > 0 && (
            <span className="text-xs font-semibold text-muted-foreground">
              — 지켜보는 법령 {items.length}개{busy ? " · 국가법령정보 확인 중…" : failed ? " · 지금은 확인하지 못했어요" : pending.length ? ` · 새 개정 ${pending.length}건` : ` · 새 개정 없음${time ? `(${time} 확인)` : ""}`}
            </span>
          )}
        </p>
        <button type="button" onClick={() => setManage((v) => !v)} className="inline-flex items-center gap-1 text-xs font-bold text-accent hover:underline" aria-expanded={manage}>
          <Settings2 className="h-3.5 w-3.5" aria-hidden /> {items.length ? "지켜볼 법령 관리" : "지켜볼 법령 등록"}
        </button>
      </div>
      {!items.length && !manage && <p className="mt-1 text-xs text-muted-foreground">우리 규정이 따르는 법령을 등록해 두면, 개정될 때 이 화면에서 바로 알려 드려요. 자체규정 점검·상위법 개정 반영 화면의 ‘개정 알림 받기’로도 등록할 수 있어요.</p>}

      {busy && !laws && <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> 국가법령정보에서 최근 개정을 확인하는 중…</p>}

      {pending.length > 0 && (
        <ul className="mt-3 space-y-2">
          {pending.map(({ item, law }) => (
            <li key={item.name} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-card px-3 py-2.5 dark:border-amber-800">
              <span className="min-w-0 text-sm">
                <b>「{law.name}」 {law.revision || "개정"}</b>
                <span className="ml-1 text-xs text-muted-foreground">
                  {fmtYmd(law.promulgated)} 공포{law.effective ? ` · ${fmtYmd(law.effective)} 시행` : ""} — 우리 규정 기준일 {fmtYmd(item.baseline)} 이후{item.source ? ` · ${item.source}` : ""}
                </span>
                {law.revision === "타법개정" && <span className="block text-[11px] text-muted-foreground">다른 법률 개정에 따른 자구 수정일 수 있어요 — 개정 전후를 확인하세요.</span>}
              </span>
              <span className="flex shrink-0 gap-1.5">
                <Link href={`/drafting?mode=upper&law=${encodeURIComponent(law.name)}`} className="inline-flex h-8 items-center gap-1 rounded-md bg-accent px-3 text-xs font-bold text-accent-foreground hover:bg-accent/90">
                  개정 전후 보기 · 영향 점검
                </Link>
                <Button size="sm" variant="outline" onClick={() => (ack(item.name, law.promulgated), toast(`「${law.name}」 알림을 확인했어요 — 다음 개정부터 다시 알려 드려요`))}>
                  <Check /> 확인함
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {manage && (
        <div className="mt-3 space-y-2 rounded-xl border bg-card p-3">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_auto] sm:items-end">
            <div className="min-w-0">
              <p className="mb-1 text-xs font-semibold text-muted-foreground">법령 검색</p>
              <LawCombobox value={newName} onPick={(p) => setNewName(p.name)} />
            </div>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
              기준일(우리 규정 최종 정비일)
              <input type="date" value={newDate} max={today()} onChange={(e) => setNewDate(e.target.value)} className="h-10 rounded-md border bg-card px-2 text-sm font-normal text-foreground" aria-label="기준일" />
            </label>
            <Button onClick={addNew} disabled={!newName}>
              <BellPlus /> 추가
            </Button>
          </div>
          {items.length > 0 && (
            <ul className="divide-y text-sm">
              {items.map((x) => {
                const l = laws?.find((y) => y.query === x.name || y.name === x.name);
                return (
                  <li key={x.name} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="min-w-0">
                      「{x.name}」
                      <span className="ml-1 text-xs text-muted-foreground">
                        기준일 {fmtYmd(x.baseline)}
                        {l ? ` · 최근 ${l.revision || "개정"} ${fmtYmd(l.promulgated)}` : ""}
                        {x.source ? ` · ${x.source}` : ""}
                      </span>
                    </span>
                    <button type="button" onClick={() => remove(x.name)} className="shrink-0 rounded p-1 text-muted-foreground hover:text-rose-600" aria-label={`${x.name} 알림 해제`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>목록은 이 브라우저에만 저장돼요. 화면을 열 때마다 국가법령정보 법령 목록에서 최근 공포일을 확인해요.</span>
            <button type="button" onClick={() => setManage(false)} className="inline-flex items-center gap-0.5 font-semibold hover:text-foreground">
              <X className="h-3 w-3" /> 닫기
            </button>
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * 법령 둘러보기 — 개정 알리미: 핵심 법령 + 지켜보는 법령 중 최근 90일 안에 공포된 개정을 계속 보여 줌(확인해도 기간 동안 유지).
 * 법령 카드에 '최근 개정' 표시를 붙이도록 결과를 onLoaded 로 넘김
 */
export function RecentAmendmentsBoard({ catalog, officer, onLoaded }: { catalog: { id: string; name: string }[]; officer: boolean; onLoaded?: (recent: Map<string, string>) => void }) {
  const [items] = useWatch();
  const [laws, setLaws] = React.useState<WatchLaw[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const names = Array.from(new Set([...items.map((x) => x.name), ...catalog.map((c) => c.name)])).slice(0, 40);
  const key = names.join("|");
  React.useEffect(() => {
    if (!key) return;
    let live = true;
    setFailed(false);
    fetchJson<{ laws: WatchLaw[] }>(`/api/law-watch?names=${encodeURIComponent(key)}`, { timeoutMs: 45000 })
      .then((j) => live && setLaws(j.laws))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [key]);
  const recent = laws ? recentAmendments(laws) : [];
  React.useEffect(() => {
    if (laws) onLoaded?.(new Map(recent.map((r) => [r.name.replace(/\s/g, ""), r.promulgated])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laws]);
  const watched = (n: string) => items.some((x) => x.name.replace(/\s/g, "") === n.replace(/\s/g, ""));
  const idOf = (n: string) => catalog.find((c) => c.name.replace(/\s/g, "") === n.replace(/\s/g, ""))?.id;
  if (!key) return null;
  return (
    <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-800 dark:bg-amber-950/25" aria-label="개정 알리미" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="flex items-center gap-1.5 font-extrabold">
          <BellRing className="h-4 w-4 text-amber-600" aria-hidden /> 개정 알리미 <span className="text-xs font-semibold text-muted-foreground">— 최근 90일 안에 공포된 개정</span>
        </p>
        <span className="text-[11px] text-muted-foreground">핵심 법령 {catalog.length}개{items.length ? ` + 지켜보는 법령 ${items.length}개` : ""} · 국가법령정보 법령 목록 기준 · 공포 후 90일 동안 계속 표시</span>
      </div>
      {!laws && !failed && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> 국가법령정보에서 최근 개정을 확인하는 중…
        </p>
      )}
      {failed && <p className="mt-2 text-xs text-muted-foreground">지금은 국가법령정보에 연결하지 못했어요. 잠시 후 다시 열어 주세요.</p>}
      {laws && !recent.length && <p className="mt-2 text-sm text-muted-foreground">최근 90일 안에 개정된 법령이 없어요.</p>}
      {recent.length > 0 && (
        <ul className="mt-3 grid gap-2 md:grid-cols-2">
          {recent.map((r) => {
            const id = idOf(r.name);
            return (
              <li key={r.name} className="flex flex-col gap-2 rounded-xl border bg-card px-3 py-2.5">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <b className="text-sm">「{r.name}」</b>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900 dark:bg-amber-900/50 dark:text-amber-100">{r.revision || "개정"}</span>
                    {r.upcoming && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-900 dark:bg-sky-900/50 dark:text-sky-100">시행 예정</span>}
                    {watched(r.name) && <span className="rounded-full border border-accent/40 px-2 py-0.5 text-[11px] font-bold text-accent">지켜보는 법령</span>}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {fmtYmd(r.promulgated)} 공포({r.daysAgo === 0 ? "오늘" : `${r.daysAgo}일 전`}){r.effective ? ` · ${fmtYmd(r.effective)} 시행` : ""}
                    {r.revision === "타법개정" ? " · 다른 법률 개정에 따른 자구 수정일 수 있음" : ""}
                  </span>
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {officer && (
                    <Link href={`/drafting?mode=upper&law=${encodeURIComponent(r.name)}`} className="inline-flex h-7 items-center rounded-md bg-accent px-2.5 text-xs font-bold text-accent-foreground hover:bg-accent/90">
                      개정 전후 비교
                    </Link>
                  )}
                  <Link href={id ? `/laws/${id}` : `https://www.law.go.kr/lsSc.do?query=${encodeURIComponent(r.name)}`} target={id ? undefined : "_blank"} className="inline-flex h-7 items-center rounded-md border px-2.5 text-xs font-semibold hover:border-accent hover:text-accent">
                    현행 원문
                  </Link>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
