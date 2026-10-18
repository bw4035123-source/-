import Link from "next/link";
import { BookOpenText, FilePenLine, Gavel, Landmark, Scale, ScanSearch } from "lucide-react";
import { ModeToggle } from "./mode-toggle";
import { OnlyMode } from "./mode-gate";
import { ModelSelect } from "./model-select";
import { A11yControls } from "./a11y-controls";

export function SiteHeader() {
  return (
    <header className="no-print sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="container flex h-16 items-center gap-3">
        <Link href="/" className="flex items-center gap-2" aria-label="법이음 홈">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-navy-700 to-sage-600 text-white shadow-md">
            <Scale className="h-5 w-5" aria-hidden />
          </span>
          <span className="whitespace-nowrap leading-tight">
            <span className="block text-base font-extrabold tracking-tight">법이음</span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">LAW:ON</span>
          </span>
        </Link>
        <nav className="ml-3 hidden items-center gap-0.5 whitespace-nowrap text-sm font-semibold md:flex" aria-label="주 메뉴">
          <OnlyMode mode="citizen">
            <Link href="/analyze" className="flex items-center gap-1.5 rounded-md px-2.5 py-2 text-accent hover:bg-secondary">
              <Gavel className="h-4 w-4" aria-hidden />
              상황 분석
            </Link>
          </OnlyMode>
          <Link href="/cases" className="flex items-center gap-1.5 rounded-md px-2.5 py-2 text-muted-foreground hover:bg-secondary hover:text-foreground">
            <Landmark className="h-4 w-4" aria-hidden />
            판례 보기
          </Link>
          <OnlyMode mode="officer">
            <Link href="/compliance" className="flex items-center gap-1.5 rounded-md px-2.5 py-2 text-accent hover:bg-secondary">
              <ScanSearch className="h-4 w-4" aria-hidden />
              자체규정 점검
            </Link>
            <Link href="/drafting" className="flex items-center gap-1.5 rounded-md px-2.5 py-2 text-accent hover:bg-secondary">
              <FilePenLine className="h-4 w-4" aria-hidden />
              제·개정 지원
            </Link>
          </OnlyMode>
          <Link href="/laws" className="flex items-center gap-1.5 rounded-md px-2.5 py-2 text-muted-foreground hover:bg-secondary hover:text-foreground">
            <BookOpenText className="h-4 w-4" aria-hidden />
            법령 둘러보기
          </Link>
          <Link href="/about" className="rounded-md px-2.5 py-2 text-muted-foreground hover:bg-secondary hover:text-foreground 2xl:inline-flex hidden">
            서비스 구조
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ModelSelect className="hidden 2xl:flex" />
          <A11yControls className="hidden 2xl:flex" />
          <ModeToggle />
        </div>
      </div>
      {/* 작은 화면: 보조 도구를 둘째 줄로 */}
      <div className="container flex items-center justify-between gap-2 overflow-x-auto pb-2 2xl:hidden">
        <OnlyMode mode="citizen">
          <Link href="/analyze" className="flex shrink-0 items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-bold text-accent md:hidden">
            <Gavel className="h-3.5 w-3.5" aria-hidden /> 상황 분석
          </Link>
        </OnlyMode>
        <Link href="/cases" className="flex shrink-0 items-center gap-1 rounded-full border bg-card px-3 py-1.5 text-xs font-bold md:hidden">
          <Landmark className="h-3.5 w-3.5" aria-hidden /> 판례
        </Link>
        <OnlyMode mode="officer">
          <Link href="/compliance" className="flex shrink-0 items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-bold text-accent md:hidden">
            <ScanSearch className="h-3.5 w-3.5" aria-hidden /> 규정 점검
          </Link>
          <Link href="/drafting" className="flex shrink-0 items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-bold text-accent md:hidden">
            <FilePenLine className="h-3.5 w-3.5" aria-hidden /> 제·개정
          </Link>
        </OnlyMode>
        <ModelSelect className="2xl:hidden" />
        <A11yControls className="ml-auto" />
      </div>
    </header>
  );
}
