// 단일 파일 공유판 빌드: 실제 앱 화면(app/·components/)과 API 처리기·엔진·내장 원문을 한 개의 HTML 로 묶는다.
// 실시간 서버(LAW_ON_REMOTE, 기본 lawon.onrender.com)가 응답하면 판례·실시간 법령까지, 아니면 내장 공식 원문·규칙기반 엔진으로 동작.
//   node scripts/build-python.mjs   # 먼저 실행(정적 빌드의 Tailwind CSS 를 가져옴)
//   node scripts/build-artifact.mjs
// 결과: dist/law-on-artifact.html(Claude Artifact 게시용 — 문서 머리 없이) · dist/law-on-공유판.html(더블클릭으로 여는 완전한 HTML)
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const p = (...a) => path.join(root, ...a);
fs.mkdirSync(p("dist"), { recursive: true });

// 실시간 서버(판례·전체 법령) — 응답이 없으면 공유판은 내장 엔진으로 동작. LAW_ON_REMOTE="" 로 끌 수 있음
const REMOTE = process.env.LAW_ON_REMOTE ?? "https://lawon.onrender.com";

// 1) 정적 빌드의 Tailwind CSS(실제 앱과 같은 스타일)
const cssDirs = [p("python", "law_for_all", "web", "_next", "static", "css"), p("out", "_next", "static", "css"), p("dist", "law-on-python", "law_for_all", "web", "_next", "static", "css")];
const cssDir = cssDirs.find((d) => fs.existsSync(d));
if (!cssDir) throw new Error("정적 빌드 CSS가 없습니다 — 먼저 node scripts/build-python.mjs 를 실행하세요");
const appCss = fs.readdirSync(cssDir).filter((f) => f.endsWith(".css")).map((f) => fs.readFileSync(path.join(cssDir, f), "utf8")).join("\n");

// 2) 테마 CSS + Pretendard GOV 글꼴(분할 글꼴을 data URI 로 넣어 폐쇄망·파일로 열어도 같은 모양)
const fontDir = p("public", "fonts", "pretendard-gov");
const fontCss = fs.readFileSync(path.join(fontDir, "pretendardvariable-gov-dynamic-subset.css"), "utf8").replace(/url\(\.\/(woff2-dynamic-subset\/[^)]+\.woff2)\)/g, (_, f) => `url(data:font/woff2;base64,${fs.readFileSync(path.join(fontDir, f)).toString("base64")})`);
const govCss = fs.readFileSync(p("public", "gov-challenge-2026.css"), "utf8").replace(/@import\s+url\([^)]*pretendard[^)]*\);?/i, "");
const govJs = fs.readFileSync(p("public", "gov-challenge-2026.js"), "utf8");

// 3) 앱(React 화면 + API 처리기 + 엔진)
const shim = (f) => p("artifact", "spa", "shims", f);
const empty = p("dist", ".artifact-empty.js");
fs.writeFileSync(empty, "export {};");
const app = (
  await build({
    entryPoints: [p("artifact", "spa", "main.tsx")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    minify: true,
    write: false,
    jsx: "automatic",
    alias: { "server-only": empty, "next/link": shim("link.tsx"), "next/navigation": shim("navigation.ts"), "next/server": shim("server.ts"), "@": root },
    define: { "process.env.NODE_ENV": '"production"', "process.env.LAW_PROXY_URL": '"off"', "process.env": "{}", __LAW_ON_REMOTE__: JSON.stringify(REMOTE) },
    logLevel: "error",
    plugins: [
      {
        name: "spa-patches",
        setup(b) {
          // PDF 워커: 페이지 안 전역 pdfjsWorker 로 처리(워커 파일 경로 불필요)
          b.onLoad({ filter: /doc-extract\.ts$/ }, (a) => ({ contents: fs.readFileSync(a.path, "utf8").replace('"/pdf.worker.min.js"', '""'), loader: "ts" }));
          // 모의데이터 파일: 파일로 열어도(file://) 읽히도록 data URI 로 넣는다
          b.onLoad({ filter: /mock-files\.ts$/ }, (a) => ({
            contents: fs.readFileSync(a.path, "utf8").replace(/"\/mock\/([^"]+)"/g, (_, f) => `"data:application/octet-stream;base64,${fs.readFileSync(p("public", "mock", f)).toString("base64")}"`),
            loader: "ts",
          }));
          // 법령 본문 화면: 주소 경로 대신 해시 라우터 경로를 읽게
          b.onLoad({ filter: /law-page-client\.tsx$/ }, (a) => ({ contents: fs.readFileSync(a.path, "utf8").replace(/window\.location\.pathname/g, "window.__spaPathname()"), loader: "tsx" }));
        },
      },
    ],
  })
).outputFiles[0].text;
fs.unlinkSync(empty);

// pdf.js 워커 코드를 전역 pdfjsWorker 로 노출 → 별도 워커·동적 import 없이 페이지 안에서 처리
const worker = (
  await build({ entryPoints: [p("node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs")], bundle: true, format: "iife", globalName: "pdfjsWorker", platform: "browser", target: "es2020", minify: true, write: false, logLevel: "warning" })
).outputFiles[0].text;
for (const [name, src] of [["app", app], ["pdf worker", worker], ["theme js", govJs]]) {
  if (/<\/script|<!--/i.test(src)) throw new Error(`${name} 에 HTML 파서가 오해할 문자열이 있습니다`);
}

const page = fs
  .readFileSync(p("artifact", "index.html"), "utf8")
  .replace("/*@@CSS@@*/", () => [fontCss, appCss, govCss].join("\n"))
  .replace("/*@@PDF_WORKER@@*/", () => worker)
  .replace("/*@@APP@@*/", () => app)
  .replace("/*@@GOV_JS@@*/", () => govJs);

// 인증키가 섞여 들어가지 않았는지: 키 값은 코드에 적지 않고, 이 PC의 환경변수·.env.local 에서 읽어 비교한다
const keys = new Set([process.env.LAW_API_OC, process.env.LAW_OC].filter(Boolean));
for (const f of [p(".env.local"), p("python", ".env.local")]) {
  if (!fs.existsSync(f)) continue;
  const m = fs.readFileSync(f, "utf8").match(/^\s*LAW_API_OC\s*=\s*["']?([^"'\s#]+)/m);
  if (m) keys.add(m[1]);
}
if (/LAW_API_OC=\S/.test(page) || [...keys].some((k) => k.length >= 4 && page.includes(k))) throw new Error("인증키로 보이는 문자열이 포함되어 있습니다");

fs.writeFileSync(p("dist", "law-on-artifact.html"), page);
const standalone = `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${page}\n</body>\n</html>\n`;
fs.writeFileSync(p("dist", "law-on-공유판.html"), standalone);
console.log(`✔ dist/law-on-artifact.html · dist/law-on-공유판.html (${(standalone.length / 1024 / 1024).toFixed(2)} MB)`);
