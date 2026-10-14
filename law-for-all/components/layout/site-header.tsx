import Link from "next/link";
import { BookOpenText, Scale } from "lucide-react";
import { ModeToggle } from "./mode-toggle";
import { ModelSelect } from "./model-select";
import { A11yControls } from "./a11y-controls";

export function SiteHeader() {
  return (
    <header className="no-print sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="container flex h-16 items-center gap-3">
        <Link href="/" className="flex items-center gap-2" aria-label="모두의 법 홈">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-navy-700 to-sage-600 text-white shadow-md">
            <Scale className="h-5 w-5" aria-hidden />
          </span>
          <span className="leading-tight">
            <span className="block text-base font-extrabold tracking-tight">모두의 법</span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Law For All</span>
          </span>
        </Link>
        <nav className="ml-4 hidden items-center gap-1 text-sm font-semibold md:flex" aria-label="주 메뉴">
          <Link href="/laws" className="flex items-center gap-1.5 rounded-md px-3 py-2 text-muted-foreground hover:bg-secondary hover:text-foreground">
            <BookOpenText className="h-4 w-4" aria-hidden />
            법령 둘러보기
          </Link>
          <Link href="/about" className="rounded-md px-3 py-2 text-muted-foreground hover:bg-secondary hover:text-foreground">
            서비스 구조
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ModelSelect className="hidden lg:flex" />
          <A11yControls className="hidden xl:flex" />
          <ModeToggle />
        </div>
      </div>
      {/* 작은 화면: 보조 도구를 둘째 줄로 */}
      <div className="container flex items-center justify-between gap-2 overflow-x-auto pb-2 xl:hidden">
        <ModelSelect className="lg:hidden" />
        <A11yControls className="ml-auto" />
      </div>
    </header>
  );
}
