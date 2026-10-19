// 시연영상 자동 녹화 — 실행 중인 법이음을 브라우저로 조작하며 자막·내레이션과 함께 녹화하고 mp4로 변환한다.
//   node scripts/record-demo.mjs [기본주소] [출력.mp4] [내레이션폴더]
//   내레이션폴더: scripts/tts_narration.py 로 만든 s00.wav… + durations.json (없으면 자막만)
//   NO_AUDIO=1(또는 내레이션폴더 없음)이면 자막만 — 장면 시간은 PLAN, 전체 길이는 TARGET_SEC(기본 180초)에 맞춘다
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
const TARGET = Number(process.env.TARGET_SEC ?? 180);
// 자막만 녹화할 때 장면별 길이(초) — 자막을 읽을 시간 + 화면 동작. 마지막 장면(s18)은 남은 시간을 채운다
const PLAN = { s00: 3.5, s01: 6.5, s02: 7.5, s03: 6.5, s04: 6, s05: 9.5, s06: 16, s07: 11, s08: 8.5, s09: 6, s10: 6, s11: 9.5, s12: 8, s13: 10, s14: 8, s15: 9.5, s16: 13, s17: 11 };
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
if (!casesLive) PLAN.s05 += 6; // 판례 장면이 없으면 다른 장면에 시간을 나눠 준다

