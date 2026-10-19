// 시연영상 자동 녹화 — 실행 중인 법이음을 브라우저로 조작하며 자막·내레이션과 함께 녹화하고 mp4로 변환한다.
//   node scripts/record-demo.mjs [기본주소] [출력.mp4] [내레이션폴더]
//   내레이션폴더: scripts/tts_narration.py 로 만든 s00.wav… + durations.json (없으면 자막만)
//   NO_AUDIO=1 이면 내레이션 길이로 장면 시간만 맞추고 음성은 넣지 않는다(자막만)
//   판례 장면은 서버가 국가법령정보 실시간 연결(/api/cases 의 live)일 때만 넣는다.
// 필요: Playwright(Chromium), ffmpeg(libx264, aac)
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
const NARR = process.argv[4] ? path.resolve(process.argv[4]) : null;
const DUR = NARR ? JSON.parse(fs.readFileSync(path.join(NARR, "durations.json"), "utf8")) : {};
const AUDIO = !!NARR && !process.env.NO_AUDIO;
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
const t0 = Date.now();
page.setDefaultTimeout(20000);
const wait = (ms) => page.waitForTimeout(ms);
const cap = async (main, sub = "") => {
  await page.evaluate((h) => window.__setCap(h), main ? `${main}${sub ? `<small>${sub}</small>` : ""}` : "").catch(() => {});
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
const has = async (loc) => (await loc.count()) > 0 && (await loc.first().isVisible().catch(() => false));
const scrollBy = async (dy, steps = 12) => {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy / steps);
    await wait(40);
  }
};
const scrollToEl = (sel, off = 150) =>
  page.evaluate(([q, o]) => {
    const el = document.querySelector(q);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - o, behavior: "smooth" });
  }, [sel, off]);
const setMode = (mode, fontScale = 1) => page.evaluate(([m, f]) => localStorage.setItem("law-for-all:settings:v1", JSON.stringify({ mode: m, fontScale: f })), [mode, fontScale]);

// 장면: 내레이션이 끝날 때까지는 다음 장면으로 넘어가지 않는다
const cues = [];
let sceneEnd = 0;
async function scene(id, main, sub, fn) {
  const now = Date.now();
  if (now < sceneEnd) await wait(sceneEnd - now);
  const start = Date.now();
  if (DUR[id]) cues.push({ id, at: (start - t0) / 1000 });
  sceneEnd = start + (DUR[id] ?? 4) * 1000 + 700;
  if (main !== null) await cap(main, sub);
  await fn();
}

const casesLive = await fetch(`${BASE}/api/cases?q=${encodeURIComponent("임금")}&limit=1`).then((r) => r.json()).then((j) => !!j.live).catch(() => false);
console.log(`판례 실시간: ${casesLive ? "예" : "아니오(판례 장면 생략)"}`);

await page.goto(BASE + "/");
await setMode("citizen");
await page.reload();
await wait(800);

