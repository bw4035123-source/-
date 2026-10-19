// 제3자 오픈소스 라이선스 목록 생성: 실행·배포물에 들어가는 npm 패키지(개발 도구 제외) + 글꼴 + 데이터
//   node scripts/licenses.mjs   → docs/THIRD_PARTY_LICENSES.md
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dirs = execSync("npm ls --omit=dev --all --parseable", { cwd: root, encoding: "utf8" }).trim().split("\n").slice(1);
const rows = new Map();
for (const d of dirs) {
  const p = JSON.parse(fs.readFileSync(path.join(d, "package.json"), "utf8"));
  const lic = typeof p.license === "string" ? p.license : [].concat(p.license ?? p.licenses ?? []).map((l) => l.type ?? l).join(" OR ") || "UNKNOWN";
  rows.set(`${p.name}@${p.version}`, { name: p.name, version: p.version, lic });
}
const list = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
const count = list.reduce((m, r) => m.set(r.lic, (m.get(r.lic) ?? 0) + 1), new Map());
const md = [
  "# 제3자 구성요소 라이선스",
  "",
  "법이음(LAW:ON) 자체 코드는 MIT 라이선스(저장소 `LICENSE`)입니다. 실행·배포물에 포함되는 외부 구성요소는 아래와 같으며, **재배포가 제한되는 구성요소는 없습니다**(모두 재배포·수정·상업 이용 허용 라이선스).",
  "",
  "## 요약",
  "",
  "| 라이선스 | 개수 |",
  "|---|---|",
  ...[...count].sort((a, b) => b[1] - a[1]).map(([l, n]) => `| ${l} | ${n} |`),
  "",
  "## 실행판(Python)",
  "",
  "- Python 표준 라이브러리만 사용(추가 설치 패키지 없음) — PSF License",
  "",
  "## 글꼴·데이터",
  "",
  "| 구성요소 | 라이선스 | 비고 |",
  "|---|---|---|",
  "| Pretendard GOV (orioncactus/pretendard) | SIL Open Font License 1.1 | `public/fonts/pretendard-gov/LICENSE.txt` 동봉 |",
  "| 법령·판례 원문(국가법령정보센터) | 저작권법 제7조(보호받지 못하는 저작물) | 법령·판결 원문은 저작권 보호 대상 아님. 출처 표시 |",
  "| 국가법령정보 공동활용 Open API | 이용약관에 따름 | 인증키는 이용 기관(서버)별 발급, 산출물에 미포함 |",
  "| LLM 모델(EXAONE·Gemma·Llama 등, 선택) | 각 모델 라이선스 | 산출물에 포함하지 않음 — 사용자가 Ollama 등으로 별도 설치 |",
  "",
  "## npm 패키지(웹 화면·공유판에 포함, 개발 도구 제외)",
  "",
  "| 패키지 | 버전 | 라이선스 |",
  "|---|---|---|",
  ...list.map((r) => `| ${r.name} | ${r.version} | ${r.lic} |`),
  "",
  "※ caniuse-lite(CC-BY-4.0)는 Next.js 빌드 시 브라우저 호환 데이터로만 쓰이며 출처 표시 조건을 이 문서로 충족합니다.",
  "",
];
fs.writeFileSync(path.join(root, "docs", "THIRD_PARTY_LICENSES.md"), md.join("\n"));
console.log(`✔ docs/THIRD_PARTY_LICENSES.md (${list.length}개 패키지)`);
