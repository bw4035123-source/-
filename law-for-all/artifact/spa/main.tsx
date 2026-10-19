/** 단일 파일 공유판 — 실제 앱 화면(app/·components/)을 해시 라우터로 묶어 브라우저만으로 실행 */
import "./api";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { getRoute, subscribe } from "./router";
import { SettingsProvider } from "@/components/providers/settings-provider";
import { ToastProvider } from "@/components/ui/toast";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import HomePage from "@/app/page";
import SearchPage from "@/app/search/page";
import AnalyzePage from "@/app/analyze/page";
import CompliancePage from "@/app/compliance/page";
import DraftingPage from "@/app/drafting/page";
import LawsPage from "@/app/laws/page";
import LawPage from "@/app/laws/[id]/page";
import CasesPage from "@/app/cases/page";
import ReportPage from "@/app/report/page";
import AboutPage from "@/app/about/page";
import NotFound from "@/app/not-found";
import { getMockLaw } from "@/lib/law-api/mock";

const PAGES: Record<string, { C: React.ComponentType; title: string }> = {
  "/": { C: HomePage, title: "" },
  "/search": { C: SearchPage, title: "검색 결과" },
  "/analyze": { C: AnalyzePage, title: "AI 법률 상황 분석실" },
  "/compliance": { C: CompliancePage, title: "자체규정 점검" },
  "/drafting": { C: DraftingPage, title: "규정 제·개정 지원" },
  "/laws": { C: LawsPage, title: "법령 둘러보기" },
  "/cases": { C: CasesPage, title: "판례 보기" },
  "/report": { C: ReportPage, title: "법률 리포트" },
  "/about": { C: AboutPage, title: "서비스 구조" },
};

function App() {
  const route = React.useSyncExternalStore(subscribe, getRoute, getRoute);
  const law = route.path.match(/^\/laws\/([^/]+)$/);
  const page = law ? { C: LawPage, title: getMockLaw(decodeURIComponent(law[1]))?.name ?? "법령 본문" } : PAGES[route.path] ?? { C: NotFound, title: "페이지를 찾을 수 없습니다" };
  React.useEffect(() => {
    document.title = page.title ? `${page.title} | 법이음` : "법이음 (LAW:ON) — AI 법률 지능형 포털";
    window.scrollTo(0, 0);
  }, [route.path, route.qs, page.title]);
  return (
    <SettingsProvider>
      <ToastProvider>
        <SiteHeader />
        <main id="main" tabIndex={-1} className="focus:outline-none">
          <page.C key={`${route.path}?${route.qs}`} />
        </main>
        <SiteFooter />
      </ToastProvider>
    </SettingsProvider>
  );
}

createRoot(document.getElementById("app")!).render(<App />);
