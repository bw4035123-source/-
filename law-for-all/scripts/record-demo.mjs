// 시연영상 자동 녹화 — 실행 중인 법이음(기본 http://127.0.0.1:8765)을 브라우저로 조작하며 자막과 함께 녹화하고 mp4로 변환한다.
//   node scripts/record-demo.mjs [기본주소] [출력.mp4]
// 필요: Playwright(Chromium), ffmpeg(libx264)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pwPath = (() => {
  for (const p of ["playwright", "/opt/node22/lib/node_modules/playwright"]) {
    try {
      return require.resolve(p);
    } catch {
      /* 다음 후보 */
    }
  }
  throw new Error("playwright 를 찾을 수 없습니다");
})();
const { chromium } = require(pwPath);

const BASE = process.argv[2] ?? "http://127.0.0.1:8765";
const OUT = path.resolve(process.argv[3] ?? "dist/demo.mp4");
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MOCK = path.join(root, "submission/mock-data/가상시설관리공단_복무및보수규정(모의).hwpx");
const W = 1280;
const H = 720;
const tmp = fs.mkdtempSync(path.join(path.dirname(OUT), ".rec-"));

const OVERLAY = () => {
  const mk = () => {
    if (document.getElementById("__cap")) return;
    const st = document.createElement("style");
    st.textContent = `#__cap{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);max-width:1100px;width:max-content;background:rgba(15,31,77,.94);color:#fff;font:600 21px/1.5 "Pretendard GOV Variable",sans-serif;padding:12px 26px;border-radius:14px;z-index:2147483647;box-shadow:0 10px 30px rgba(0,0,0,.25);text-align:center;word-break:keep-all;transition:opacity .25s}
#__cap small{display:block;font-weight:500;font-size:16px;opacity:.85;margin-top:2px}
#__cap:empty{opacity:0}
#__cur{position:fixed;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(37,99,235,.35);border:2px solid #2563eb;z-index:2147483647;pointer-events:none;transition:transform .12s}
#__cur.down{transform:scale(.7);background:rgba(37,99,235,.6)}
#__card{position:fixed;inset:0;z-index:2147483646;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:linear-gradient(135deg,#0f1f4d,#1e3a8a 55%,#2563eb);color:#fff;font-family:"Pretendard GOV Variable",sans-serif;text-align:center;padding:40px;word-break:keep-all}
#__card h1{font-size:52px;margin:0;font-weight:900;letter-spacing:-.02em}
#__card p{font-size:24px;margin:0;opacity:.92;line-height:1.6}
#__card .chip{background:#fff;color:#1e3a8a;font-weight:800;font-size:18px;padding:4px 16px;border-radius:999px}
#__card ul{list-style:none;padding:0;margin:8px 0 0;font-size:22px;line-height:1.9;text-align:left}`;
    document.documentElement.appendChild(st);
    const c = document.createElement("div");
    c.id = "__cap";
    document.documentElement.appendChild(c);
    const cur = document.createElement("div");
    cur.id = "__cur";
    cur.style.left = "-50px";
    document.documentElement.appendChild(cur);
    addEventListener("mousemove", (e) => {
      cur.style.left = e.clientX + "px";
      cur.style.top = e.clientY + "px";
    }, true);
    addEventListener("mousedown", () => cur.classList.add("down"), true);
    addEventListener("mouseup", () => cur.classList.remove("down"), true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mk);
  else mk();
  window.__setCap = (html) => {
    mk();
    document.getElementById("__cap").innerHTML = html;
  };
  window.__card = (html) => {
    mk();
    let el = document.getElementById("__card");
    if (!html) return el && el.remove();
    if (!el) {
      el = document.createElement("div");
      el.id = "__card";
      document.documentElement.appendChild(el);
    }
    el.innerHTML = html;
  };
};

const b = await chromium.launch({ executablePath: fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined });
const ctx = await b.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: tmp, size: { width: W, height: H } } });
await ctx.addInitScript(OVERLAY);
const page = await ctx.newPage();
const wait = (ms) => page.waitForTimeout(ms);
const cap = async (main, sub = "") => {
  await page.evaluate((h) => window.__setCap(h), main ? `${main}${sub ? `<small>${sub}</small>` : ""}` : "");
};
const card = (html) => page.evaluate((h) => window.__card(h), html);
const point = async (loc) => {
  await loc.scrollIntoViewIfNeeded();
  const bx = await loc.boundingBox();
  await page.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2, { steps: 18 });
  await wait(250);
};
const click = async (loc) => {
  await point(loc);
  await loc.click();
};
const scrollBy = async (dy, steps = 12) => {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy / steps);
    await wait(40);
  }
};
const setMode = (mode, fontScale = 1) => page.evaluate(([m, f]) => localStorage.setItem("law-for-all:settings:v1", JSON.stringify({ mode: m, fontScale: f })), [mode, fontScale]);

