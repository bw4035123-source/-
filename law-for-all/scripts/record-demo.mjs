// 시연영상 자동 녹화 — 실행 중인 법이음을 브라우저로 조작하며 자막·내레이션과 함께 녹화하고 mp4로 변환한다.
//   node scripts/record-demo.mjs [기본주소] [출력.mp4] [내레이션폴더]
//   내레이션폴더: scripts/tts_narration.py 로 만든 s00.wav… + durations.json (없으면 자막만)
//   NO_AUDIO=1(또는 내레이션폴더 없음)이면 자막만 — 장면 시간은 PLAN, 전체 길이는 TARGET_SEC(기본 210초)에 맞춘다
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
const TARGET = Number(process.env.TARGET_SEC ?? 210);
// SESSION=1: 세션 1(자유주제) — 국민 모드 중심 / SESSION=2: 세션 2(지정과제 ③ 규정 제·개정 에이전트) — 제·개정 지원 중심
const SESSION = Number(process.env.SESSION ?? 1);
// 자막만 녹화할 때 장면별 길이(초) — 자막을 읽을 시간 + 화면 동작. 마지막 장면(s18)은 남은 시간을 채운다
const PLAN = SESSION === 2
  ? { t00: 4, t01: 11, t02: 9, t03: 12, t04: 7.5, tL: 17, t05: 13, t06: 8.5, t07: 12, t08: 18, t08b: 10, t09: 11, tU1: 11, tU2: 15, t10: 12, t11: 9, t11c: 17, tW: 13, t12: 9, t13: 8 }
  : { s00: 3.5, s01: 8, s02: 7, s03: 6, s04: 5.5, sF1: 9, sF2: 9.5, s05: 8, s06: 12, s07: 12, s07b: 6, s08: 7, s09: 4.5, s10: 5.5, s11: 7.5, sM: 9, sR: 7, s12: 7, sC: 11, s13: 10, s14: 12, s15: 8, s16: 9.5, s17: 8, sE: 8, sAI: 8, sMob: 11 };
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
    const c = document.getElementById("__cap");
    if (c.innerHTML === html) return;
    c.style.opacity = "0";
    setTimeout(() => {
      c.innerHTML = html;
      c.style.opacity = html ? "1" : "0";
    }, 180);
  };
  window.__card = (html) => {
    mk();
    const cur = document.getElementById("__cur");
    if (cur) cur.style.display = html ? "none" : "";
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

// 녹화 전에 확인·예열(브라우저가 빈 화면일 때 걸린 시간은 영상 시간에 잡히지 않으므로 녹화 시작 전에 끝낸다)
const casesLive = await fetch(`${BASE}/api/cases?q=${encodeURIComponent("임금")}&limit=1`).then((r) => r.json()).then((j) => !!j.live).catch(() => false);
console.log(`판례 실시간: ${casesLive ? "예" : "아니오(판례 장면 생략)"}`);
if (!casesLive) (PLAN.s05 += 6), (PLAN.s11 += 5); // 판례 장면이 없으면 다른 장면에 시간을 나눠 준다

// 첫 검색 결과를 미리 한 번 불러 두어(서버 예열) 녹화 중 대기 시간을 줄인다
await fetch(`${BASE}/api/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "퇴사했는데 마지막 월급을 안 줘요", mode: "citizen" }) }).catch(() => {});

const b = await chromium.launch({ executablePath: fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined });
// 세션 1: 국민 모드 휴대폰 화면(아이폰 크기)을 녹화 전에 실제 서비스에서 찍어 두고 장면 카드에 보여 줌
const mobShots = [];
if (SESSION === 1) {
  const { devices } = require(pwPath);
  const mctx = await b.newContext({ ...devices["iPhone 13"] });
  const mp = await mctx.newPage();
  const shot = async () => `data:image/jpeg;base64,${(await mp.screenshot({ type: "jpeg", quality: 82 })).toString("base64")}`;
  try {
    await mp.goto(BASE + "/");
    await mp.waitForLoadState("networkidle").catch(() => {});
    await mp.waitForTimeout(1200);
    mobShots.push(await shot());
    await mp.goto(BASE + "/search?q=" + encodeURIComponent("퇴사했는데 마지막 월급을 안 줘요"));
    await mp.locator("button[aria-expanded]", { hasText: /근거 검증 통과|검수된 답변/ }).first().waitFor({ timeout: 90000 }).catch(() => {});
    await mp.waitForTimeout(800);
    await mp.evaluate(() => window.scrollTo({ top: 260 }));
    await mp.waitForTimeout(600);
    mobShots.push(await shot());
    const tel = mp.locator("a[href^='tel:']").first();
    if (await tel.count()) {
      await tel.evaluate((e) => e.scrollIntoView({ block: "center" }));
      await mp.waitForTimeout(700);
      mobShots.push(await shot());
    }
  } catch (e) {
    console.log("휴대폰 화면을 찍지 못함:", e.message);
  }
  await mctx.close();
}
const ctx = await b.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: tmp, size: { width: W, height: H } } });
await ctx.addInitScript(OVERLAY);
// 시연용 음성 입력 재현 — 녹화 환경에는 마이크가 없어, 브라우저 음성 인식 자리에 '말하는 동안 글이 늘어나다 확정되는' 결과를 넣는다.
// 화면의 자동 검색·취소 안내는 실제 기능 그대로이고, 영상 자막에 재현임을 표기한다.
await ctx.addInitScript(() => {
  class DemoRecognition {
    start() {
      const say = "퇴사했는데 마지막 월급을 안 줘요";
      const words = say.split(" ");
      const res = (t, fin) => {
        const alt = [{ transcript: t }];
        alt.isFinal = fin;
        return { results: [alt] };
      };
      words.forEach((_, i) => setTimeout(() => this.onresult?.(res(words.slice(0, i + 1).join(" "), false)), 350 + i * 380));
      setTimeout(() => {
        this.onresult?.(res(say, true));
        this.onend?.();
      }, 450 + words.length * 380);
    }
    stop() {
      this.onend?.();
    }
  }
  window.SpeechRecognition = DemoRecognition;
});
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
// 모드는 탭 안(sessionStorage)에만 저장, 글자 크기 등은 localStorage
const setMode = (mode, fontScale = 1) =>
  page.evaluate(([m, f]) => {
    localStorage.setItem("law-for-all:settings:v1", JSON.stringify({ fontScale: f }));
    sessionStorage.setItem("law-for-all:mode", m);
  }, [mode, fontScale]);

// 장면: 정해진 시간(내레이션이 있으면 그 길이)이 지나기 전에는 다음 장면으로 넘어가지 않는다.
// 자막은 장면 안에서 화면이 실제로 바뀌는 순간에 띄운다(cap 호출 위치).
const SEC = AUDIO ? DUR : PLAN;
const cues = [];
let sceneEnd = 0;
// 생성형 AI가 답을 쓰는 동안: 앞부분(1.2초)만 보여 주고 나머지 대기 구간은 영상에서 잘라 낸다(자막으로 알림).
// 잘라 낸 만큼 그 장면의 자막 시간은 늘려, 결과 화면을 읽을 시간이 줄지 않게 한다
const cuts = [];
// 화면은 가운뎃점 앞뒤에 보이지 않는 줄바꿈 문자(U+2060·U+200B)를 넣으므로(components/layout/korean-wrap.tsx) 글자로 찾을 때는 /가\u2060?·\u200B?나/ 처럼
// 걸린 시간 자막 — 1.5초 안이면 서버에 저장해 둔 검증 결과(같은 질문·규정)라 그대로 밝힘
const took = (sec) => (Number(sec) < 1.5 ? "같은 질문·규정은 저장해 둔 검증 결과로 바로(처음은 십수 초)" : `실제 약 ${sec}초`);
async function aiWait(waitFn, what = "답변") {
  const s = Date.now();
  await cap(`AI(국산 업스테이지 Solar Pro 4)가 근거 조문만 보고 ${what}을 쓰는 중…`, "기다리는 구간은 영상에서 줄였습니다");
  await waitFn();
  const e = Date.now();
  const k0 = s + 1200;
  const k1 = e - 300;
  if (k1 > k0) {
    cuts.push([(k0 - t0) / 1000, (k1 - t0) / 1000]);
    sceneEnd += k1 - k0;
  }
  return ((e - s) / 1000).toFixed(1);
}
async function scene(id, fn) {
  const now = Date.now();
  if (now < sceneEnd) await wait(sceneEnd - now);
  const start = Date.now();
  if (AUDIO && DUR[id]) cues.push({ id, at: (start - t0) / 1000 });
  sceneEnd = start + (SEC[id] ?? 4) * 1000 + (AUDIO ? 700 : 0);
  await fn();
}

await page.goto(BASE + "/");
await setMode("citizen");
await page.reload();
await page.waitForLoadState("networkidle").catch(() => {});

let introAt = 0; // 표지가 뜬 시각 — 그 앞(빈 화면·첫 로딩)은 잘라 낸다
if (SESSION === 1) {
await scene("s00", async () => {
  await card(`<span class="chip">2026 공공 AI 대전환 챌린지 · 세션 1</span><h1>법이음 (LAW:ON)</h1><p>말하듯 물으면 근거 조문과 지금 해야 할 일까지<br>근거 없는 답은 하지 않는 대국민 생활법률 AI · 국산 AI Solar Pro 4</p>`);
  await wait(150);
  introAt = (Date.now() - t0) / 1000;
});
await scene("s01", async () => {
  await card("");
  await cap("① 첫 화면은 국민 모드 — 궁금한 상황을 말로 물어봅니다", "마이크 버튼 → 말하기 (시연용 음성 입력 재현 · 녹화 환경에 마이크가 없어 인식 결과를 넣어 보여 줌)");
  await wait(1200);
  await click(page.locator("main [aria-label='음성으로 질문하기']").first());
  await page.getByText("곧 검색해요").first().waitFor({ timeout: 8000 }).catch(() => {});
  await cap("말이 끝나면 인식된 글을 보여 주고 1.5초 뒤 자동 검색", "잘못 알아들었으면 그 사이 취소하거나 고치면 됩니다 · 개인정보는 검색 전에 자동으로 가림");
});
await scene("s02", async () => {
  await page.waitForURL(/search/);
  const sec = await aiWait(() => page.locator("[aria-label^='근거 1:']").first().waitFor({ timeout: 60000 }).catch(() => {}));
  await cap("국산 AI Solar Pro 4가 쓴 쉬운 답 — 문장마다 근거 조문 번호", `${took(sec)} · 근거 목록 밖 인용은 자동 제거, 금액·기간은 원문과 대조(환각 방지)`);
  await wait(1200);
  await point(page.locator("[aria-label^='근거 1:']").first());
});
await scene("sAI", async () => {
  const badge = page.locator("button[aria-expanded]", { hasText: /근거 검증 통과|검수된 답변/ }).first();
  if (await has(badge)) await click(badge);
  await wait(300);
  await cap("AI 답변도 검증을 통과해야 화면에 나옵니다 — ‘근거 검증 통과’", "근거 밖 인용·원문과 다른 금액·기간이면 AI 답변을 쓰지 않고 사람이 검수한 답변으로 대체 · 실서비스 실측 93/94 통과");
  await wait(3500);
  if (await has(badge)) await badge.click();
});
await scene("s03", async () => {
  await page.locator("[aria-label^='근거 1:']").first().click();
  await page.locator("[role=dialog]").first().waitFor().catch(() => {});
  await wait(300);
  await cap("근거 번호를 누르면 AI 문장이 아닌 법령 원문 전문", "「근로기준법」 제36조(금품 청산) — 국가법령정보센터 원문");
});
await scene("s04", async () => {
  await page.keyboard.press("Escape");
  await wait(400);
  await page.evaluate(() => {
    const h = [...document.querySelectorAll("h2,h3")].find((x) => x.textContent.includes("쉬게 풀어") || x.textContent.includes("쉽게 풀어"));
    if (h) window.scrollTo({ top: h.getBoundingClientRect().top + window.scrollY - 150, behavior: "smooth" });
  });
  await wait(700);
  await cap("어려운 말 풀이 · 지금 해야 할 3단계 행동 안내", "단계마다 근거 조문 표시");
  await wait(1500);
  await scrollBy(320);
});
await scene("sF1", async () => {
  await scrollToEl("#followup-h", 140);
  await wait(700);
  await cap("이어서 묻기 — 같은 사안을 계속 물어보면", "답도 근거 번호가 붙고 같은 인용 검증을 거칩니다");
  await wait(900);
  await click(page.locator("section[aria-labelledby=followup-h] button.rounded-full", { hasText: "기한이 있나요?" }).first());
  await aiWait(() => page.waitForFunction(() => document.querySelectorAll("section[aria-labelledby=followup-h] li .rounded-2xl.border").length >= 1, null, { timeout: 60000 }).catch(() => {}));
  await wait(300);
  await cap("‘기한이 있나요?’ → 「근로기준법」 제36조: 퇴직 후 14일 이내 지급", "같은 사안을 이어서 — 답도 근거 번호와 인용·수치 검증을 거칩니다");
});
await scene("sF2", async () => {
  await scrollToEl("#form-draft-h", 160);
  await wait(600);
  await cap("필요한 서류는 초안까지 — 임금체불 진정서", "진정서·내용증명·구제신청서 등 7종");
  await click(page.locator("button:visible", { hasText: "초안 만들기" }).first());
  const dlg = page.locator("[role=dialog]");
  await dlg.locator("textarea[aria-label$='초안']").waitFor().catch(() => {});
  await dlg.locator("input").first().type("홍길동", { delay: 60 });
  await dlg.locator("label", { hasText: "못 받은 임금" }).locator("input").type("1800000", { delay: 50 });
  await dlg.locator("label", { hasText: "퇴직일" }).locator("input").type("2025. 8. 31.", { delay: 40 });
  await cap("빈칸을 채우면 초안이 바로 — 법적 근거는 원문이 확인된 조문만 인용", "입력 내용은 저장·전송하지 않음 · 복사 · Word 저장 · 인쇄");
});
await scene("s05", async () => {
  await page.keyboard.press("Escape").catch(() => {});
  await wait(300);
  await page.evaluate(() => {
    const h = [...document.querySelectorAll("h2,h3")].find((x) => x.textContent.includes("도움받을 수 있는 곳"));
    if (h) window.scrollTo({ top: h.getBoundingClientRect().top + window.scrollY - 220, behavior: "smooth" });
  });
  await wait(800);
  await cap("도움받을 수 있는 곳 — 관련 기관 전화번호·누리집 바로 연결", "고용노동부 고객상담센터 ☎1350 · 대한법률구조공단 ☎132");
  const box = page.locator("section, div.rounded-2xl", { has: page.locator("h2, h3", { hasText: "도움받을 수 있는 곳" }) }).last();
  for (const loc of [box.locator("a[href^='tel:']").first(), box.locator("a[href^='tel:']").nth(1), box.locator("a", { hasText: "바로가기" }).first()]) {
    if (!(await has(loc))) continue;
    const bx = await loc.boundingBox();
    if (bx) await page.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2, { steps: 16 });
    await wait(1800);
  }
});
if (casesLive) {
  await scene("s06", async () => {
    await page.evaluate(() => {
      const h = [...document.querySelectorAll("h2,h3")].find((x) => x.textContent.includes("법원은 어떻게"));
      if (h) window.scrollTo({ top: h.getBoundingClientRect().top + window.scrollY - 160, behavior: "smooth" });
    });
    const item = page.locator("button", { hasText: "판례 보기" }).first();
    await item.waitFor({ timeout: 30000 }).catch(() => {});
    await wait(500);
    await cap("비슷한 사건, 법원은 어떻게 판단했을까요? — 판례 실시간 조회", "국가법령정보센터 Open API · 확인되지 않은 사건번호는 만들지 않음");
    await wait(4500);
    if (await has(item)) {
      await click(item);
      await page.getByText("판시사항").first().waitFor({ timeout: 20000 }).catch(() => {});
      await wait(300);
      await cap("판례 뷰어 — 판시사항 · 판결요지 · 참조조문 · 전문, 국민 모드는 쉬운 설명", "인용 표기 복사 · 국가법령정보센터 원문 링크");
      await wait(3500);
      await page.mouse.move(980, 420, { steps: 10 });
      await scrollBy(500, 16);
    }
  });
}
await scene("s07", async () => {
  await page.keyboard.press("Escape").catch(() => {});
  await page.goto(BASE + "/analyze");
  await page.evaluate(() => {
    const t = document.querySelector("main textarea");
    if (t) window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 200 });
  });
  await cap("② 법률 상황 분석실 — 겪은 일을 이야기하듯 적으면", "예시: 전세 보증금·연락 두절 — 사연을 적다 보면 전화번호 같은 개인정보도 들어가곤 합니다");
  await wait(400);
  await click(page.locator("button", { hasText: "전세 보증금" }).first());
  await wait(400);
  const ta = page.locator("#situation");
  await ta.click();
  await page.keyboard.press("End");
  await ta.press("Control+End");
  await page.keyboard.type(" 집주인 번호 010-1234-5678로 전화해도 받지 않아요.", { delay: 45 });
  await wait(300);
  await click(page.locator("button", { hasText: /3관점 분석/ }).first());
  await aiWait(() => page.getByText("사실관계 정리").first().waitFor({ timeout: 80000 }).catch(() => {}), "세 관점 분석");
  await wait(900); // 결과로 자동 이동이 끝난 뒤 안내 문구가 화면 가운데 오도록
  await scrollToEl("#privacy-notice", 260);
  await wait(700);
  if (await has(page.locator("#privacy-notice"))) await point(page.locator("#privacy-notice"));
  await cap("적은 전화번호는 자동으로 ○○○ — 서버·AI로 보내기 전에 브라우저에서 가리고 화면에 알려 줍니다", "주민등록번호·전화·카드·계좌·이메일·여권번호 · 저장·전송하지 않음");
});
await scene("s07b", async () => {
  await page.evaluate(() => {
    const h = [...document.querySelectorAll("h2,h3")].find((x) => x.textContent.includes("사실관계 정리"));
    if (h) window.scrollTo({ top: h.getBoundingClientRect().top + window.scrollY - 170, behavior: "smooth" });
  });
  await wait(600);
  await cap("당사자·금액·시점 자동 정리 → 관련 법령을 관련도 순으로 추천", "추천마다 이유와 근거 조문 — 누르면 원문과 상·하위법령 연결");
});
await scene("s08", async () => {
  await page.evaluate(() => {
    const h = [...document.querySelectorAll("h2,h3")].find((x) => x.textContent.includes("모의 법정") || x.textContent.includes("3가지 시각"));
    if (h) window.scrollTo({ top: h.getBoundingClientRect().top + window.scrollY - 150, behavior: "smooth" });
  });
  await wait(700);
  await cap("AI 변호사·검사·판사 3관점 검토 — 판사 관점은 요건 충족표", "참고용 역할 시뮬레이션 — 맹신하지 말고 전문가 자문을 받도록 화면에 안내 · 모든 문장도 같은 인용 검증");
  await wait(2500);
  await scrollBy(450, 14);
});
await scene("s09", async () => {
  await page.goto(BASE + "/");
  await cap("어르신도 편하게 — 글자 크기 3단계, 말 묶음 단위 줄바꿈", "");
  await click(page.locator("[aria-label='아주 큰 글자']:visible").first());
  await wait(2300);
  await click(page.locator("[aria-label='기본 글자 크기']:visible").first());
});
if (mobShots.length) await scene("sMob", async () => {
  await cap("");
  const phones = mobShots
    .map((src, i) => `<div style="display:flex;flex-direction:column;align-items:center;gap:8px"><div style="width:236px;height:402px;border-radius:26px;border:7px solid #0b1431;background:#0b1431;overflow:hidden;box-shadow:0 18px 40px rgba(0,0,0,.35)"><img src="${src}" style="width:100%;display:block"></div><span style="font-size:17px;font-weight:700;opacity:.95">${["① 앱 설치 없이 주소만", "② 말하듯 묻고 근거 있는 답", "③ 지금 할 일 · 전화 바로 걸기"][i] ?? ""}</span></div>`)
    .join("");
  await card(`<span class="chip">대국민 서비스 향상</span><h1 style="font-size:40px">국민 모드는 휴대폰에서도 간편하게</h1><p style="font-size:20px">앱 설치·회원가입 없이 휴대폰 브라우저로 바로 · PC와 같은 기능 · 글자 크기 3단계·뜻 단위 줄바꿈</p><div style="display:flex;gap:34px;margin-top:6px">${phones}</div>`);
});
await scene("s10", async () => {
  await card("");
  await click(page.locator("[aria-label='공직자 모드 전환']:visible").first());
  await wait(300);
  await cap("③ 공직자 모드 — 같은 엔진, 실무용 화면", "자주 찾는 법령 12개(계약·재정·청렴·정보공개·안전·노무) · 규정 바로 만들기 15종");
  await wait(2500);
  await point(page.locator("button", { hasText: "부정청탁금지법" }).first());
});
await scene("s11", async () => {
  await page.locator("button", { hasText: "부정청탁금지법" }).first().click();
  await page.waitForURL(/search/);
  await aiWait(() => page.getByText("검토 결론").first().waitFor({ timeout: 60000 }).catch(() => {}), "검토 보고서");
  await cap("검토 결론 → 법적 근거 체계 → 주요 쟁점 → 업무 유의사항 → 체크리스트", "보고서체로 정리 · 인용문 복사로 공문서에 바로 활용");
  await wait(3500);
  await scrollBy(480, 14);
});
await scene("sM", async () => {
  await page.goto(BASE + "/search?q=" + encodeURIComponent("공무원 외부강의 사례금 상한은?"));
  await aiWait(() => page.getByText("검토 결론").first().waitFor({ timeout: 60000 }).catch(() => {}), "검토 보고서");
  await wait(300);
  await cap("금액 기준은 시행령 별표 원문으로 — 공무원 외부강의 1시간당 40만원(총액 60만원)", "청탁금지법 시행령 제25조·별표 2 · 음식물·선물 가액(별표 1)도 원문 그대로");
  await wait(3800);
  const badge = page.getByText(/최근 개정 \d{4}\./).first();
  if (await has(badge)) {
    await point(badge);
    await cap("최근 1년 안에 바뀐 근거 조문은 ‘최근 개정’ 표시 — 예전 기준으로 판단하지 않게", "검증 영수증에도 조문별 최종 개정일 기록");
  }
});
await scene("sR", async () => {
  await click(page.locator("button:visible", { hasText: "검증 영수증" }).first());
  await page.locator("[role=dialog] >> text=No.").first().waitFor().catch(() => {});
  await wait(300);
  await cap("검증 영수증 — 근거 원문의 출처·시각·SHA-256 지문과 인용 검증 결과", "AI를 활용한 행정의 근거를 보고서·기안문에 남깁니다");
});
await scene("s12", async () => {
  await page.keyboard.press("Escape").catch(() => {});
  await wait(300);
  const pack = page.locator("button", { hasText: "보고서 한 번에 작성" }).first();
  if (await has(pack)) {
    await click(pack);
    await page.locator("[role=dialog]").first().waitFor().catch(() => {});
    await wait(300);
  }
  await cap("보고서 한 번에 작성 — 검토 보고서 · 기안문 · 민원 회신문 · 붙임 4종", "검증된 답변·근거 원문만 공문서 서식에 배치 · Word 저장");
});
if (casesLive && process.env.WITH_OFFICER_EXTRA) {
  // 공직자 모드의 판례 보기 — 업무 분야별 쟁점, 법제처 법령해석례(유권해석) 먼저, 검토보고서용 요지 복사
  await scene("sC", async () => {
    await page.keyboard.press("Escape").catch(() => {});
    await page.goto(BASE + "/cases");
    await page.getByText(/판례\u2060?·\u200B?법령해석례 검토/).first().waitFor().catch(() => {});
    await cap("공직자 판례 보기 — 판례·법령해석례 검토, 업무 분야별 쟁점으로 바로 찾기", "인사·복무 · 청렴·선거 · 재산·계약 · 행정·민원");
    await wait(1800);
    await click(page.locator("main button", { hasText: /^\s*#\s*부정청탁\s*$/ }).first());
    const item = page.locator("button", { hasText: "해석례 보기" }).first();
    await item.waitFor({ timeout: 30000 }).catch(() => {});
    // 결과 목록 머리(해석례 묶음 제목)가 화면 위쪽에 오도록
    await item.evaluate((el) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 300, behavior: "smooth" })).catch(() => {});
    await wait(1000);
    await cap("법제처 법령해석례(유권해석)를 먼저, 이어서 판례 — 제목이 쟁점과 맞는 것만", "본문에 낱말만 스친 엉뚱한 사건은 걸러 냄");
    await wait(2600);
    if (await has(item)) {
      const brief = page.locator("[role=dialog]").getByText("검토보고서용 요지 복사").first();
      // 부드러운 스크롤이 끝난 뒤 누르고, 보기 창이 안 열렸으면 한 번 더
      for (let i = 0; i < 2 && !(await has(brief)); i++) {
        await click(item);
        await brief.waitFor({ timeout: 8000 }).catch(() => {});
      }
      await wait(300);
      if (await has(brief)) await point(brief);
      await cap("업무 처리 기준인 회답·이유를 강조 · 검토보고서용 요지 복사", "질의 당시와 현행 법령이 같은지 확인 안내 · 인용 표기 복사 · 원문 링크");
      await wait(2500);
    }
  });
}
await scene("s13", async () => {
  await cap("");
  await page.keyboard.press("Escape");
  await page.goto(BASE + "/compliance");
  await cap("④ 자체규정 점검 — 우리 기관 규정 파일(한글·PDF·Word)을 넣으면", "파일 원본은 브라우저에서만 읽음 · AI 검토에는 조문 글만(개인정보 가림) · 끌어다 놓기 또는 모의데이터 버튼");
  await point(page.locator("[aria-label^='규정 파일 올리기']").first());
  await wait(1200);
  const mock = page.locator("main button:visible", { hasText: "HWPX" }).first();
  await point(mock);
  await cap("모의데이터로 바로 체험 — 버튼 한 번에 한글(HWPX) 규정 파일 읽기부터 검증까지", "가상시설관리공단 복무 및 보수 규정 · 조문 11개 인식");
  await wait(1500);
  await mock.click();
  await page.mouse.move(W - 260, 300, { steps: 14 }); // 결과로 화면이 옮겨 가므로 커서도 결과 쪽으로
  await page.waitForFunction(() => document.querySelector("#compliance-result")?.innerText.includes("교차 검증 결과"), null, { timeout: 30000 }).catch(() => {});
});
await scene("s14", async () => {
  await wait(300);
  await scrollToEl("#compliance-result");
  await wait(700);
  await cap("법정 기준 규칙 점검이 먼저 — 이어서 AI가 조문마다 상위법을 찾아 대조", "국가법령정보(법제처 Open API)에서 전체 현행 법령 검색 → 국산 AI Solar Pro 4가 원문과 대조");
  const sec = await aiWait(() => page.getByText(/AI 검토 완료|AI 검토를 하지 못했어요/).first().waitFor({ timeout: 150000 }).catch(() => {}), "조문별 대조 의견");
  await page.evaluate(() => {
    const h = [...document.querySelectorAll("#compliance-result h3")].find((x) => x.textContent.includes("제8조"));
    if (h) window.scrollTo({ top: h.getBoundingClientRect().top + window.scrollY - 140, behavior: "smooth" });
  });
  await wait(600);
  await cap("AI 검토 — 조문마다 상위 조문 원문과 대조해 판정 · 이유 · 고칠 방향", `${took(sec)} · 근거 조문·수치는 가드가 검증 · 참고 의견, 최종 판단은 담당자`);
});
if (process.env.WITH_OFFICER_EXTRA) {
await scene("s15", async () => {
  await page.evaluate(() => {
    const h = [...document.querySelectorAll("#compliance-result h3")].find((x) => x.textContent.includes("제8조"));
    if (h) window.scrollTo({ top: h.getBoundingClientRect().top + window.scrollY - 150, behavior: "smooth" });
  });
  await wait(700);
  await cap("1주 45시간 → 법정 40시간 초과 · 근거 조문 버튼으로 원문 확인", "근로시간·연차·가산수당·출산휴가·퇴직금품·해고예고까지 점검");
  await wait(3500);
  await page.evaluate(() => {
    const h = [...document.querySelectorAll("#compliance-result p")].find((x) => x.textContent.includes("개정안(상위법 기준 반영)"));
    if (h) window.scrollTo({ top: h.getBoundingClientRect().top + window.scrollY - 220, behavior: "smooth" });
  });
  await wait(600);
  await cap("수치 위반은 개정안 자동 제안 — 현행 ↔ 개정안 대비", "보고서 복사 · 제·개정 지원으로 이어서 작성");
});
await scene("s16", async () => {
  await page.goto(BASE + "/drafting");
  await cap("⑤ 규정 제·개정 지원 — 바꾸고 싶은 내용을 말하듯 적으면", "예: 처리기간을 7일에서 5일로 단축 · ‘민원인’을 ‘신청인’으로 변경");
  await click(page.locator("button", { hasText: "직접 입력" }).first());
  await page.locator("input[placeholder^='규정명']").first().fill("가상시 민원 처리 규정");
  await page.locator("input[placeholder='제5조(처리기간)']").first().fill("제5조(처리기간)");
  await page.locator("textarea[placeholder^='현행 조문']").first().fill("① 민원인이 신청한 민원은 접수한 날부터 7일 이내에 처리하여야 한다.\n② 처리기간을 연장하는 경우에는 민원인에게 알려야 한다.");
  const ins = page.locator("textarea[placeholder^='예) 처리기간']").first();
  await click(ins);
  await ins.type("처리기간을 7일에서 5일로 단축\n‘민원인’을 ‘신청인’으로 변경", { delay: 18 });
  await click(page.locator("button", { hasText: "개정안 작성" }).first());
  await wait(500);
  await scrollToEl("section[aria-label='개정안과 검토 결과']");
  await wait(700);
  await cap("신·구조문 대비표 · 정합성 점검이 자동으로", "개정이유·주요내용 · 부칙 · 입법예고문 · 절차 체크리스트 초안 · Word 저장");
});
}
await scene("s17", async () => {
  await page.goto(BASE + "/laws/labor-standards");
  await page.waitForLoadState("networkidle").catch(() => {});
  await cap("법제처 형식 조문 뷰어 · 상위법–시행령–시행규칙 3단 대조", "법령·행정규칙·자치법규·판례 실시간 조회 — 실행판·공유판도 클라우드 중계로 키 입력 없이");
  await wait(5000);
  await page.goto(BASE + "/about");
  await page.waitForLoadState("networkidle").catch(() => {});
  await cap("시연 주소는 국산 AI 업스테이지 Solar Pro 4 — 설정만 바꿔 EXAONE·Gemma 등 공통기반 모델로 교체", "어떤 모델이든 같은 인용·수치 검증 가드 · AI가 끊기거나 검증에 걸리면 검수된 답변으로 자동 대체");
  await wait(1500);
  await scrollBy(420, 14);
});
await scene("sE", async () => {
  await scrollToEl("#eval", 90);
  await wait(700);
  await cap("정확도 성적표 공개 — 실서비스 Solar 답변 93/94 검증 통과 · 근거 밖 인용 0건", "가짜 인용 1516/1516 차단 · 독립 작성자(EXAONE) 블라인드 이력·틀린 문항 모두 공개 · npm run eval 로 누구나 재현");
});
await scene("s18", async () => {
  await cap("");
  await card(`<h1>법이음 (LAW:ON)</h1><ul><li>✔ 근거 조문을 먼저 찾고 인용 — 가짜 조문·판례 차단</li><li>✔ 국민 모드 · 공직자 모드 한 엔진 두 화면 · 이어서 묻기</li><li>✔ 서류 초안 7종 · 답변 검증 영수증(원문 지문·개정일)</li><li>✔ 휴대폰에서도 앱 설치 없이 간편하게 — 대국민 서비스 향상</li><li>✔ 개인정보 자동 가림 · 음성 질문 · 정확도 성적표 공개</li><li>✔ 판례·법령해석례 실시간 — 국민은 쉬운 설명, 공직자는 유권해석 우선 검토</li><li>✔ 국산 AI Solar가 답하고 가드가 검증 — 실서비스 93/94 통과</li><li>✔ 자체규정 점검 → 제·개정 문서까지(세션 2 출품) · LLM 비종속 · 실행판</li></ul><p style="font-size:20px;margin-top:10px">다른 기관 규정·법령은 데이터 추가만으로 확산</p>`);
});
} else {
  // ───────────── 세션 2 — 지정과제 ③ 규정 제·개정 에이전트
  await page.evaluate(() => sessionStorage.setItem("law-for-all:mode", "officer"));
  await scene("t00", async () => {
    await card(`<span class="chip">2026 공공 AI 대전환 챌린지 · 세션 2 · 지정과제 ③</span><h1>법이음 규정 제·개정 지원</h1><p>제정·개정 문서 세트부터 유사 규정 비교, 인용 정정, 상위법 대조까지<br>틀리면 안 되는 부분은 결정적으로 · 기관마다 다른 빈칸은 국산 AI가 채우고 가드가 검증</p>`);
    await wait(150);
    introAt = (Date.now() - t0) / 1000;
  });
  await scene("t01", async () => {
    await page.goto(BASE + "/drafting?mode=enact");
    await page.waitForLoadState("networkidle").catch(() => {});
    await card("");
    await cap("① 제정 — 새 지침을 만들 때 ‘무엇부터?’", "규정명·종류·기관·제정 목적·상위법 근거 조문·담을 내용을 넣으면");
    await wait(1500);
    await click(page.getByRole("button", { name: "예시 채우기" }));
    await page.getByRole("heading", { name: "조문 체계 · 제정안 초안", exact: true }).waitFor({ timeout: 20000 }).catch(() => {});
    await wait(500);
    await cap("조문 체계와 표준 조문 초안이 바로 — 목적·정의·적용 범위·실체 조문·세부 사항·부칙", "근거: 「청탁금지법」 제10조 원문(국가법령정보) · 법제 표준 문형으로 조립해 형식 오류·지어낸 조문 없음");
  });
  await scene("t02", async () => {
    await page.getByRole("heading", { name: "정합성 점검", exact: true }).scrollIntoViewIfNeeded().catch(() => {});
    await scrollToEl("section[aria-label='제정안과 검토 결과'] h2:nth-of-type(1)", 120);
    await page.evaluate(() => {
      const h = [...document.querySelectorAll("h2")].find((x) => x.textContent.includes("상위법 대조"));
      if (h) window.scrollTo({ top: h.getBoundingClientRect().top + window.scrollY - 160, behavior: "smooth" });
    });
    await wait(700);
    await cap("상위 조문 기준(‘10일 이내’)과 정합성 점검", "위임 사항 누락 · 위임 없는 의무·벌칙(「지방자치법」 제28조) · 재검토기한 · 채울 자리 안내");
  });
  await scene("t03", async () => {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await wait(500);
    const btn = page.getByRole("button", { name: /빈칸만 채우기/ });
    await btn.scrollIntoViewIfNeeded();
    await point(btn);
    await cap("기관마다 다른 빈칸(○○)은 AI로 채우기", "국산 AI Solar Pro 4가 근거 조문에 맞춰 ○○ 자리만 채웁니다");
    await wait(1200);
    await btn.click();
    const sec = await aiWait(() => page.getByText(/가 빈칸 .*곳을 채웠어요|연결하지 못했어요|형식이 올바르지/).first().waitFor({ timeout: 95000 }).catch(() => {}), "빈칸");
    await page.getByRole("heading", { name: "조문 체계 · 제정안 초안", exact: true }).scrollIntoViewIfNeeded().catch(() => {});
    await wait(300);
    await cap("노란 표시가 AI가 채운 자리 — 빈칸 밖 문구를 바꾼 조문은 가드가 버리고 표준 초안 유지", `${took(sec)} · 근거 목록 밖 법령 인용·새 벌칙도 차단, 상위 기준 초과는 경고`);
  });
  await scene("t04", async () => {
    await scrollBy(380, 14);
    await cap("채운 값이 기관 실정에 맞는지는 담당자가 확인 — ‘표준 초안’과 바로 비교", "AI 채운 안 ↔ 표준 초안 전환 · 복사·Word 저장은 보고 있는 쪽으로");
  });
  await scene("tL", async () => {
    // 공직자 첫 화면의 '규정 바로 만들기' 15종 → 누르면 제정 화면에서 한 줄 제정이 바로 시작
    await page.goto(BASE + "/");
    await page.waitForLoadState("networkidle").catch(() => {});
    const tiles = page.locator("section[aria-label='규정 바로 만들기']");
    await tiles.scrollIntoViewIfNeeded().catch(() => {});
    await page.evaluate(() => window.scrollBy({ top: 120 }));
    await cap("한 줄로 만들기 — 공직자 첫 화면 ‘규정 바로 만들기’ 15종, 누르면 바로 시작", "국가법령정보에서 상위법령을 찾아 AI가 조문 구성을 설계하고, 상위 조문 원문에 맞춰 조문까지 작성");
    await wait(1600);
    await click(tiles.getByRole("link", { name: /산업안전보건 관리 규정/ }));
    await page.waitForURL(/drafting/).catch(() => {});
    const sec = await aiWait(() => page.getByText(/조문 [0-9]+개를 썼어요|AI 작성에 실패|연결하지 못했어요/).first().waitFor({ timeout: 220000 }).catch(() => {}), "제정안");
    // AI가 쓴 조문 본문이 보이게(작성안 상자를 화면 위쪽으로)
    await page.evaluate(() => {
      const p = [...document.querySelectorAll("pre")].find((x) => x.textContent.includes("안전보건"));
      if (p) window.scrollTo({ top: p.getBoundingClientRect().top + window.scrollY - 150, behavior: "smooth" });
    });
    await wait(500);
    await cap("「산업안전보건법」 목차에서 근거를 골라 조문 작성 — 안전보건관리책임자·위원회·안전보건교육", `${took(sec)} · 근거 밖 법령·새 벌칙·항 번호 오류는 가드가 차단 · AI 작성안 ↔ 표준 초안 전환 · 담당자 확인`);
    await wait(3500);
    await page.evaluate(() => { const p = [...document.querySelectorAll("pre")].find((x) => x.textContent.includes("안전보건")); if (p) p.scrollTo({ top: p.scrollHeight * 0.4, behavior: "smooth" }); });
  });
  await scene("t05", async () => {
    await page.getByLabel("규정명").fill("○○공단 재택근무 운영 지침");
    await page.getByLabel("제정 목적").fill("직원의 재택근무 신청·승인과 복무 관리 기준을 정하기 위함");
    await page.getByLabel("담을 내용").fill("신청 절차\n정보 보안");
    const sim = page.getByRole("heading", { name: /유사 규정 찾기\u2060?·\u200B?조문 구성 비교/ });
    await sim.scrollIntoViewIfNeeded().catch(() => {});
    await cap("② 유사 규정 찾기 — 다른 기관이 이미 만든 규정과 비교", "규정명에서 검색어를 뽑아 국가법령정보 행정규칙·자치법규를 실시간 검색");
    await wait(1000);
    await click(page.getByRole("button", { name: /찾기/ }).first());
    const cmp = page.getByRole("button", { name: /비교/ }).first();
    await cmp.waitFor({ timeout: 40000 }).catch(() => {});
    await wait(800);
    await click(cmp);
    await page.getByText(/우리 초안에 없는 조문/).waitFor({ timeout: 40000 }).catch(() => {});
    await wait(300);
    await sim.scrollIntoViewIfNeeded().catch(() => {});
    await cap("부처 재택근무 규정과 조문 구성 비교 — 우리 초안에 없는 조문 표시", "대상자 선정 · 일수·요일 · 승인·취소 · 근무시간 · 복무관리 · 근무지 · 휴가 …");
    await wait(2200);
    await click(page.getByRole("button", { name: /없는 조문 모두 담기/ }));
  });
  await scene("t06", async () => {
    await page.getByRole("heading", { name: "조문 체계 · 제정안 초안", exact: true }).scrollIntoViewIfNeeded().catch(() => {});
    await wait(500);
    await cap("빠진 조문을 한 번에 담으면 조문 체계와 초안이 바로 다시 만들어짐", "목차 배지 · 표준 조문 · 제정이유도 함께 갱신");
  });
  await scene("t07", async () => {
    await page.getByRole("heading", { name: "제정 문서 초안", exact: true }).scrollIntoViewIfNeeded().catch(() => {});
    await wait(500);
    await cap("제정이유·주요내용 · 입법예고문 · 절차 체크리스트", "규범 종류(훈령·예규 / 조례·규칙 / 법령)에 맞춘 절차 · 제정안 포함 전체 Word 저장");
    await wait(1600);
    await click(page.getByRole("tab", { name: "입법예고문" }));
    await wait(1300);
    await click(page.getByRole("button", { name: "제정 보고서 바로 만들기" }));
    await wait(600);
    await cap("보고서 바로 만들기 — 결재용 제정(안) 보고 · 기안문 · 붙임(제정안 전문)", "화면 결과만 공문서 서식에 옮김 · 부서·담당자 입력 · Word(한글 호환)·복사·인쇄");
    await wait(2600);
    await page.keyboard.press("Escape");
  });
  await scene("t08", async () => {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await wait(400);
    await click(page.getByRole("tab", { name: /개정\(조문/ }));
    await cap("③ 개정 — 규정 파일(한글·PDF·Word)을 끌어다 놓으면 조문을 읽어", "파일은 서버로 보내지 않고 브라우저에서만 읽음 · 붙여 넣기·법령에서 고르기도 가능");
    // 모의데이터 한글 규정 파일을 끌어다 놓기(녹화에서는 파일 선택으로 같은 동작)
    // (한글 파일 이름은 Playwright 파일 선택에서 깨지므로, 브라우저에서 고른 것과 같은 File 을 만들어 넣음)
    await point(page.locator("section[aria-label='개정 대상과 방향'] [aria-label^='규정 파일 올리기']").first());
    await page.evaluate(([b64, name]) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bin], name));
      const inp = document.querySelector("section[aria-label='개정 대상과 방향'] input[type=file]");
      inp.files = dt.files;
      inp.dispatchEvent(new Event("change", { bubbles: true }));
    }, [fs.readFileSync(path.resolve("public/mock/mock-1.hwpx")).toString("base64"), "가상시설관리공단_복무및보수규정(모의).hwpx"]);
    const pick = page.getByRole("combobox", { name: "고칠 조문 선택" });
    await pick.waitFor({ timeout: 20000 });
    await wait(900);
    await cap("고칠 조문 고르기 — 조 단위로 나눠 보여 줌 · 규정명도 문서 제목에서 자동", "가상시설관리공단 복무 및 보수 규정(모의) · 11개 조문");
    await point(pick);
    const idx = await pick.locator("option").evaluateAll((os) => os.findIndex((o) => /제8조/.test(o.textContent)));
    await pick.selectOption({ index: Math.max(1, idx) });
    await wait(900);
    const ins = page.getByRole("textbox", { name: "개정 방향" });
    await point(page.getByRole("button", { name: "단어·기한 변경" }));
    await wait(400);
    await click(ins);
    await ins.type("9시간에서 8시간으로 변경\n45시간에서 40시간으로 변경\n연장근무는 직원과 합의한 경우에만 하도록", { delay: 14 });
    await cap("정해진 문형(‘A에서 B로’)은 규칙으로 정확히 · 말하듯 쓴 의도는 AI가 조문으로", "입력 틀 4종(단어·기한 변경 · 단서 신설 · 조항 삭제 · 용어 정비) · 국산 AI Solar Pro 4가 쓰고 가드가 검증");
    await wait(1300);
    await click(page.getByRole("button", { name: /개정안 및 신·구조문대비표 생성/ }));
    const sec = await aiWait(() => page.getByText(/담당자 확인 필요|검증을 통과하지 못해|바꿀 내용을 정하지|연결하지 못했어요/).first().waitFor({ timeout: 80000 }).catch(() => {}), "개정 조문");
    await scrollToEl("section[aria-label='개정안과 검토 결과']", 110);
    await wait(500);
    await cap("AI 작성 개정안 — 검증 통과분만 신·구조문 대비표로(삭제 취소선·개정 밑줄)", `${took(sec)} · 지시에 없는 항 삭제·근거 밖 수치·법령·새 벌칙·의무↔재량 표현 변경은 가드가 차단 · 표 복사 → 한글·Word에 표로`);
  });
  await scene("t08b", async () => {
    await click(page.getByRole("tab", { name: "개정이유" }));
    await wait(1200);
    await click(page.getByRole("button", { name: "개정 보고서 바로 만들기" }));
    await wait(600);
    await cap("개정 보고서 바로 만들기 — 일부개정(안) 보고 · 기안문 · 붙임(신·구조문대비표·개정문·부칙)", "개정 사유·주요 내용·정합성 점검·시행·추진 절차를 결재 서식으로 · Word 한 번에");
    await wait(2800);
    await click(page.getByRole("tab", { name: /붙임/ }));
    await wait(2200);
    await page.keyboard.press("Escape");
  });
  await scene("t09", async () => {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await wait(400);
    await click(page.getByRole("tab", { name: /조 번호/ }));
    await cap("④ 조 번호 정리 — 조문을 넣거나 빼서 번호가 바뀔 때", "같은 규정 안에서 고칠 인용을 눈으로 찾지 않아도 됩니다");
    await wait(900);
    await click(page.getByRole("button", { name: "예시 채우기" }));
    await wait(500);
    await page.getByRole("heading", { name: "고칠 곳", exact: true }).scrollIntoViewIfNeeded().catch(() => {});
    await cap("제4조 신설 → 고칠 인용 3건 · 지금도 없는 조문 인용(제9조) 1건 · 정정한 전문", "다른 법령 인용(「…」 제N조, 법 제N조)은 그대로 · 삭제하면 삭제 조문 인용은 ‘정비 필요’ 표시");
  });
  await scene("tU1", async () => {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await wait(400);
    await click(page.getByRole("tab", { name: /상위법 개정 반영/ }));
    await cap("⑤ 상위법 개정 반영 — 상위법이 바뀌면 우리 규정 어디를 고쳐야 할까?", "국가법령정보 ‘신구법 비교’에서 최근 개정 전·후 조문을 실시간으로");
    await wait(700);
    const lawBox = page.getByRole("combobox", { name: "개정된 상위법 검색" });
    await click(lawBox);
    await wait(900);
    await lawBox.type("근로기준", { delay: 60 });
    await cap("모든 현행 법령을 검색해 고르기 — 국가법령정보 ‘법령 목록’ → 고른 법령의 신구법 비교", "자주 쓰는 법령 추천 · 약칭(청탁금지법)도 검색 · 최근 개정 내역이 없으면 안내");
    const opt = page.getByRole("option", { name: /^근로기준법/ }).first();
    await opt.waitFor({ timeout: 20000 }).catch(() => {});
    await wait(900);
    await click(opt);
    await page.getByText(/신\u2060?·\u200B?구조문 대비 \(/).waitFor({ timeout: 40000 }).catch(() => {});
    await page.getByRole("heading", { name: /일부개정|타법개정/ }).first().scrollIntoViewIfNeeded().catch(() => {});
    await page.evaluate(() => window.scrollBy({ top: -120 }));
    await wait(300);
    await cap("「근로기준법」 일부개정(2026. 4. 7.) — 신·구조문 19곳 · 용어 ‘근로감독관’→‘노동감독관’ 18곳 · 4개 조 삭제", "개정 표시는 원문 그대로 · 바뀐 용어·수치·신설·삭제는 규칙으로 추출(AI 미사용)");
  });
  await scene("tU2", async () => {
    await click(page.getByRole("button", { name: "예시 채우기" }));
    await wait(400);
    await click(page.getByRole("button", { name: /개정 영향 점검/ }));
    await wait(400);
    await page.getByRole("heading", { name: /우리 규정 정비 대상/ }).scrollIntoViewIfNeeded().catch(() => {});
    await page.evaluate(() => window.scrollBy({ top: -100 }));
    await cap("우리 규정 정비 대상 2개 조문 — 옛 용어 사용 · 삭제된 「근로기준법」 제102조 인용", "가상 취업규칙(모의데이터) · 규정은 서버로 보내지 않고 화면에서만 대조");
    await wait(4200);
    await click(page.getByRole("button", { name: /개정안 만들기/ }).first());
    await wait(900);
    await click(page.getByRole("button", { name: /개정안 및 신·구조문대비표 생성/ }));
    await page.getByText(/담당자 확인 필요|개정안이 만들어졌어요|검증을 통과하지 못해/).first().waitFor({ timeout: 80000 }).catch(() => {});
    await wait(400);
    await scrollToEl("section[aria-label='개정안과 검토 결과']", 110);
    await cap("개정 방향이 채워진 개정 화면 → 신구조문대비표 · 삭제 조문 인용 경고", "개정이유: “「근로기준법」 일부개정(2026. 4. 7. 공포, 2026. 10. 8. 시행)에 맞추어 …” · 부칙·입법예고문까지");
  });
  await scene("t10", async () => {
    await page.goto(BASE + "/compliance");
    await cap("⑥ 자체규정 점검 — 우리 기관 규정 파일 ↔ 상위법 조문 단위 대조", "원본은 브라우저에서만 읽음 · AI가 조문마다 국가법령정보 상위 조문과 대조 · 모의데이터 버튼 한 번");
    const mock = page.locator("main button:visible", { hasText: "HWPX" }).first();
    await point(mock);
    await wait(1000);
    await mock.click();
    await page.waitForFunction(() => document.querySelector("#compliance-result")?.innerText.includes("교차 검증 결과"), null, { timeout: 30000 }).catch(() => {});
    await wait(400);
    await scrollToEl("#compliance-result");
    await wait(600);
    await cap("법정 기준 규칙 점검 약 2초 → 이어서 AI가 조문마다 상위법을 찾아 대조", "국가법령정보(법제처 Open API) 전체 현행 법령 검색 → 국산 AI Solar Pro 4");
    await aiWait(() => page.getByText(/AI 검토 완료|AI 검토를 하지 못했어요/).first().waitFor({ timeout: 150000 }).catch(() => {}), "조문별 대조 의견");
    await scrollToEl("#compliance-result");
    await wait(500);
    await cap("AI 검토 완료 — 판정은 AI 의견과 법정 기준 규칙 중 더 엄격한 쪽", "조문을 동시에 검토(규정당 평균 14초 · 모의데이터는 미리 검토해 바로) · 근거 미확인 지적은 가드가 버림 · 규칙 지적 20개 중 20개 AI 동일 판단");
  });
  await scene("t11", async () => {
    await page.evaluate(() => {
      const h = [...document.querySelectorAll("#compliance-result h3")].find((x) => x.textContent.includes("제8조"));
      if (h) window.scrollTo({ top: h.getBoundingClientRect().top + window.scrollY - 150, behavior: "smooth" });
    });
    await wait(700);
    await cap("AI 검토 · 상충 — 1주 45시간은 법정 40시간 초과(「근로기준법」 제50조) · 고칠 방향", "근거 조문 버튼으로 원문 확인 · 수치 위반은 개정안 자동 제안");
  });
  await scene("t11c", async () => {
    // 점검 → 상충·검토 필요 조문 한 번에 개정 → 일부개정(안) 보고
    const panel = page.locator("#batch-amend");
    await scrollToEl("#batch-amend", 120);
    await wait(400);
    const btn = panel.getByRole("button", { name: /개정안 쓰기/ });
    await point(btn);
    await cap("상충·검토 필요 조문 한 번에 개정 — 근거 상위 조문 기준으로", "수치 위반은 법정 기준 규칙, 절차 누락 등은 국산 AI가 조문마다 동시에 쓰고 가드가 검증(개정 화면과 같은 AI·가드)");
    await wait(1400);
    await btn.click();
    const report = panel.getByRole("button", { name: /일부개정\(안\) 보고서 바로 만들기/ });
    const sec = await aiWait(() => report.waitFor({ timeout: 200000 }).catch(() => {}), "개정 조문");
    await scrollToEl("#batch-amend", 110);
    await wait(300);
    await cap("조문마다 현행 ↔ 개정안 — 반영할 조문을 고르고 직접 고칠 수 있음", `${took(sec)} · 근거 밖 수치·법령, 새 벌칙, 의무↔재량 변경은 가드가 막고 그 조문은 현행 유지(이유 표시)`);
    await wait(2600);
    await report.scrollIntoViewIfNeeded().catch(() => {});
    await wait(400);
    await click(report);
    await wait(600);
    await cap("일부개정(안) 보고 — 개정 사유 · 조문별 바뀐 수치 · 근거 상위법령 · 시행 · 추진 절차 + 기안문", "붙임: 신·구조문대비표 · 개정문 · 부칙 — 한글(HWPX)·Word로 저장");
    await wait(2800);
    await click(page.getByRole("tab", { name: /붙임/ }));
    await wait(2200);
    await page.keyboard.press("Escape");
  });
  await scene("tW", async () => {
    // 상위법 개정 알림: 점검한 규정의 상위법을 등록(기준일 = 우리 규정 최종 정비일) → 공직자 첫 화면에서 알림
    await scrollToEl("#compliance-result");
    await wait(300);
    await click(page.getByRole("button", { name: /개정 알림 받기/ }));
    const dlg = page.getByRole("dialog", { name: "개정 알림 등록" });
    await dlg.getByLabel("기준일").fill("2025-12-31");
    await cap("🔔 상위법 개정 알림 받기 — 이 규정이 따르는 법령을 ‘지켜볼 법령’으로", "기준일 = 우리 규정 최종 정비일 · 목록은 이 브라우저에만(서버로는 법령 이름만)");
    await wait(2200);
    await click(dlg.getByRole("button", { name: "등록" }));
    await wait(700);
    await page.goto(BASE + "/");
    await page.waitForLoadState("networkidle").catch(() => {});
    const panel = page.locator("section[aria-label='상위법 개정 알림']");
    await page.waitForFunction(() => /새 개정|확인하지 못했/.test(document.querySelector("section[aria-label='상위법 개정 알림']")?.innerText ?? ""), null, { timeout: 40000 }).catch(() => {});
    await scrollToEl("section[aria-label='상위법 개정 알림']", 170);
    await wait(700);
    await cap("공직자 첫 화면을 열면 — 기준일 이후 개정된 상위법을 바로 알림", "국가법령정보 법령 목록에서 최근 공포일 확인 · ‘개정 전후 보기·영향 점검’ → 신구법 비교 → 우리 규정 정비 · ‘확인함’이면 다음 개정부터");
    await wait(2500);
    await point(panel.getByRole("link", { name: /개정 전후 보기/ }).first());
  });
  await scene("t12", async () => {
    await cap("");
    await card(`<h1>전 기관 공통 · 바로 이관</h1><ul><li>✔ 규범 종류·기관명·소관 부서만 바꾸면 문형·절차·입법예고가 맞춰짐</li><li>✔ 점검 기준·법령은 코드와 분리된 데이터 — 기관 규정 추가로 확장</li><li>✔ 모델 비종속: 뼈대는 AI 없이 동작, 빈칸·상담만 Solar·EXAONE 등으로 교체</li><li>✔ 추가 설치 없는 Python 실행판(폐쇄망) · Next.js판 · 자동 시험 319건</li></ul>`);
  });
  await scene("t13", async () => {
    await card(`<h1>법이음 규정 제·개정 지원</h1><ul><li>✔ (제정) 한 줄 요청 → 상위법령 검색 → AI 설계·조문 작성(가드 검증) · 표준 조문·빈칸 채우기</li><li>✔ (개정) 규정 파일 끌어다 놓기 → 고칠 조문 → 규칙+AI(가드 검증) 수정안·신구조문대비표</li><li>✔ 유사 규정 찾기·조문 구성 비교 · 조 번호 정리(인용 정정)</li><li>✔ 제정·개정이유 · 부칙 · 입법예고문 · 절차 · 한글·Word 한 번에</li><li>✔ 상위법 개정 알림 · 모든 현행 법령 신구법 비교 → 우리 규정 영향 조문 → 개정안</li><li>✔ 자체규정 점검 → 상충 조문 한 번에 개정 → 일부개정(안) 보고·기안문(한글·Word)</li></ul>`);
  });
}
// 마지막 장면은 목표 길이(TARGET)까지 채우되 최소 6초는 보여 주고, 내레이션이 있으면 그 끝까지
const endAt = AUDIO ? sceneEnd + 800 : t0 + (introAt + TARGET + 0.3) * 1000;
await wait(Math.max(6000, endAt - Date.now()));
// AI 대기 구간(잘라 낼 부분) — 표지 앞을 잘라 낸 기준으로 옮김
const cutList = cuts.map(([a, b]) => [a - introAt, b - introAt]).filter(([, b]) => b > 0);
const cutTotal = cutList.reduce((n, [a, b]) => n + (b - Math.max(0, a)), 0);
const recorded = (Date.now() - t0) / 1000 - introAt - cutTotal; // 잘라 낸 뒤의 실제 길이

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
if (!AUDIO) {
  // 화면 동작이 계획보다 길어져 목표를 넘으면 전체를 살짝 빠르게 재생해 마지막 장면까지 정확히 TARGET 초에 담는다.
  // 부하가 크면 녹화 파일이 실제 시간보다 길어질 수 있어 파일 길이도 함께 본다
  const webmSec = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", webm]).toString().trim()) || 0;
  // 부하가 크면 녹화 파일의 시간이 실제 시간보다 느리게 흘러(예: 실제 287초 → 파일 326초) 뒤쪽 장면일수록 잘라 낼 위치가 어긋난다.
  // 표지 이후 실제 경과 시간과 파일 길이의 비율로 잘라 낼 구간을 파일 시간에 맞춘다
  const wallSpan = recorded + cutTotal;
  const fileSpan = webmSec - introAt;
  const drift = wallSpan > 0 && fileSpan / wallSpan > 1.01 ? fileSpan / wallSpan : 1;
  const cutFile = cutList.map(([a, b]) => [a * drift, b * drift]);
  const cutFileTotal = cutFile.reduce((n, [a, b]) => n + (b - Math.max(0, a)), 0);
  if (drift > 1) console.log(`녹화 시간 보정 ×${drift.toFixed(3)}(파일이 실제보다 김)`);
  const span = Math.max(recorded, fileSpan - cutFileTotal);
  const f = span > TARGET ? TARGET / span : 1;
  const vf = [];
  if (cutList.length) vf.push("fps=25", `select='not(${cutFile.map(([a, b]) => `between(t\\,${Math.max(0, a).toFixed(2)}\\,${b.toFixed(2)})`).join("+")})'`, "setpts=N/25/TB");
  if (f < 1) vf.push(`setpts=${f.toFixed(4)}*PTS`);
  if (vf.length) args.push("-vf", vf.join(","), "-r", "25");
  if (cutList.length) console.log(`AI 대기 ${cutList.length}구간 ${cutTotal.toFixed(1)}초 잘라 냄`);
  args.push("-t", String(TARGET));
  console.log(`녹화 ${recorded.toFixed(1)}초(파일 ${webmSec.toFixed(1)}초) → ${TARGET}초${f < 1 ? ` (${(1 / f).toFixed(3)}배속)` : ""}`);
}
args.push("-c:v", "libx264", "-preset", "medium", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-shortest", OUT);
execFileSync("ffmpeg", args);
fs.rmSync(tmp, { recursive: true, force: true });
const dur = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", OUT]).toString().trim();
console.log(`✔ ${OUT} (${Math.round(Number(dur))}초, ${(fs.statSync(OUT).size / 1024 / 1024).toFixed(1)} MB, ${AUDIO ? `내레이션 ${cues.length}개` : "음성 없음"})`);
