"use client";
import * as React from "react";

/**
 * 법령 로딩 표시 — 순수 CSS 책장 넘김(외부 이미지 없음) + 0.1초 단위 경과 시간(스톱워치).
 * 독립 HTML 판: public/law-loader.html(LawLoader.show/hide). 스타일은 app/globals.css 의 .law-loader*.
 */
export function LawLoader({ message = "법령 정보를 불러오는 중입니다", sub, className = "" }: { message?: string; sub?: React.ReactNode; className?: string }) {
  const [sec, setSec] = React.useState(0);
  React.useEffect(() => {
    const started = performance.now();
    const t = setInterval(() => setSec((performance.now() - started) / 1000), 100);
    return () => clearInterval(t);
  }, []);
  return (
    <div className={`law-loader-card ${className}`} role="status" aria-live="polite" aria-busy="true">
      <div className="law-book" aria-hidden="true">
        <div className="law-book__cover" />
        <div className="law-book__side law-book__side--left" />
        <div className="law-book__side law-book__side--right" />
        <div className="law-book__page" />
        <div className="law-book__page" />
        <div className="law-book__page" />
      </div>
      <p className="law-loader__msg">
        {message.replace(/[.…]+$/, "")}
        <span className="law-loader__dots" aria-hidden="true" />
      </p>
      <p className="law-loader__timer">
        경과 시간: <b>{sec.toFixed(1)}</b>초
      </p>
      {sub && <div className="law-loader__sub">{sub}</div>}
    </div>
  );
}