let introAt = 0; // 표지가 뜬 시각 — 그 앞(빈 화면·첫 로딩)은 잘라 낸다
await scene("s00", null, "", async () => {
  await card(`<span class="chip">2026 공공 AI 대전환 챌린지 · 세션 1</span><h1>법이음 (LAW:ON)</h1><p>국민에게는 쉬운 말로, 공직자에게는 정확한 근거로<br>근거 조문을 먼저 찾고 답하는 AI 법률 지능형 포털</p>`);
  await wait(300);
  introAt = (Date.now() - t0) / 1000;
});
await scene("s01", "① 국민 모드 — 궁금한 상황을 일상 언어로 물어봅니다", "예: 퇴사했는데 마지막 월급을 안 줘요", async () => {
  await card("");
  await wait(1200);
  const input = page.locator("main form input").first();
  await click(input);
  await input.type("퇴사했는데 마지막 월급을 안 줘요", { delay: 75 });
});
await scene("s02", "문장마다 근거 조문 번호 — 근거 목록 밖 인용은 자동 제거(환각 방지)", "AI가 지어낸 가짜 조문·판례를 막습니다", async () => {
  await page.keyboard.press("Enter");
  await page.waitForURL(/search/);
  await wait(1500);
});
await scene("s03", "근거 번호를 누르면 AI 문장이 아닌 법령 원문 전문", "「근로기준법」 제36조(금품 청산) — 국가법령정보센터 원문", async () => {
  await click(page.locator("[aria-label^='근거 1:']").first());
});
await scene("s04", "어려운 말 풀이 · 지금 해야 할 3단계 행동 안내", "단계마다 근거 조문 표시", async () => {
  await page.keyboard.press("Escape");
  await wait(500);
  await scrollBy(560);
});
await scene("s05", "도움받을 수 있는 곳 — 관련 기관 전화번호·누리집 바로 연결", "고용노동부 고객상담센터 ☎1350 · 대한법률구조공단 ☎132", async () => {
  const sec = page.locator("text=도움받을 수 있는 곳").first();
  if (await has(sec)) {
    await page.evaluate(() => {
      const h = [...document.querySelectorAll("h2,h3")].find((x) => x.textContent.includes("도움받을 수 있는 곳"));
      if (h) window.scrollTo({ top: h.getBoundingClientRect().top + window.scrollY - 220, behavior: "smooth" });
    });
    await wait(1200);
    const box = page.locator("section, div.rounded-2xl", { has: page.locator("h2, h3", { hasText: "도움받을 수 있는 곳" }) }).last();
    for (const loc of [box.locator("a[href^='tel:']").first(), box.locator("a[href^='tel:']").nth(1), box.locator("a", { hasText: "바로가기" }).first()]) {
      if (!(await has(loc))) continue;
      const bx = await loc.boundingBox();
      if (bx) await page.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2, { steps: 18 });
      await wait(1600);
    }
  }
});
if (casesLive) {
  await scene("s06", "비슷한 사건, 법원은 어떻게 판단했을까요? — 판례 실시간 조회", "국가법령정보센터 Open API · 확인되지 않은 사건번호는 만들지 않음", async () => {
    await page.evaluate(() => {
      const h = [...document.querySelectorAll("h2,h3")].find((x) => x.textContent.includes("법원은 어떻게"));
      if (h) window.scrollTo({ top: h.getBoundingClientRect().top + window.scrollY - 160, behavior: "smooth" });
    });
    await page.locator("button", { hasText: "판례 보기" }).first().waitFor({ timeout: 30000 }).catch(() => {});
    await wait(1200);
    const item = page.locator("button", { hasText: "판례 보기" }).first();
    if (await has(item)) {
      await click(item);
      await wait(1200);
      await cap("판례 뷰어 — 판시사항 · 판결요지 · 참조조문 · 전문, 국민 모드는 쉬운 설명", "인용 표기 복사 · 국가법령정보센터 원문 링크");
      await wait(3500);
      await page.mouse.move(900, 450);
      await scrollBy(500);
    }
  });
}
await scene("s07", "② AI 법률 상황 분석실 — 사실관계 정리 · 관련 법령 추천", "당사자·금액·시점 자동 정리 → 관련도 순 법령 추천", async () => {
  await page.keyboard.press("Escape").catch(() => {});
  await page.goto(BASE + "/analyze");
  await wait(1000);
  await click(page.locator("button", { hasText: "전세 보증금" }).first());
  await wait(600);
  await click(page.locator("button", { hasText: /3관점 분석/ }).first());
  await wait(1800);
  await scrollBy(520);
});
await scene("s08", "변호사 · 검사 · 판사 3관점 검토 — 판사 관점은 요건 충족표", "모든 관점 문장도 같은 인용 검증을 거칩니다", async () => {
  await scrollBy(900, 16);
});
await scene("s09", "어르신도 편하게 — 글자 크기 3단계, 말 묶음 단위 줄바꿈", "", async () => {
  await page.goto(BASE + "/");
  await wait(700);
  await click(page.locator("[aria-label='아주 큰 글자']:visible").first());
  await wait(2200);
  await click(page.locator("[aria-label='기본 글자 크기']:visible").first());
});
await scene("s10", "③ 공직자 모드로 전환 — 같은 엔진, 실무용 화면", "근로기준법 · 지방공기업법 · 공직선거법 · 부정청탁금지법 · 공유재산법", async () => {
  await click(page.locator("[aria-label='공직자 모드 전환']:visible").first());
});
await scene("s11", "검토 결론 → 법적 근거 체계 → 주요 쟁점 → 업무 유의사항 → 체크리스트", "보고서체로 정리 · 인용문 복사로 공문서에 바로 활용", async () => {
  await click(page.locator("button", { hasText: "부정청탁금지법" }).first());
  await page.waitForURL(/search/);
  await wait(2500);
  await scrollBy(500);
});
await scene("s12", "보고서 한 번에 작성 — 검토 보고서 · 기안문 · 민원 회신문 · 붙임 4종", "검증된 답변·근거 원문만 공문서 서식에 배치 · Word 저장", async () => {
  const pack = page.locator("button", { hasText: "보고서 한 번에 작성" }).first();
  if (await has(pack)) await click(pack);
});
await scene("s13", "④ 자체규정 점검 — 우리 기관 규정 파일(한글·PDF·Word)을 넣으면", "파일은 서버로 보내지 않고 브라우저 안에서만 읽습니다", async () => {
  await page.keyboard.press("Escape");
  await page.goto(BASE + "/compliance");
  await wait(1200);
  await point(page.locator("main select").first());
  await page.locator("main select").first().selectOption("지방공기업");
  await wait(600);
  await point(page.locator("[aria-label^='규정 파일 올리기']").first());
  await page.setInputFiles("input[type=file]", { name: path.basename(MOCK), mimeType: "application/octet-stream", buffer: fs.readFileSync(MOCK) });
  await wait(1500);
  await cap("모의데이터: 가상시설관리공단 복무 및 보수 규정(한글 HWPX) — 조문 11개 인식", "");
});
await scene("s14", "상위법령과 조문 단위 대조 — 상충 7 · 검토 필요 1 · 적합 1", "판정은 생성형 문장이 아니라 정해진 기준과 조문 원문으로", async () => {
  await click(page.locator("button", { hasText: "상위법령과 교차 검증" }));
  await wait(1000);
  await scrollToEl("#compliance-result");
});
await scene("s15", "1주 45시간 → 법정 40시간 초과 · 수치 위반은 개정안 자동 제안", "현행 ↔ 개정안 대비 · 근거 조문 버튼 · 보고서 복사", async () => {
  await scrollBy(700);
  await wait(2500);
  await scrollBy(800, 14);
});
await scene("s16", "⑤ 규정 제·개정 지원 — 바꾸고 싶은 내용을 말하듯 적으면", "신·구조문 대비표 · 정합성 점검 · 개정이유 · 부칙 · 입법예고문 초안", async () => {
  await page.goto(BASE + "/drafting");
  await wait(900);
  await click(page.locator("button", { hasText: "직접 입력" }).first());
  await page.locator("input[placeholder^='규정명']").first().fill("가상시 민원 처리 규정");
  await page.locator("input[placeholder='제5조(처리기간)']").first().fill("제5조(처리기간)");
  await page.locator("textarea[placeholder^='현행 조문']").first().fill("① 민원인이 신청한 민원은 접수한 날부터 7일 이내에 처리하여야 한다.\n② 처리기간을 연장하는 경우에는 민원인에게 알려야 한다.");
  const ins = page.locator("textarea[placeholder^='예) 처리기간']").first();
  await click(ins);
  await ins.type("처리기간을 7일에서 5일로 단축\n‘민원인’을 ‘신청인’으로 변경", { delay: 35 });
  await click(page.locator("button", { hasText: "개정안 작성" }).first());
  await wait(1200);
  await scrollToEl("section[aria-label='개정안과 검토 결과']");
});
await scene("s17", "법제처 형식 조문 뷰어 · 3단 대조 · LLM 비종속", "EXAONE·Gemma·Llama·Solar(Ollama) · OpenAI 호환 · Claude — 설정만으로 교체", async () => {
  await page.goto(BASE + "/laws/labor-standards");
  await wait(4500);
  await page.goto(BASE + "/about");
  await wait(1000);
  await scrollBy(450);
});
await scene("s18", "", "", async () => {
  await cap("");
  await card(`<h1>법이음 (LAW:ON)</h1><ul><li>✔ 근거 조문을 먼저 찾고 인용 — 가짜 조문·판례 차단</li><li>✔ 국민 모드 · 공직자 모드 한 엔진 두 화면</li><li>✔ 판례 실시간 조회 · 관련 기관 연락처 안내</li><li>✔ 자체규정 점검 → 개정안 → 제·개정 문서까지</li><li>✔ LLM 비종속 · 키 없이도 동작 · 추가 설치 없는 실행판</li></ul><p style="font-size:20px;margin-top:10px">다른 기관 규정·법령은 데이터 추가만으로 확산</p>`);
});
await wait(Math.max(0, sceneEnd - Date.now()) + 800);

