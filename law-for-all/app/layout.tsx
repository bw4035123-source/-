import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SettingsProvider } from "@/components/providers/settings-provider";
import { ToastProvider } from "@/components/ui/toast";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";

export const metadata: Metadata = {
  title: { default: "법이음 · LAW:ON", template: "%s · 법이음" },
  description: "어려운 법률·조례·행정규칙을 국민과 공직자 누구나 쉽게 찾고, 해석하고, 바로 활용하는 AI 법률 지능형 포털",
  applicationName: "법이음",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1E293B" },
    { media: "(prefers-color-scheme: dark)", color: "#0F172A" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        {/* 2026 공공 AI 대전환 챌린지 테마(독립 CSS)와 상단 배너(하이드레이션 후 주입) — public/gov-challenge-2026.* */}
        {/* eslint-disable-next-line @next/next/no-css-tags */}
        <link rel="stylesheet" href="/gov-challenge-2026.css" />
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/gov-challenge-2026.js" defer />
      </head>
      <body className="min-h-screen font-sans">
        <a href="#main" className="skip-link">
          본문 바로가기
        </a>
        <SettingsProvider>
          <ToastProvider>
            <SiteHeader />
            <main id="main" tabIndex={-1} className="focus:outline-none">
              {children}
            </main>
            <SiteFooter />
          </ToastProvider>
        </SettingsProvider>
      </body>
    </html>
  );
}