// ── 0. 표지
await page.goto(BASE + "/");
await setMode("citizen");
await page.reload();
await wait(800);
await card(`<span class="chip">2026 공공 AI 대전환 챌린지 · 세션 1</span><h1>법이음 (LAW:ON)</h1><p>국민에게는 쉬운 말로, 공직자에게는 정확한 근거로<br>근거 조문을 먼저 찾고 답하는 AI 법률 지능형 포털</p>`);
await wait(5500);
await card("");

// ── 1. 국민 모드: 질문 → 근거 있는 쉬운 답
await cap("① 국민 모드 — 궁금한 상황을 일상 언어로 물어봅니다", "인증키·LLM 없이도 내장 공식 원문(국가법령정보센터)과 규칙기반 엔진으로 동작");
await wait(3500);
const input = page.locator("main form input").first();
await click(input);
await input.type("퇴사했는데 마지막 월급을 안 줘요", { delay: 70 });
await wait(600);
await page.keyboard.press("Enter");
await page.waitForURL(/search/);
await wait(1800);
await cap("문장마다 근거 조문 번호 — 근거 목록 밖 인용은 자동 제거(환각 방지)", "어려운 말 풀이 · 지금 해야 할 3단계 · 도움받을 기관 연락처까지 한 화면에");
await wait(4500);
await click(page.locator("[aria-label^='근거 1:']").first());
await wait(1200);
await cap("근거 번호를 누르면 AI 문장이 아닌 법령 원문 전문이 열립니다", "「근로기준법」 제36조(금품 청산) — 국가법령정보센터 원문");
await wait(4500);
await page.keyboard.press("Escape");
await wait(600);
await scrollBy(700);
await cap("지금 이렇게 하세요 · 3단계 행동 안내 — 단계마다 근거 조문 표시", "PDF 법률 리포트 · 변호사·검사·판사 관점 분석으로 바로 이어집니다");
await wait(4500);
await scrollBy(600);
await wait(2500);

// ── 2. 상황 분석
await page.goto(BASE + "/analyze");
await wait(1200);
await cap("② AI 법률 상황 분석실 — 겪은 일을 자유롭게 이야기하면", "사실관계 정리 → 법률 쟁점 발견 → 관련 법령 추천 순위 → 3관점 검토");
await wait(2500);
await click(page.locator("button", { hasText: "전세 보증금" }).first());
await wait(1500);
await click(page.locator("button", { hasText: /3관점 분석/ }).first());
await wait(2000);
await scrollBy(520);
await cap("당사자·금액·시점을 자동으로 정리하고, 관련 법령을 관련도 순으로 추천", "추천마다 이유와 근거 조문 — 누르면 원문과 상·하위법령 연결");
await wait(5000);
await scrollBy(900, 16);
await cap("같은 사실을 변호사·검사·판사의 시각으로 — 판사 관점은 요건 충족표까지", "모든 관점 문장도 같은 인용 검증을 거칩니다");
await wait(5500);
await scrollBy(700);
await wait(2500);

// ── 3. 접근성
await page.goto(BASE + "/");
await wait(800);
await cap("어르신도 편하게 — 글자 크기 3단계, 말 묶음 단위 줄바꿈", "");
await click(page.locator("[aria-label='아주 큰 글자']:visible").first());
await wait(2500);
await click(page.locator("[aria-label='기본 글자 크기']:visible").first());
await wait(1200);

// ── 4. 공직자 모드: 검토 보고서
await cap("③ 공직자 모드로 전환 — 같은 엔진, 실무용 화면", "");
await click(page.locator("[aria-label='공직자 모드 전환']:visible").first());
await wait(2200);
await cap("공직자 핵심 법령 해시태그 — 근로기준법 · 지방공기업법 · 공직선거법 · 부정청탁금지법 · 공유재산법", "");
await wait(3500);
await click(page.locator("button", { hasText: "부정청탁금지법" }).first());
await page.waitForURL(/search/);
await wait(2200);
await cap("검토 결론 → 법적 근거 체계 → 주요 쟁점 → 업무 유의사항 → 확인 체크리스트", "보고서체로 정리 · 인용문 복사로 공문서에 바로 활용");
await wait(5000);
await scrollBy(650);
await wait(2500);
const pack = page.locator("button", { hasText: "보고서 한 번에 작성" }).first();
if (await pack.count()) {
  await click(pack);
  await wait(2200);
  await cap("보고서 한 번에 작성 — 검토 보고서 · 기안문 · 민원 회신문 · 붙임 4종 동시 작성", "검증된 답변·근거 원문만 공문서 서식에 배치 · Word 저장");
  await wait(5500);
  await page.keyboard.press("Escape");
  await wait(800);
}

