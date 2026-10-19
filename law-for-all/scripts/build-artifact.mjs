// 단일 파일 공유판 빌드: artifact/ 의 화면 + lib/ 의 실제 엔진(규칙기반 답변·상황 분석·내규 교차검증·문서 추출·내장 원문)을
// 한 개의 HTML(dist/law-on-artifact.html)로 묶는다. 서버·API 키 없이 브라우저만으로 동작한다.
//   node scripts/build-artifact.mjs
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const p = (...a) => path.join(root, ...a);
fs.mkdirSync(p("dist"), { recursive: true });

const empty = p("dist", ".artifact-empty.js");
fs.writeFileSync(empty, "export {};");
const out = await build({
  entryPoints: [p("artifact", "entry.ts")],
  bundle: true,
  format: "iife",
  globalName: "LAWON",
  platform: "browser",
  target: "es2020",
  minify: true,
  write: false,
  alias: { "server-only": empty, "@": root },
  define: { "process.env": "{}" },
  logLevel: "warning",
  plugins: [
    {
      // 워커 파일 경로 대신 전역 값(페이지 안 처리이므로 비어 있어도 됨)
      name: "pdf-worker-url",
      setup(b) {
        b.onLoad({ filter: /doc-extract\.ts$/ }, (a) => ({ contents: fs.readFileSync(a.path, "utf8").replace('"/pdf.worker.min.js"', "globalThis.__PDF_WORKER_URL"), loader: "ts" }));
      },
    },
  ],
});
fs.unlinkSync(empty);

const engine = out.outputFiles[0].text;
// pdf.js 워커 코드를 전역 pdfjsWorker 로 노출 → pdf.js 가 별도 워커·동적 import 없이 페이지 안에서 처리(공유 페이지 보안 정책에서도 동작)
const worker = (
  await build({ entryPoints: [p("node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs")], bundle: true, format: "iife", globalName: "pdfjsWorker", platform: "browser", target: "es2020", minify: true, write: false, logLevel: "warning" })
).outputFiles[0].text;
for (const [name, src] of [["engine", engine], ["pdf worker", worker]]) {
  if (/<\/script|<!--/i.test(src)) throw new Error(`${name} 에 HTML 파서가 오해할 문자열이 있습니다`);
}
if (!engine.includes("__PDF_WORKER_URL")) throw new Error("PDF 워커 경로 치환 실패");

const html = fs
  .readFileSync(p("artifact", "index.html"), "utf8")
  .replace("/*@@CSS@@*/", () => fs.readFileSync(p("artifact", "app.css"), "utf8"))
  .replace("/*@@PDF_WORKER@@*/", () => worker)
  .replace("/*@@ENGINE@@*/", () => engine)
  .replace("/*@@APP@@*/", () => fs.readFileSync(p("artifact", "app.js"), "utf8"));
// 인증키가 섞여 들어가지 않았는지: 키 값은 코드에 적지 않고, 이 PC의 환경변수·.env.local 에서 읽어 비교한다
const keys = new Set([process.env.LAW_API_OC, process.env.LAW_OC].filter(Boolean));
for (const f of [p(".env.local"), p("python", ".env.local")]) {
  if (!fs.existsSync(f)) continue;
  const m = fs.readFileSync(f, "utf8").match(/^\s*LAW_API_OC\s*=\s*["']?([^"'\s#]+)/m);
  if (m) keys.add(m[1]);
}
if (/LAW_API_OC=\S/.test(html) || [...keys].some((k) => k.length >= 4 && html.includes(k))) throw new Error("인증키로 보이는 문자열이 포함되어 있습니다");
fs.writeFileSync(p("dist", "law-on-artifact.html"), html);
console.log(`✔ dist/law-on-artifact.html (${(html.length / 1024 / 1024).toFixed(2)} MB)`);
