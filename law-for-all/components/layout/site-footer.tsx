import Link from "next/link";

export function SiteFooter() {
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
        </div>
      </div>
    </footer>
  );
}