// 첫 검색 결과를 미리 한 번 불러 두어(서버 예열) 녹화 중 대기 시간을 줄인다
await fetch(`${BASE}/api/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "퇴사했는데 마지막 월급을 안 줘요", mode: "citizen" }) }).catch(() => {});

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
await scene("s00", async () => {
  await card(`<span class="chip">2026 공공 AI 대전환 챌린지 · 세션 1</span><h1>법이음 (LAW:ON)</h1><p>국민에게는 쉬운 말로, 공직자에게는 정확한 근거로<br>근거 조문을 먼저 찾고 답하는 AI 법률 지능형 포털</p>`);
  await wait(150);
  introAt = (Date.now() - t0) / 1000;
});
await scene("s01", async () => {
  await card("");
  await cap("① 첫 화면은 국민 모드 — 궁금한 상황을 일상 언어로 물어봅니다", "예: 퇴사했는데 마지막 월급을 안 줘요");
  const input = page.locator("main form input").first();
  await click(input);
  await input.type("퇴사했는데 마지막 월급을 안 줘요", { delay: 70 });
});
await scene("s02", async () => {
  await page.keyboard.press("Enter");
  await page.waitForURL(/search/);
  await page.locator("[aria-label^='근거 1:']").first().waitFor().catch(() => {});
  await cap("문장마다 근거 조문 번호 — 근거 목록 밖 인용은 자동 제거(환각 방지)", "AI가 지어낸 가짜 조문·판례를 막습니다");
  await wait(1200);
  await point(page.locator("[aria-label^='근거 1:']").first());
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
await scene("s05", async () => {
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
  await cap("② AI 법률 상황 분석실 — 겪은 일을 이야기하듯 적으면", "예시: 전세 보증금·연락 두절");
  await wait(400);
  await click(page.locator("button", { hasText: "전세 보증금" }).first());
  await wait(500);
  await click(page.locator("button", { hasText: /3관점 분석/ }).first());
  await page.getByText("사실관계 정리").first().waitFor().catch(() => {});
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
  await cap("변호사 · 검사 · 판사 3관점 검토 — 판사 관점은 요건 충족표", "모든 관점 문장도 같은 인용 검증을 거칩니다");
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
await scene("s10", async () => {
  await click(page.locator("[aria-label='공직자 모드 전환']:visible").first());
  await wait(300);
  await cap("③ 공직자 모드 — 같은 엔진, 실무용 화면", "핵심 법령 해시태그: 근로기준법 · 지방공기업법 · 공직선거법 · 부정청탁금지법 · 공유재산법");
  await wait(2500);
  await point(page.locator("button", { hasText: "부정청탁금지법" }).first());
});
await scene("s11", async () => {
  await page.locator("button", { hasText: "부정청탁금지법" }).first().click();
  await page.waitForURL(/search/);
  await page.getByText("검토 결론").first().waitFor().catch(() => {});
  await cap("검토 결론 → 법적 근거 체계 → 주요 쟁점 → 업무 유의사항 → 체크리스트", "보고서체로 정리 · 인용문 복사로 공문서에 바로 활용");
  await wait(3500);
  await scrollBy(480, 14);
});
await scene("s12", async () => {
  const pack = page.locator("button", { hasText: "보고서 한 번에 작성" }).first();
  if (await has(pack)) {
    await click(pack);
    await page.locator("[role=dialog]").first().waitFor().catch(() => {});
    await wait(300);
  }
  await cap("보고서 한 번에 작성 — 검토 보고서 · 기안문 · 민원 회신문 · 붙임 4종", "검증된 답변·근거 원문만 공문서 서식에 배치 · Word 저장");
});
await scene("s13", async () => {
  await page.keyboard.press("Escape");
  await page.goto(BASE + "/compliance");
  await cap("④ 자체규정 점검 — 우리 기관 규정 파일(한글·PDF·Word)을 넣으면", "파일은 서버로 보내지 않고 브라우저 안에서만 읽습니다 · 끌어다 놓기 또는 모의데이터 버튼");
  await point(page.locator("[aria-label^='규정 파일 올리기']").first());
  await wait(1200);
  const mock = page.locator("main button:visible", { hasText: "HWPX" }).first();
  await point(mock);
  await cap("모의데이터로 바로 체험 — 버튼 한 번에 한글(HWPX) 규정 파일 읽기부터 검증까지", "가상시설관리공단 복무 및 보수 규정 · 조문 11개 인식");
  await wait(1500);
  await mock.click();
  await page.waitForFunction(() => document.querySelector("#compliance-result")?.innerText.includes("교차 검증 결과"), null, { timeout: 30000 }).catch(() => {});
});
await scene("s14", async () => {
  await wait(300);
  await scrollToEl("#compliance-result");
  await wait(700);
  await cap("상위법령과 조문 단위 대조 — 상충 · 검토 필요 · 적합으로 분류", "판정은 생성형 문장이 아니라 정해진 기준과 조문 원문으로");
});
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
await scene("s17", async () => {
  await page.goto(BASE + "/laws/labor-standards");
  await page.waitForLoadState("networkidle").catch(() => {});
  await cap("법제처 형식 조문 뷰어 · 상위법–시행령–시행규칙 3단 대조", "법령·행정규칙·자치법규·판례 실시간 조회 — 실행판·공유판도 클라우드 중계로 키 입력 없이");
  await wait(5000);
  await page.goto(BASE + "/about");
  await page.waitForLoadState("networkidle").catch(() => {});
  await cap("LLM 비종속 — EXAONE·Gemma·Llama·Solar(Ollama) · OpenAI 호환 · Claude", "어떤 모델이든 같은 인용 검증 가드 · 실패 시 규칙기반 답변으로 자동 대체");
  await wait(1500);
  await scrollBy(420, 14);
});
await scene("s18", async () => {
  await cap("");
  await card(`<h1>법이음 (LAW:ON)</h1><ul><li>✔ 근거 조문을 먼저 찾고 인용 — 가짜 조문·판례 차단</li><li>✔ 국민 모드 · 공직자 모드 한 엔진 두 화면</li><li>✔ 판례 실시간 조회 · 관련 기관 연락처 안내</li><li>✔ 자체규정 점검(모의데이터 원클릭) → 개정안 → 제·개정 문서까지</li><li>✔ LLM 비종속 · 설치 없는 웹·한 파일 공유판 · 실행판</li></ul><p style="font-size:20px;margin-top:10px">다른 기관 규정·법령은 데이터 추가만으로 확산</p>`);
});
// 마지막 장면은 목표 길이(TARGET)까지 채우되 최소 6초는 보여 주고, 내레이션이 있으면 그 끝까지
const endAt = AUDIO ? sceneEnd + 800 : t0 + (introAt + TARGET + 0.3) * 1000;
await wait(Math.max(6000, endAt - Date.now()));
const recorded = (Date.now() - t0) / 1000 - introAt; // 잘라 낸 뒤의 실제 길이

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
  // 화면 동작이 계획보다 길어져 목표를 넘으면 전체를 살짝 빠르게 재생해 마지막 장면까지 정확히 TARGET 초에 담는다
  const f = recorded > TARGET ? TARGET / recorded : 1;
  if (f < 1) args.push("-vf", `setpts=${f.toFixed(4)}*PTS`, "-r", "25");
  args.push("-t", String(TARGET));
  console.log(`녹화 ${recorded.toFixed(1)}초 → ${TARGET}초${f < 1 ? ` (${(1 / f).toFixed(3)}배속)` : ""}`);
}
args.push("-c:v", "libx264", "-preset", "medium", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-shortest", OUT);
execFileSync("ffmpeg", args);
fs.rmSync(tmp, { recursive: true, force: true });
const dur = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", OUT]).toString().trim();
console.log(`✔ ${OUT} (${Math.round(Number(dur))}초, ${(fs.statSync(OUT).size / 1024 / 1024).toFixed(1)} MB, ${AUDIO ? `내레이션 ${cues.length}개` : "음성 없음"})`);