const video = page.video();
await ctx.close();
await b.close();
const webm = await video.path();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const args = ["-y", "-loglevel", "error", "-ss", introAt.toFixed(2), "-i", webm];
for (const c of cues) c.at = Math.max(0, c.at - introAt);
if (AUDIO && cues.length) {
  // 장면 시작 시각에 맞춰 내레이션을 깔고, 목소리를 또렷하게(저역 제거·음량 정규화)
  for (const c of cues) args.push("-i", path.join(NARR, `${c.id}.wav`));
  const parts = cues.map((c, i) => `[${i + 1}:a]aresample=48000,adelay=${Math.round(c.at * 1000)}|${Math.round(c.at * 1000)}[a${i}]`);
  const mix = `${cues.map((_, i) => `[a${i}]`).join("")}amix=inputs=${cues.length}:normalize=0,highpass=f=90,lowpass=f=9000,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;
  args.push("-filter_complex", [...parts, mix].join(";"), "-map", "0:v", "-map", "[aout]", "-c:a", "aac", "-b:a", "160k");
} else args.push("-an");
args.push("-c:v", "libx264", "-preset", "medium", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-shortest", OUT);
execFileSync("ffmpeg", args);
fs.rmSync(tmp, { recursive: true, force: true });
const dur = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", OUT]).toString().trim();
console.log(`✔ ${OUT} (${Math.round(Number(dur))}초, ${(fs.statSync(OUT).size / 1024 / 1024).toFixed(1)} MB, ${AUDIO ? `내레이션 ${cues.length}개` : "음성 없음"})`);