// ── 5. 자체규정 점검
await page.goto(BASE + "/compliance");
await wait(1500);
await cap("④ 자체규정 점검 — 우리 기관 규정 파일(한글·PDF·Word)을 넣으면", "파일은 서버로 보내지 않고 브라우저 안에서만 읽습니다");
await wait(3500);
await point(page.locator("main select").first());
await page.locator("main select").first().selectOption("지방공기업");
await wait(700);
await point(page.locator("[aria-label^='규정 파일 올리기']").first());
await page.setInputFiles("input[type=file]", { name: path.basename(MOCK), mimeType: "application/octet-stream", buffer: fs.readFileSync(MOCK) });
await wait(2000);
await cap("모의데이터: 가상시설관리공단 복무 및 보수 규정(한글 HWPX) — 조문 11개 인식", "");
await wait(3000);
await click(page.locator("button", { hasText: "상위법령과 교차 검증" }));
await wait(1500);
await page.evaluate(() => {
  const el = document.getElementById("compliance-result");
  window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 150, behavior: "smooth" });
});
await wait(1500);
await cap("상위법령과 조문 단위 대조 — 상충 7 · 검토 필요 1 · 적합 1", "판정은 생성형 문장이 아니라 정해진 기준과 조문 원문으로");
await wait(5000);
await scrollBy(700);
await cap("1주 45시간 → 법정 40시간 초과 · 근거 조문 버튼 → 원문 확인", "근로시간·연차·가산수당·출산휴가·퇴직금품·해고예고·개정 절차까지 점검");
await wait(5000);
await scrollBy(900, 16);
await cap("수치 위반은 개정안을 자동 제안 — 현행 ↔ 개정안 대비, 보고서 복사", "");
await wait(5000);

// ── 6. 제·개정 지원
await page.goto(BASE + "/drafting");
await wait(1500);
await cap("⑤ 규정 제·개정 지원 — 바꾸고 싶은 내용을 말하듯 적으면", "개정안 · 신·구조문 대비표 · 정합성 점검 · 개정이유 · 부칙 · 입법예고문 초안");
await wait(3000);
await click(page.locator("button", { hasText: "직접 입력" }).first());
await wait(500);
const name = page.locator("input[placeholder^='규정명']").first();
await name.fill("가상시 민원 처리 규정");
await page.locator("input[placeholder='제5조(처리기간)']").first().fill("제5조(처리기간)");
await page.locator("textarea[placeholder^='현행 조문']").first().fill("① 민원인이 신청한 민원은 접수한 날부터 7일 이내에 처리하여야 한다.\n② 처리기간을 연장하는 경우에는 민원인에게 알려야 한다.");
const ins = page.locator("textarea[placeholder^='예) 처리기간']").first();
await click(ins);
await ins.type("처리기간을 7일에서 5일로 단축\n‘민원인’을 ‘신청인’으로 변경", { delay: 45 });
await wait(600);
await click(page.locator("button", { hasText: "개정안 작성" }).first());
await wait(2000);
await page.evaluate(() => {
  const el = document.querySelector("section[aria-label='개정안과 검토 결과']");
  window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 150, behavior: "smooth" });
});
await wait(1200);
await cap("신·구조문 대비표와 정합성 점검이 자동으로", "기간 변경·용어 변경 반영, 상위법 기준 초과 가능성 확인");
await wait(5000);
await scrollBy(420, 10);
await cap("개정이유·주요내용 · 부칙 · 입법예고문 · 절차 체크리스트 초안까지", "대비표 포함 Word 저장");
await wait(4500);

// ── 7. 법령·LLM
await page.goto(BASE + "/laws/labor-standards");
await wait(1800);
await cap("법제처 형식 조문 뷰어 · 상위법–시행령–시행규칙 3단 대조", "인증키를 넣으면 법령·행정규칙·자치법규·판례 전체를 실시간 조회");
await wait(4500);
await page.goto(BASE + "/about");
await wait(1500);
await cap("LLM 비종속 — EXAONE·Gemma·Llama·Solar(Ollama), OpenAI 호환, Claude를 설정만으로 교체", "어떤 모델이든 같은 인용 검증 가드 · 실패 시 규칙기반 답변으로 자동 대체");
await wait(5500);
await scrollBy(600);
await wait(2500);

// ── 8. 마무리
await cap("");
await card(`<h1>법이음 (LAW:ON)</h1><ul><li>✔ 근거 조문을 먼저 찾고 인용 — 가짜 조문·판례 차단</li><li>✔ 국민 모드 · 공직자 모드 한 엔진 두 화면</li><li>✔ 자체규정 점검 → 개정안 → 제·개정 문서까지</li><li>✔ LLM 비종속 · 키 없이도 동작 · 추가 설치 없는 실행판</li></ul><p style="font-size:20px;margin-top:10px">다른 기관 규정·법령은 데이터 추가만으로 확산</p>`);
await wait(6000);

const video = page.video();
await ctx.close();
await b.close();
const webm = await video.path();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", OUT]);
fs.rmSync(tmp, { recursive: true, force: true });
const dur = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", OUT]).toString().trim();
console.log(`✔ ${OUT} (${Math.round(Number(dur))}초, ${(fs.statSync(OUT).size / 1024 / 1024).toFixed(1)} MB)`);
