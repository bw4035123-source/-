/**
 * Python 실행판 빌드: 정적 화면(Next.js export) + 데이터 JSON + Python 서버 → dist/law-on-python.zip
 *   node scripts/build-python.mjs
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const run = (cmd, env = {}) => execSync(cmd, { cwd: root, stdio: "inherit", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ...env } });

// 1) 데이터·프롬프트·동등성 기준 결과 내보내기(단일 원천: TypeScript)
run("npx tsx scripts/export-data.ts");
run("npx tsx --conditions=react-server scripts/export-parity.ts");

// 2) 정적 화면 빌드(API 라우트는 Python 서버가 제공하므로 잠시 제외)
const api = path.join(root, "app/api");
const parked = path.join(root, ".api-parked");
fs.renameSync(api, parked);
try {
  fs.rmSync(path.join(root, "out"), { recursive: true, force: true });
  run("npx next build", { NEXT_OUTPUT: "export" });
} finally {
  fs.renameSync(parked, api);
}

// 3) web/ 교체
const web = path.join(root, "python/law_for_all/web");
fs.rmSync(web, { recursive: true, force: true });
fs.cpSync(path.join(root, "out"), web, { recursive: true });

// 4) Python 테스트 후 zip 생성
execSync("python3 -m unittest discover -s tests -t .", { cwd: path.join(root, "python"), stdio: "inherit" });
const dist = path.join(root, "dist");
const stage = path.join(dist, "law-on-python");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
for (const f of ["run.py", "run.sh", "run.bat", "실행.bat", "키설정.bat", "setup-key.bat", "README.md", ".env.example", "law_for_all", "tests"]) {
  fs.cpSync(path.join(root, "python", f), path.join(stage, f), { recursive: true, filter: (s) => !s.includes("__pycache__") });
}
execSync("python3 -m zipfile -c law-on-python.zip law-on-python", { cwd: dist, stdio: "inherit" });
console.log(`\n✔ ${path.join(dist, "law-on-python.zip")}`);
