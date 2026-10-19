"use client";
import * as React from "react";
import Link from "next/link";
import { Download } from "lucide-react";

/** 서버에 공유판 파일이 있을 때만(Python 실행판·Render) 내려받기 링크를 보여 줌 — 공유판 자신이나 개발 서버에서는 숨김 */
const SHARE_FILE = "/downloads/law-on-share.html";

function useShareFile() {
  const [ok, setOk] = React.useState(false);
  React.useEffect(() => {
    if ("__spaPathname" in window) return;
    fetch(SHARE_FILE, { method: "HEAD" })
      .then((r) => setOk(r.ok))
      .catch(() => setOk(false));
  }, []);
  return ok;
}

export function SiteFooter() {
  const share = useShareFile();
  return (
    <footer className="no-print mt-20 border-t bg-navy-700 text-navy-100 dark:bg-navy-900">
      <div className="container grid gap-6 py-10 text-sm md:grid-cols-3">
        <div>
          <p className="text-base font-extrabold text-white">법이음 · LAW:ON</p>
          <p className="mt-2 leading-6 text-navy-200">법은 가깝게, 권리는 든든하게. 어려운 법률을 일상의 언어로 연결합니다.</p>
        </div>
        <div className="leading-6 text-navy-200">
          <p className="font-semibold text-white">법령 데이터</p>
          <p>
            국가법령정보센터 공동활용 Open API(<a className="underline" href="https://open.law.go.kr" target="_blank" rel="noreferrer">open.law.go.kr</a>) 연동 · 인증키 미설정 시 국가법령정보센터에서 수집한 원문 스냅샷 사용
          </p>
        </div>
        <div className="leading-6 text-navy-200">
          <p className="font-semibold text-white">안내</p>
          <p>본 서비스는 법률 정보 제공 목적이며 개별 사안에 대한 법률 자문이 아닙니다. 중요한 결정 전에는 반드시 원문과 전문가 상담을 확인하세요.</p>
          <p className="mt-2">
            <Link href="/about" className="underline">서비스 구조·AI 검증 방식</Link>
          </p>
          {share && (
            <p className="mt-3">
              <a href={SHARE_FILE} download="LAW-ON_share.html" className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 font-semibold text-white hover:bg-white/20">
                <Download className="h-4 w-4" aria-hidden /> 공유판 내려받기
              </a>
              <span className="mt-1 block text-xs text-navy-200">HTML 한 파일(약 10MB) · 더블클릭하면 서버 없이 열리고, lawon.onrender.com 이 켜져 있으면 판례까지 실시간</span>
            </p>
          )}
        </div>
      </div>
    </footer>
  );
}
