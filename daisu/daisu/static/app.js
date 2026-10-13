/* 다이수 – 화면 스크립트(빌드 도구·외부 CDN 없이 동작: 폐쇄망 대응) */
"use strict";

// ───────────── 공통 도구
const $ = (s, el = document) => el.querySelector(s);
function add(el, ...kids) { el.append(...kids.flat(Infinity).filter((k) => k != null && k !== false).map((k) => (k instanceof Node ? k : document.createTextNode(String(k))))); return el; }
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else if (k === "checked") el.checked = !!v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  return add(el, kids);
}
function toast(msg, ms = 2600) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), ms);
}
async function api(path, opts = {}) {
  const o = { ...opts };
  if (o.json !== undefined) { o.body = JSON.stringify(o.json); o.headers = { "Content-Type": "application/json" }; delete o.json; }
  const r = await fetch(path, o);
  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("json") ? await r.json() : await r.text();
  if (!r.ok) { const m = (data && data.detail) || r.statusText; toast(String(m), 4000); throw new Error(m); }
  return data;
}
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ } },
};
const WEEK = "일월화수목금토";
function pd(iso) { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); }
function kd(iso, year = false) { if (!iso) return ""; const d = pd(iso); return `${year ? d.getFullYear() + ". " : ""}${d.getMonth() + 1}. ${d.getDate()}.(${WEEK[d.getDay()]})`; }
function fh(x) { return Number.isInteger(x) ? String(x) : (Math.round(x * 10) / 10).toString(); }
function ddayText(n) { return n == null ? "" : n < 0 ? `기한 ${-n}일 지남` : n === 0 ? "오늘 마감" : `D-${n}`; }
function copy(text) { (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast("복사했습니다"), () => toast("복사할 수 없는 환경입니다")); }
function dl(url) { const a = h("a", { href: url }); document.body.append(a); a.click(); a.remove(); }
const ST = { done: "이수", partial: "부족", none: "미이수", leave: "휴직", na: "–", left: "퇴사" };
const KIND = { roster: "직원 명단", records: "이수 기록", sign: "집합교육 서명부", cert: "수료증", shift: "근무표", survey: "만족도 조사", guide: "지침·규정", other: "읽기만 함" };

const S = { info: null, data: null };

// ───────────── 라우팅
window.addEventListener("hashchange", route);
document.addEventListener("DOMContentLoaded", async () => {
  $("#drawerClose").onclick = closeDrawer;
  $("#modelBadge").onclick = () => (location.hash = "#/settings");
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
  await loadInfo();
  route();
});
async function loadInfo() { S.info = await api("/api/info"); $("#modelBadge").textContent = "AI: " + S.info.model; }
function route() {
  closeDrawer();
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  document.body.classList.toggle("kiosk-mode", parts[0] === "kiosk");
  if (parts[0] === "kiosk" && parts[1] && parts[2]) return viewKiosk(parts[1], parts[2]);
  if (parts[0] === "p" && parts[1]) return viewProject(parts[1], parts[2] || "results", decodeURIComponent(parts[3] || ""));
  if (parts[0] === "settings") return viewSettings();
  return viewHome();
}
function mount(...kids) { const app = $("#app"); app.replaceChildren(); add(app, kids); window.scrollTo(0, 0); }
function openDrawer(title, ...kids) { $("#drawerTitle").textContent = title; $("#drawerBody").replaceChildren(); add($("#drawerBody"), kids); $("#drawer").classList.add("open"); }
function closeDrawer() { $("#drawer").classList.remove("open"); }

// ───────────── 처음 화면
async function viewHome() {
  const list = await api("/api/projects");
  const name = h("input", { placeholder: "예) 2026년 법정의무교육", value: "" });
  const base = h("input", { type: "date", value: S.info.today });
  let mode = "sample";
  const pane = h("div");
  const files = h("input", { type: "file", multiple: true, style: "display:none" });
  const folder = h("input", { type: "file", multiple: true, webkitdirectory: true, style: "display:none" });
  const pathIn = h("input", { placeholder: "예) C:\\교육자료\\2026", style: "width:100%" });
  let picked = [];
  const pickedInfo = h("div", { class: "small muted" });
  const okExt = new Set(S.info.supported);
  function take(list) {
    // 확장자로 먼저 걸러 사진·동영상 등은 읽지 않음
    picked = [...list].filter((f) => okExt.has("." + f.name.split(".").pop().toLowerCase()) && !f.name.startsWith("~$"));
    const skipped = list.length - picked.length;
    pickedInfo.textContent = `${picked.length}개 선택` + (skipped ? ` (지원하지 않는 형식 ${skipped}개 제외)` : "");
  }
  files.onchange = () => take(files.files);
  folder.onchange = () => take(folder.files);
  const drop = h("div", { class: "drop" }, "여기에 파일을 끌어다 놓거나 ",
    h("a", { href: "#", onclick: (e) => { e.preventDefault(); files.click(); } }, "파일 선택"), " · ",
    h("a", { href: "#", onclick: (e) => { e.preventDefault(); folder.click(); } }, "폴더 선택"),
    h("div", { class: "tiny", style: "margin-top:6px" }, "엑셀·CSV·한글(HWPX/HWP)·워드·PDF"), pickedInfo);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); take(e.dataTransfer.files); };
  const panes = {
    sample: h("div", {}, h("p", { class: "small" }, "가상의 ‘가상구시설관리공단’(직원 120명, 교대 현장직 69명) 자료 18개로 전 과정을 체험합니다."),
      h("ul", { class: "small muted" }, h("li", {}, "직원 명단, 사이버·직무교육 이수현황, 외부(위탁)교육 실적, 교육 예산(엑셀)"),
        h("li", {}, "집합교육 서명부(한글·엑셀·워드), 수료증(PDF), 교대근무표, 만족도 조사"),
        h("li", {}, "[모의] 교육훈련규정·여비규정·강사수당 기준·경영평가 편람·정부 교육 계획"))),
    upload: h("div", {}, drop, files, folder),
    path: h("div", {}, h("label", { class: "f" }, "이 PC의 폴더 경로(서버가 같은 PC에서 실행될 때)"), pathIn),
  };
  const modeTabs = h("div", { class: "tabs", style: "margin:4px 0 12px" });
  const MODES = [["sample", "샘플로 체험"], ["upload", "파일·폴더 올리기"], ["path", "PC 폴더 경로"]];
  function setMode(m) {
    mode = m;
    modeTabs.replaceChildren(...MODES.map(([k, l]) => h("a", { href: "#", class: "tab" + (k === m ? " on" : ""), onclick: (e) => { e.preventDefault(); setMode(k); } }, l)));
    pane.replaceChildren(panes[m]);
    base.disabled = m === "sample";
    if (m === "sample") base.value = S.info.sample_base;
  }
  setMode(S.info.sample ? "sample" : "upload");
  const go = h("button", { class: "btn primary", onclick: start }, "시작하기");
  async function start() {
    go.disabled = true; go.textContent = "자료를 읽는 중…";
    try {
      let r;
      if (mode === "sample") r = await api("/api/projects/sample", { method: "POST" });
      else if (mode === "path") r = await api("/api/projects/path", { method: "POST", json: { path: pathIn.value, name: name.value, base_date: base.value } });
      else {
        if (!picked.length) throw new Error(toast("파일을 선택하세요"));
        const fd = new FormData();
        picked.forEach((f) => fd.append("files", f, f.webkitRelativePath || f.name));
        fd.append("name", name.value); fd.append("base_date", base.value);
        r = await api("/api/projects/upload", { method: "POST", body: fd });
      }
      location.hash = `#/p/${r.id}/results`;
    } catch { go.disabled = false; go.textContent = "시작하기"; }
  }
  mount(
    h("div", { class: "grid g2" },
      h("div", { class: "card hero" },
        h("h1", {}, "교육 폴더를 통째로 넣으면, 보고서가 나옵니다"),
        h("p", {}, "법정·필수·직무·외부(위탁) 교육 기록과 함께 경영평가 편람, 정부 교육 계획, 회사 교육훈련규정·여비규정, 강사수당 기준을 넣으세요. ",
          "다이수가 규정을 읽어 계산 기준을 스스로 세우고, 모든 교육 실적을 집계해 실적 보고서·경영평가 지표·정산서까지 씁니다."),
        h("div", { class: "steps" },
          h("div", { class: "step" }, h("b", {}, "1. 규정을 읽는다"), h("span", { class: "small" }, "목표 시간·필수교육·여비·강사수당·평가 산식을 근거와 함께")),
          h("div", { class: "step" }, h("b", {}, "2. 모든 교육을 맞춘다"), h("span", { class: "small" }, "명단 × 이수기록 × 기준 → 직원별·분야별 판정")),
          h("div", { class: "step" }, h("b", {}, "3. 보고서를 쓴다"), h("span", { class: "small" }, "실적 보고, 경영평가 지표, 정산서, 내년 계획(한글)"))),
        h("ul", { class: "small muted" },
          h("li", {}, "규정에서 읽은 값마다 문서·조항 원문이 붙어 그대로 결재 근거가 됩니다."),
          h("li", {}, "동명이인·이름 오타처럼 기계가 확신하지 못한 것만 사람에게 묻습니다."),
          h("li", {}, "계산은 규칙으로 하고(AI 추측 없음), 인터넷 없이 동작합니다."))),
      h("div", { class: "card" }, h("h2", {}, "새 작업"),
        modeTabs, pane,
        h("div", { class: "grid g2", style: "margin-top:12px" },
          h("div", { class: "field" }, h("label", { class: "f" }, "작업 이름(선택)"), name),
          h("div", { class: "field" }, h("label", { class: "f" }, "기준일(오늘 기준으로 기한 판정)"), base)),
        h("div", { class: "row" }, go))),
    h("h2", { style: "margin-top:8px" }, "진행 중인 작업"),
    list.length ? h("div", { class: "card", style: "padding:0" }, h("table", {},
      h("tr", {}, h("th", {}, "이름"), h("th", {}, "기준일"), h("th", {}, "자료"), h("th", {}, "만든 때"), h("th", {})),
      list.map((p) => h("tr", { class: "click", onclick: () => (location.hash = `#/p/${p.id}/results`) },
        h("td", {}, p.name), h("td", {}, p.base_date), h("td", {}, p.files + "개"), h("td", { class: "muted" }, p.created),
        h("td", { class: "num" }, h("button", { class: "btn sm ghost", onclick: async (e) => { e.stopPropagation(); if (!confirm("이 작업을 지울까요? (원본 자료는 그대로)")) return; await api(`/api/projects/${p.id}`, { method: "DELETE" }); viewHome(); } }, "삭제"))))))
      : h("div", { class: "card empty" }, "아직 없습니다. ‘샘플로 체험’으로 시작해 보세요."));
}

// ───────────── 작업 화면
const TABS = [["files", "자료"], ["regs", "규정·기준"], ["results", "교육 실적"], ["board", "법정·필수 현황"], ["matrix", "이수 현황표"],
  ["issues", "확인 필요"], ["plan", "일정 짜기"], ["run", "교육 운영"], ["notify", "안내문"], ["report", "보고서"], ["year", "연간 계획"], ["ask", "질문하기"]];

async function viewProject(pid, tab, arg) {
  const d = await api(`/api/projects/${pid}`);
  S.data = d;
  const P = d.project;
  const baseIn = h("input", { type: "date", value: d.base, style: "padding:3px 6px", onchange: async () => {
    await api(`/api/projects/${pid}`, { method: "PATCH", json: { base_date: baseIn.value } }); toast("기준일을 바꿨습니다"); route();
  } });
  const by = Number(d.base.slice(0, 4));
  const yearSel = h("select", { style: "padding:3px 6px", title: "판정 연도(1~2월에 지난해 실적을 정리할 때 바꿉니다)", onchange: async () => {
    await api(`/api/projects/${pid}`, { method: "PATCH", json: { year: yearSel.value === String(by) ? null : yearSel.value } }); toast("판정 연도를 바꿨습니다"); route();
  } }, [by, by - 1].map((y) => h("option", { value: String(y) }, `${y}년 교육`)));
  yearSel.value = String(d.year);
  const nIssues = d.issues.length;
  const head = h("div", { class: "ph" },
    h("div", {}, h("h1", {}, P.name),
      h("div", { class: "row small muted", style: "margin-top:4px" }, "기준일", baseIn, yearSel, `· 자료 ${d.files.length}개 · 직원 ${d.people.length}명`,
        d.integrity ? h("span", { class: "badge b-done", title: "처리 전후 파일 지문(SHA-256)이 같습니다" }, "원본 변경 없음") : h("span", { class: "badge b-none" }, "자료 변경 감지"))),
    h("a", { class: "btn", href: "#/" }, "다른 작업"));
  const tabs = h("nav", { class: "tabs" }, TABS.map(([k, l]) => h("a", { class: "tab" + (k === tab || (k === "run" && tab === "session") ? " on" : ""), href: `#/p/${pid}/${k}` }, l,
    k === "issues" ? h("span", { class: "cnt" + (nIssues ? "" : " ok") }, nIssues || "0") : null)));
  const body = h("div");
  mount(head, tabs, body);
  const fn = { files: tabFiles, regs: tabRegs, results: tabResults, board: tabBoard, matrix: tabMatrix, issues: tabIssues, plan: tabPlan, run: tabRun, session: tabSession, notify: tabNotify, report: tabReport, year: tabYear, ask: tabAsk }[tab] || tabBoard;
  await fn(body, d, arg);
}

// ① 자료
function tabFiles(el, d) {
  add(el,
    d.integrity ? h("div", { class: "alert ok" }, `원본 보호 확인: 넣은 자료 ${d.files.length}개의 지문(SHA-256)이 처리 전후 같습니다. 다이수는 자료를 읽기만 합니다.`) : null,
    h("div", { class: "card", style: "padding:0" }, h("table", {},
      h("tr", {}, h("th", {}, "파일"), h("th", {}, "알아낸 종류"), h("th", { class: "num" }, "직원"), h("th", { class: "num" }, "기록"), h("th", {}, "비고")),
      d.files.map((f) => h("tr", {},
        h("td", {}, f.rel), h("td", {}, f.kinds.map((k) => h("span", { class: "badge b-brand", style: "margin-right:4px" }, KIND[k] || k))),
        h("td", { class: "num" }, f.n_people || ""), h("td", { class: "num" }, f.n_records || ""), h("td", { class: "small muted" }, f.note))))),
    h("p", { class: "small muted" }, "엑셀 머리글(사번·성명·소속·과정명·이수일·서명 등)을 보고 자료 종류를 스스로 알아냅니다. 양식이 달라도 머리글 이름이 비슷하면 됩니다."),
    d.shifts.length ? h("p", { class: "small" }, "근무표: " + d.shifts.map((s) => `${s.month} (${s.people}명)`).join(", ")) : h("div", { class: "alert warn" }, "교대근무표가 없습니다. 일정 짜기는 일근 기준으로만 계산합니다."));
}

// ② 현황판
function deptStats(d) {
  const out = {};
  for (const p of d.people) {
    if (p.left && p.left <= d.base) continue;
    const o = (out[p.dept] = out[p.dept] || { n: 0, miss: 0, over: 0 });
    o.n++;
    const cells = Object.entries(d.cells[p.id]).filter(([k]) => d.columns.find((c) => c.key === k).mandatory).map(([, c]) => c);
    if (cells.some((c) => c.s === "none" || c.s === "partial")) o.miss++;
    if (cells.some((c) => c.overdue)) o.over++;
  }
  return out;
}
async function tabBoard(el, d) {
  const pid0 = d.project.id;
  const tasks = await api(`/api/projects/${pid0}/tasks`);
  el.append(taskCard(d, tasks));
  const man = d.summary.filter((s) => s.mandatory);
  const avg = man.length ? Math.round(man.reduce((a, s) => a + (s.rate || 0), 0) / man.length * 10) / 10 : 0;
  const overPeople = d.people.filter((p) => Object.values(d.cells[p.id]).some((c) => c.overdue)).length;
  const active = d.people.filter((p) => !(p.left && p.left <= d.base)).length;
  const over = man.filter((s) => s.overdue);
  const pid = d.project.id;
  add(el,
    over.length ? h("div", { class: "alert bad" }, h("b", {}, "기한이 지난 교육이 있습니다. "),
      over.map((s) => `${s.label} ${s.overdue}명`).join(", "), " – ", h("a", { href: `#/p/${pid}/matrix/over` }, "명단 보기")) : null,
    h("div", { class: "grid g4" },
      h("div", { class: "card kpi" }, h("div", { class: "v" }, active), h("div", { class: "l" }, "재직 인원(휴직 포함)")),
      h("div", { class: "card kpi " + (avg >= 90 ? "ok" : avg >= 70 ? "warn" : "bad") }, h("div", { class: "v" }, avg + "%"), h("div", { class: "l" }, "법정의무교육 평균 이수율")),
      h("div", { class: "card kpi " + (overPeople ? "bad" : "ok") }, h("div", { class: "v" }, overPeople + "명"), h("div", { class: "l" }, "기한 지난 교육이 있는 직원")),
      h("div", { class: "card kpi " + (d.issues.length ? "warn" : "ok") }, h("div", { class: "v" }, d.issues.length + "건"), h("div", { class: "l" }, h("a", { href: `#/p/${pid}/issues` }, "확인 필요")))),
    h("div", { class: "card", style: "padding:0" },
      h("div", { class: "row between", style: "padding:14px 16px 6px" }, h("h2", { style: "margin:0" }, "교육별 이수 현황"),
        h("div", { class: "legend" }, h("span", {}, h("i", { style: "background:var(--done)" }), "이수"), h("span", {}, h("i", { style: "background:#e0a526" }), "부족"), h("span", {}, h("i", { style: "background:#e5847a" }), "미이수"))),
      h("table", {},
        h("tr", {}, h("th", {}, "교육"), h("th", { class: "num" }, "대상"), h("th", { style: "width:26%" }, "진행"), h("th", { class: "num" }, "이수율"), h("th", { class: "num" }, "남은 인원"), h("th", {}, "기한"), h("th", {})),
        d.summary.map((s) => {
          const t = Math.max(1, s.target);
          return h("tr", {},
            h("td", {}, h("b", {}, s.label), s.mandatory ? "" : h("span", { class: "badge", style: "margin-left:6px" }, "권장"), h("div", { class: "tiny muted" }, s.law)),
            h("td", { class: "num" }, s.target, s.leave ? h("div", { class: "tiny muted" }, `휴직 ${s.leave}`) : null),
            h("td", {}, h("div", { class: "bar", title: `이수 ${s.done} · 부족 ${s.partial} · 미이수 ${s.none}` },
              h("i", { class: "d", style: `width:${100 * s.done / t}%` }), h("i", { class: "p", style: `width:${100 * s.partial / t}%` }), h("i", { class: "n", style: `width:${100 * s.none / t}%` }))),
            h("td", { class: "num" }, s.rate == null ? "-" : s.rate + "%"),
            h("td", { class: "num" }, s.partial + s.none, s.partial ? h("div", { class: "tiny muted" }, `부족 ${s.partial}`) : null),
            h("td", {}, s.overdue ? h("span", { class: "badge b-none" }, `기한 지남 ${s.overdue}명`) : (s.partial + s.none ? h("span", { class: "small" }, s.due ? `${kd(s.due)} · ${ddayText(s.dday)}` : "입사일 기준") : h("span", { class: "badge b-done" }, "완료"))),
            h("td", { class: "num" }, s.partial + s.none ? [h("a", { class: "btn sm", href: `#/p/${pid}/matrix/${encodeURIComponent(s.key)}` }, "명단"), " ",
              h("a", { class: "btn sm", href: `#/p/${pid}/plan/${encodeURIComponent(s.key)}` }, "일정")] : null));
        }))),
    (() => {
      const ds = deptStats(d);
      return h("div", { class: "card", style: "padding:0" }, h("h2", { style: "padding:14px 16px 0" }, "부서별"),
        h("table", {}, h("tr", {}, h("th", {}, "부서"), h("th", { class: "num" }, "인원"), h("th", { class: "num" }, "남은 교육이 있는 직원"), h("th", { class: "num" }, "기한 지남"), h("th", {})),
          d.depts.map((dep) => h("tr", {}, h("td", {}, dep), h("td", { class: "num" }, ds[dep]?.n || 0), h("td", { class: "num" }, ds[dep]?.miss || 0),
            h("td", { class: "num" }, ds[dep]?.over ? h("span", { class: "badge b-none" }, ds[dep].over + "명") : "0"),
            h("td", { class: "num" }, h("a", { class: "btn sm", href: `#/p/${pid}/matrix/dept:${encodeURIComponent(dep)}` }, "보기"))))));
    })());
}

// ③ 이수 현황표
function tabMatrix(el, d, arg) {
  const f = { dept: "", state: "", col: "", q: "" };
  if (arg === "over") f.state = "over";
  else if (arg.startsWith("dept:")) f.dept = arg.slice(5);
  else if (arg) { f.col = arg; f.state = "open"; }
  const deptSel = h("select", { onchange: () => { f.dept = deptSel.value; draw(); } }, h("option", { value: "" }, "전체 부서"), d.depts.map((x) => h("option", { value: x }, x)));
  deptSel.value = f.dept;
  const stSel = h("select", { onchange: () => { f.state = stSel.value; draw(); } }, h("option", { value: "" }, "전체 직원"), h("option", { value: "open" }, "남은 교육이 있는 직원"), h("option", { value: "over" }, "기한 지난 직원"));
  stSel.value = f.state;
  const colSel = h("select", { onchange: () => { f.col = colSel.value; draw(); } }, h("option", { value: "" }, "모든 교육"), d.columns.map((c) => h("option", { value: c.key }, c.label)));
  colSel.value = f.col;
  const q = h("input", { placeholder: "이름 검색", oninput: () => { f.q = q.value.trim(); draw(); } });
  const box = h("div");
  const count = h("span", { class: "small muted" });
  add(el, h("div", { class: "row", style: "margin-bottom:10px" }, deptSel, stSel, colSel, q, count,
    h("div", { class: "legend right" }, ["done", "partial", "none", "leave"].map((s) => h("span", {}, h("i", { class: "c-" + s }), ST[s])), h("span", {}, h("i", { style: "outline:2px solid var(--none)" }), "기한 지남"))), box,
    h("p", { class: "small muted" }, "칸을 누르면 판정 근거(어느 파일 몇 행에서 몇 시간을 인정했는지)가 열립니다."));
  function draw() {
    const cols = d.columns.filter((c) => !f.col || c.key === f.col);
    const rows = d.people.filter((p) => {
      if (f.dept && p.dept !== f.dept) return false;
      if (f.q && !p.name.includes(f.q)) return false;
      const cs = cols.map((c) => d.cells[p.id][c.key]);
      if (f.state === "open" && !cs.some((c) => c.s === "none" || c.s === "partial")) return false;
      if (f.state === "over" && !cs.some((c) => c.overdue)) return false;
      return true;
    });
    count.textContent = `${rows.length}명`;
    box.replaceChildren(h("div", { class: "matrix-wrap" }, h("table", { class: "matrix" },
      h("tr", {}, h("th", { class: "sticky" }, "직원"), cols.map((c) => h("th", { title: c.law }, c.label, c.mandatory ? "" : " (권장)"))),
      rows.map((p) => h("tr", {},
        h("td", { class: "sticky" }, h("b", {}, p.name), h("div", { class: "tiny muted" }, `${p.dept} · ${p.shift}${p.team ? " " + p.team + "조" : ""}${p.job === "현장" ? " · 현장" : ""}`)),
        cols.map((c) => {
          const x = d.cells[p.id][c.key];
          const label = x.s === "partial" ? `${fh(x.h)}/${fh(x.need)}h` : x.s === "none" ? `0/${fh(x.need)}h` : ST[x.s];
          return h("td", { class: `c c-${x.s}${x.overdue ? " over" : ""}`, title: x.why || "", onclick: () => cellDrawer(d, p, c) }, label);
        }))))));
  }
  draw();
}
async function cellDrawer(d, p, c) {
  const x = d.cells[p.id][c.key];
  const recs = await api(`/api/projects/${d.project.id}/records?person=${encodeURIComponent(p.id)}`);
  const rname = d.rules.find((r) => r.id === c.rule)?.name;
  const mine = recs.filter((r) => r.rules.includes(rname));
  const used = new Set(x.recs);
  openDrawer(`${p.name} · ${c.label}`,
    h("div", { class: "alert " + (x.s === "done" ? "ok" : x.s === "leave" || x.s === "na" ? "info" : "bad") },
      h("b", {}, ST[x.s]), x.s === "na" || x.s === "left" ? ` – ${x.why}` : ` – 인정 ${fh(x.h)}시간 / 필요 ${fh(x.need)}시간`,
      x.s !== "na" && x.s !== "left" ? h("div", { class: "small" }, `기한 ${kd(x.due, true)}${x.overdue ? " (지남)" : ""}${x.why ? " · " + x.why : ""}`) : null),
    h("div", { class: "small muted" }, `${p.dept} · ${p.title} · ${p.emp} · ${p.shift}${p.team ? " " + p.team + "조" : ""} · 입사 ${p.hired}`),
    h("div", { class: "row", style: "margin-top:8px" }, h("span", { class: "small" }, "교육이력 카드"),
      h("button", { class: "btn sm", onclick: () => dl(`/api/projects/${d.project.id}/export?doc=card&fmt=hwpx&person=${encodeURIComponent(p.id)}`) }, "한글"),
      h("button", { class: "btn sm", onclick: () => dl(`/api/projects/${d.project.id}/export?doc=card&fmt=docx&person=${encodeURIComponent(p.id)}`) }, "워드")),
    h("h3", { style: "margin-top:14px" }, "근거"), h("div", { class: "small" }, c.law),
    c.note ? h("div", { class: "small muted" }, c.note) : null,
    lawBox(c.rule),
    h("h3", { style: "margin-top:14px" }, `이 교육 관련 기록 ${mine.length}건`),
    mine.length ? h("table", {}, h("tr", {}, h("th", {}, "과정"), h("th", {}, "날짜"), h("th", { class: "num" }, "시간"), h("th", {}, "판정")),
      mine.map((r) => h("tr", {},
        h("td", {}, r.title, h("div", { class: "tiny muted" }, `${r.file} · ${r.where}`)),
        h("td", { class: "small" }, r.date ? kd(r.date) : "-"), h("td", { class: "num" }, fh(r.hours)),
        h("td", {}, used.has(r.rid) ? h("span", { class: "badge b-done" }, "인정") : h("span", { class: "badge b-none" }, r.done ? "기간 밖" : r.note || "미이수")))))
      : h("p", { class: "muted small" }, "이 교육과 연결된 기록이 없습니다."));
}

// ④ 확인 필요
function tabIssues(el, d) {
  const pid = d.project.id;
  const ov = d.project.overrides || { person: {}, course: {} };
  const res = async (type, key, value) => { await api(`/api/projects/${pid}/resolve`, { method: "POST", json: { type, key, value } }); toast("반영했습니다"); route(); };
  const undo = async (type, key) => { await api(`/api/projects/${pid}/resolve?type=${type}&key=${encodeURIComponent(key)}`, { method: "DELETE" }); toast("되돌렸습니다"); route(); };
  const who = (c) => `${c.name} (${c.dept}${c.team ? " · " + c.team + "조" : ""}${c.title ? " · " + c.title : ""})`;
  const recChip = (r) => r ? h("div", { class: "chips", style: "margin:6px 0" }, h("span", { class: "chip" }, r.title), h("span", { class: "chip" }, r.date ? kd(r.date, true) : "날짜 없음"), h("span", { class: "chip" }, `${r.file} · ${r.where}`)) : null;
  add(el, h("div", { class: "alert info" }, "기계가 확신하지 못한 것만 모았습니다. 사람이 고르면 바로 이수 현황에 반영되고, 언제든 되돌릴 수 있습니다."));
  if (!d.issues.length) add(el, h("div", { class: "card empty" }, "확인할 것이 없습니다."));
  for (const i of d.issues) {
    const card = h("div", { class: "card issue" }, h("b", {}, i.text), recChip(i.record));
    if (i.type === "ambiguous" || i.type === "unknown") {
      add(card, h("div", { class: "row" }, (i.candidates || []).map((c) => h("button", { class: "btn sm primary", onclick: () => res("person", i.key, c.id) }, who(c) + "(으)로 지정")),
        h("button", { class: "btn sm", onclick: () => res("person", i.key, "ignore") }, "이 기록은 제외")));
    } else if (i.type === "course") {
      const checks = d.rules.map((r) => h("label", { class: "small", style: "margin-right:10px;white-space:nowrap" }, h("input", { type: "checkbox", value: r.id }), " " + r.name));
      add(card, h("div", { style: "margin:8px 0" }, checks),
        h("div", { class: "row" }, h("button", { class: "btn sm primary", onclick: () => {
          const v = checks.map((l) => l.querySelector("input")).filter((x) => x.checked).map((x) => x.value);
          if (!v.length) return toast("인정할 교육을 고르세요");
          res("course", i.key, v);
        } }, "고른 교육으로 인정"), h("button", { class: "btn sm", onclick: () => res("course", i.key, []) }, "의무교육 아님")));
    }
    add(el, card);
  }
  const done = [...Object.entries(ov.person || {}).map(([k, v]) => ["person", k, v]), ...Object.entries(ov.course || {}).map(([k, v]) => ["course", k, v])];
  if (done.length) {
    const pname = (id) => { const p = d.people.find((x) => x.id === id); return p ? `${p.name}(${p.dept})` : "제외"; };
    const rname = (ids) => ids.length ? ids.map((x) => d.rules.find((r) => r.id === x)?.name || x).join(", ") : "의무교육 아님";
    add(el, h("h2", { style: "margin-top:20px" }, "처리한 것"), h("div", { class: "card", style: "padding:0" }, h("table", {},
      done.map(([t, k, v]) => h("tr", {}, h("td", { class: "small" }, t === "person" ? `기록 ${k}` : `과정 ‘${k}’`),
        h("td", {}, t === "person" ? `→ ${pname(v)}` : `→ ${rname(v)}`), h("td", { class: "num" }, h("button", { class: "btn sm", onclick: () => undo(t, k) }, "되돌리기")))))));
  }
}

// ⑤ 일정 짜기
async function tabPlan(el, d, arg) {
  const pid = d.project.id;
  const open = d.summary.filter((s) => s.partial + s.none > 0);
  if (!open.length) return add(el, h("div", { class: "card empty" }, "모든 교육을 다 이수했습니다."));
  const def = arg && open.find((s) => s.key === arg) ? arg : (open.find((s) => s.key.endsWith("@H2")) || open.sort((a, b) => b.partial + b.none - a.partial - a.none)[0]).key;
  const colSel = h("select", {}, open.map((s) => h("option", { value: s.key }, `${s.label} (남은 ${s.partial + s.none}명)`)));
  colSel.value = def;
  const hours = h("input", { type: "number", min: "0.5", max: "8", step: "0.5", style: "width:80px", placeholder: "자동" });
  const out = h("div");
  const run = async () => {
    out.replaceChildren(h("div", { class: "muted" }, "계산 중…"));
    const qs = new URLSearchParams({ col: colSel.value });
    if (hours.value) qs.set("hours", hours.value);
    const pl = await api(`/api/projects/${pid}/plan?${qs}`);
    drawPlan(out, d, pl);
  };
  colSel.onchange = () => { hours.value = ""; run(); };
  add(el, h("div", { class: "card" }, h("div", { class: "row" }, h("b", {}, "교육"), colSel, h("b", {}, "회차당 시간"), hours, h("button", { class: "btn primary", onclick: run }, "일정 짜기"),
    h("a", { class: "btn right", href: "#/settings" }, "일정 규칙 설정")),
    d.shifts.length ? h("div", { class: "small muted", style: "margin-top:6px" }, `교대근무표(${d.shifts.map((s) => s.month).join(", ")})를 읽어 그 달 안에서 짭니다.`)
      : h("div", { class: "small", style: "margin-top:6px;color:var(--part)" }, "교대근무표가 없어 일근(평일) 기준으로만 짭니다.")), out);
  run();
}
function drawPlan(out, d, pl) {
  const pid = d.project.id;
  out.replaceChildren();
  if (!pl.sessions.length && !pl.unplaced.length) return add(out, h("div", { class: "card empty" }, pl.message || "배정할 대상이 없습니다."));
  const nv = pl.naive;
  add(out,
    h("div", { class: "compare", style: "margin-bottom:16px" },
      nv ? h("div", { class: "side bad" }, h("div", { class: "small muted" }, `대상자 ${pl.targets}명을 하루(${nv.date})에 모두 모으면`),
        h("div", { class: "big" }, `${nv.absent}명 참석 불가`), h("div", { class: "small" }, "야간·비번·휴무 등으로 그날 주간 근무가 아님"),
        nv.over.length ? h("div", { class: "small", style: "margin-top:6px" }, `현장 최소 인원 미달 ${nv.over.length}개 팀: `, nv.over.map((o) => `${o.dept}(${o.want}명 빠지면 안 됨, 최대 ${o.cap}명)`).join(", ")) : null) : h("div"),
      h("div", { class: "side good" }, h("div", { class: "small muted" }, "다이수 추천"),
        h("div", { class: "big" }, `${pl.sessions.length}회차 · ${pl.targets - pl.unplaced.length}명 배정`),
        pl.unplaced.length ? h("div", { class: "small" }, `남은 ${pl.unplaced.length}명은 회차 한도·근무일 부족으로 사이버교육 안내(아래 명단)`) : null,
        h("div", { class: "small" }, "비번·휴무일 호출 0명, 모든 팀이 현장 최소 인원 유지"),
        h("div", { class: "row", style: "margin-top:8px" },
          h("button", { class: "btn sm primary", onclick: async () => {
            const place = prompt("교육 장소(나중에 바꿀 수 있음)", "본사 3층 대회의실");
            if (place === null) return;
            await api(`/api/projects/${pid}/sessions`, { method: "POST", json: { col: pl.col.key, hours: pl.hours, place } });
            toast(`${pl.sessions.length}개 회차를 만들었습니다`); location.hash = `#/p/${pid}/run`;
          } }, "이 일정으로 회차 만들기"),
          h("button", { class: "btn sm", onclick: () => dl(`/api/projects/${pid}/export?doc=plan&fmt=hwpx&col=${encodeURIComponent(pl.col.key)}`) }, "일정 안내 한글"),
          h("button", { class: "btn sm", onclick: () => dl(`/api/projects/${pid}/export?doc=plan&fmt=docx&col=${encodeURIComponent(pl.col.key)}`) }, "워드")))),
    h("details", { class: "small muted", style: "margin-bottom:10px" }, h("summary", {}, "적용한 규칙"), h("ul", {}, pl.rules.map((r) => h("li", {}, r)))),
    pl.sessions.map((s, k) => h("details", { class: "session" },
      h("summary", {}, h("b", {}, `${k + 1}회차 · ${s.label}`), h("span", { class: "badge b-brand" }, `${s.count}명`),
        h("span", { class: "small muted" }, Object.entries(s.by_dept).map(([dep, n]) => `${dep} ${n}`).join(" · "))),
      h("div", { class: "chips", style: "margin-top:8px" }, s.people.map((p) => h("span", { class: "chip" }, `${p.name} · ${p.dept.replace(/팀$/, "")}${p.team ? " " + p.team + "조" : ""}`))))),
    pl.unplaced.length ? h("div", { class: "card", style: "margin-top:12px" }, h("h3", {}, `집합교육 배정이 어려운 직원 ${pl.unplaced.length}명 – 사이버교육 안내 권장`),
      h("table", {}, h("tr", {}, h("th", {}, "성명"), h("th", {}, "부서"), h("th", {}, "사유")),
        pl.unplaced.map((u) => h("tr", {}, h("td", {}, u.name + (u.team ? ` (${u.team}조)` : "")), h("td", {}, u.dept), h("td", { class: "small" }, u.why))))) : null);
}

// ⑥ 안내문
async function tabNotify(el, d) {
  const pid = d.project.id;
  const colSel = h("select", {}, h("option", { value: "" }, "모든 법정교육"), d.columns.filter((c) => c.mandatory).map((c) => h("option", { value: c.key }, c.label)));
  const within = h("select", {}, h("option", { value: "" }, "기한 상관없이"), h("option", { value: "30" }, "기한 30일 이내·지난 것"), h("option", { value: "14" }, "기한 14일 이내·지난 것"));
  const box = h("div");
  const run = async () => {
    const qs = new URLSearchParams();
    if (colSel.value) qs.set("col", colSel.value);
    if (within.value) qs.set("within", within.value);
    const r = await api(`/api/projects/${pid}/reminders?${qs}`);
    let shown = 20;
    const list = h("div");
    const drawList = () => {
      list.replaceChildren(...r.people.slice(0, shown).map((m) => h("div", { class: "card", style: "padding:12px 14px;margin-bottom:8px" },
        h("div", { class: "row between" }, h("b", {}, `${m.name} · ${m.dept}${m.team ? " " + m.team + "조" : ""}`, m.overdue ? h("span", { class: "badge b-none", style: "margin-left:6px" }, "기한 지남") : null),
          h("button", { class: "btn sm", onclick: () => copy(m.text) }, "복사")), h("div", { class: "msg" }, m.text))));
      if (r.people.length > shown) list.append(h("button", { class: "btn", onclick: () => { shown += 40; drawList(); } }, `더 보기 (${r.people.length - shown}명 남음)`));
    };
    drawList();
    const qs2 = new URLSearchParams(qs); qs2.set("doc", "reminders");
    box.replaceChildren(
      h("div", { class: "grid g2" },
        h("div", {}, h("div", { class: "row between", style: "margin-bottom:8px" }, h("h2", { style: "margin:0" }, `본인 안내 ${r.people.length}명`),
          h("div", { class: "row" }, h("button", { class: "btn sm", onclick: () => copy(r.people.map((m) => m.text).join("\n\n")) }, "모두 복사"),
            h("button", { class: "btn sm primary", onclick: () => dl(`/api/projects/${pid}/export?${qs2}`) }, "엑셀(문자 발송용)"))), list),
        h("div", {}, h("h2", {}, `부서장 통보 ${r.boss.length}개 팀`),
          r.boss.map((b) => h("div", { class: "card", style: "padding:12px 14px;margin-bottom:8px" },
            h("div", { class: "row between" }, h("b", {}, `${b.dept} · ${b.count}명`, b.overdue ? h("span", { class: "badge b-none", style: "margin-left:6px" }, `기한 지남 ${b.overdue}`) : null),
              h("button", { class: "btn sm", onclick: () => copy(b.text) }, "복사")), h("div", { class: "msg" }, b.text))))));
  };
  colSel.onchange = run; within.onchange = run;
  add(el, h("div", { class: "card" }, h("div", { class: "row" }, h("b", {}, "대상"), colSel, within,
    h("span", { class: "small muted" }, "기관 지침 예: 기한 30일 전 본인 안내, 14일 전 부서장 통보"))), box);
  run();
}

// ⑦ 보고·증빙
async function tabReport(el, d) {
  const pid = d.project.id;
  const ex0 = (doc, fmt) => dl(`/api/projects/${pid}/export?doc=${doc}&fmt=${fmt}`);
  const rep = (title, desc, doc) => h("div", { class: "card" }, h("h2", {}, title), h("p", { class: "small muted" }, desc),
    h("div", { class: "row" }, h("button", { class: "btn primary", onclick: () => ex0(doc, "hwpx") }, "한글(HWPX)"), h("button", { class: "btn", onclick: () => ex0(doc, "docx") }, "워드")));
  add(el, h("div", { class: "alert info" }, "모든 보고서는 넣은 규정에서 읽은 기준(‘규정·기준’ 탭)과 기록으로 계산한 숫자로 씁니다. 숫자마다 산출 근거가 함께 들어갑니다."),
    h("div", { class: "grid g2" },
      rep(`${d.year}년 교육훈련 실적 보고서`, "총괄(1인당 시간·내규 목표·정부 권장), 분야별 실적, 법정·필수교육, 외부교육(결과보고·한도), 예산 집행, 경영평가 지표, 개선 방향, 정부 중점 과제 대비", "annual"),
      rep("경영평가 교육훈련 지표 실적", "편람의 지표·산식 그대로, 실적값과 산출 근거(분자·분모), 편람 근거 위치, 증빙 자료 목록", "kpi"),
      h("div", { class: "card" }, h("h2", {}, "외부(위탁)교육 정산"), h("p", { class: "small muted" }, "여비규정·교육여비 특례로 산정한 일비·식비·숙박비, 교육비, 결과보고 기한 준수 여부"),
        h("div", { class: "row" }, h("button", { class: "btn primary", onclick: () => ex0("settle", "") }, "정산 내역 엑셀"))),
      rep("규정 해석 기준표", "다이수가 규정 문서에서 읽어 적용한 기준과 원문 근거 – 보고서 결재 시 붙임으로", "criteria")));
  const open = d.summary.filter((s) => s.partial + s.none > 0);
  const planSel = h("select", {}, h("option", { value: "" }, "일정 계획 넣지 않음"), open.map((s) => h("option", { value: s.key }, s.label + " 일정 포함")));
  const ex = (doc, fmt, extra = "") => dl(`/api/projects/${pid}/export?doc=${doc}&fmt=${fmt}${extra}`);
  add(el, h("div", { class: "grid g2" },
    h("div", { class: "card" }, h("h2", {}, "이수 현황 보고서"),
      h("p", { class: "small muted" }, "교육별 이수율, 기한 지난 교육과 명단, 부서별 미이수 현황, 향후 계획을 담은 결재용 보고서입니다."),
      h("div", { class: "row" }, planSel), h("div", { class: "row", style: "margin-top:10px" },
        h("button", { class: "btn primary", onclick: () => ex("status", "hwpx", planSel.value ? "&col=" + encodeURIComponent(planSel.value) : "") }, "한글(HWPX)"),
        h("button", { class: "btn", onclick: () => ex("status", "docx", planSel.value ? "&col=" + encodeURIComponent(planSel.value) : "") }, "워드"),
        h("button", { class: "btn", onclick: () => ex("status", "md") }, "마크다운"))),
    h("div", { class: "card" }, h("h2", {}, "이수현황 엑셀 · 증빙 묶음"),
      h("p", { class: "small muted" }, "엑셀: 교육별 요약, 직원별 이수현황(색 구분), 미이수자, 판정 근거(기록별 파일·행), 확인 필요"),
      h("p", { class: "small muted" }, "증빙 묶음: 교육별 폴더에 이수를 인정한 원본 서명부·이수현황·수료증과 증빙 목록을 모은 압축 파일(경영평가·감사 대비)"),
      h("div", { class: "row" }, h("button", { class: "btn primary", onclick: () => ex("excel", "") }, "이수현황 엑셀"), h("button", { class: "btn", onclick: () => ex("evidence", "") }, "증빙 묶음(ZIP)")))));
  const st = await api(`/api/projects/${pid}/stats`);
  add(el, h("div", { class: "grid g2" },
    h("div", { class: "card" }, h("h2", {}, `${d.year + 1}년 법정의무교육 운영계획(안)`),
      h("p", { class: "small muted" }, "올해 교육별 이수율·이수 방식·직무별 차이·기한 지남, 만족도 의견을 분석해 운영 방향, 월별 일정, 소요 예산까지 담은 기안문 초안입니다."),
      h("div", { class: "row" }, h("button", { class: "btn primary", onclick: () => ex("nextplan", "hwpx") }, "한글(HWPX)"), h("button", { class: "btn", onclick: () => ex("nextplan", "docx") }, "워드"))),
    h("div", { class: "card" }, h("h2", {}, "교육훈련 실적 집계"),
      h("div", { class: "row", style: "gap:18px;margin-bottom:8px" }, h("div", {}, h("div", { class: "kpi-v" }, `${st.avg_hours}시간`), h("div", { class: "tiny muted" }, "1인당 교육시간")),
        h("div", {}, h("div", { class: "kpi-v" }, `${st.total_hours.toLocaleString()}시간`), h("div", { class: "tiny muted" }, "총 교육시간")),
        h("div", {}, h("div", { class: "kpi-v" }, `${st.spend.toLocaleString()}원`), h("div", { class: "tiny muted" }, `강사료(${st.sessions}회차)`))),
      h("table", {}, h("tr", {}, h("th", {}, "구분"), h("th", { class: "num" }, "인원"), h("th", { class: "num" }, "1인당 시간"), h("th", { class: "num" }, "법정 이수율")),
        st.groups.filter((g) => !g.group.endsWith("팀")).map((g) => h("tr", {}, h("td", {}, g.group), h("td", { class: "num" }, g.n), h("td", { class: "num" }, g.avg_hours), h("td", { class: "num" }, g.rate + "%")))),
      h("div", { class: "row", style: "margin-top:8px" }, h("button", { class: "btn", onclick: () => ex("stats", "") }, "실적 집계 엑셀(부서·직원별)")))));
  const sv = await api(`/api/projects/${pid}/survey`);
  add(el, h("h2", { style: "margin-top:6px" }, "집합교육 결과보고서(올린 서명부·만족도 기준)"),
    sv.length ? sv.map((s) => h("div", { class: "card" },
      h("div", { class: "row between" }, h("div", {}, h("b", {}, s.title), h("div", { class: "small muted" }, `${s.date ? kd(s.date, true) : ""} · ${fh(s.hours)}시간 · 참석 ${s.attended}/${s.n}명`)),
        h("div", { class: "row" }, h("button", { class: "btn sm primary", onclick: () => ex("result", "hwpx", "&sign=" + s.index) }, "결과보고 한글"), h("button", { class: "btn sm", onclick: () => ex("result", "docx", "&sign=" + s.index) }, "워드"))),
      s.survey ? h("div", { style: "margin-top:10px" },
        h("div", { class: "row small" }, h("span", { class: "badge b-brand" }, `만족도 ${s.survey.overall}점`), h("span", { class: "badge b-done" }, `만족 ${s.survey.satisfied}%`),
          h("span", { class: "badge b-part" }, `가장 낮은 문항: ${s.survey.lowest.item.replace(/\(.*\)/, "")} ${s.survey.lowest.avg}점`), h("span", { class: "muted" }, `응답 ${s.survey.n}명`)),
        h("div", { class: "chips", style: "margin-top:8px" }, s.survey.themes.map((t) => h("span", { class: "chip", title: t.examples.join(" / ") }, `${t.theme} ${t.count}건`))),
        s.improve.length ? h("ul", { class: "small", style: "margin:8px 0 0" }, s.improve.map((x) => h("li", {}, x))) : null)
        : h("div", { class: "small muted", style: "margin-top:6px" }, "연결된 만족도 응답이 없습니다."))) : h("div", { class: "card empty" }, "서명부가 없습니다."));
}

// ⑧ 연간 계획
function tabYear(el, d) {
  const rem = S.info.remind || { first_days: 30, boss_days: 14 };
  const ev = Array.from({ length: 12 }, () => []);
  const y = d.year;
  const push = (iso, cls, text) => { const dd = pd(iso); if (dd.getFullYear() === y) ev[dd.getMonth()].push({ iso, cls, text }); };
  const shift = (iso, n) => { const x = pd(iso); x.setDate(x.getDate() - n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
  const byDue = {};
  for (const s of d.summary) if (s.due && s.mandatory) (byDue[s.due] = byDue[s.due] || []).push(s);
  for (const [due, ss] of Object.entries(byDue)) {
    const left = ss.reduce((a, s) => a + s.partial + s.none, 0);
    push(due, "due", `기한: ${ss.map((s) => s.label).join(", ")}` + (left ? ` (남은 ${left}명·건)` : " (완료)"));
    push(shift(due, rem.first_days), "remind", `미이수자 본인 안내(기한 ${rem.first_days}일 전)`);
    push(shift(due, rem.boss_days), "remind", `부서장 통보(기한 ${rem.boss_days}일 전)`);
  }
  for (const p of d.people) {
    const c = d.cells[p.id].hire;
    if (c && c.s !== "na") push(c.due, c.s === "done" ? "" : "due", `채용 시 교육: ${p.name}(${p.dept}) ${ST[c.s]}`);
  }
  for (const s of d.signs) if (s.date) push(s.date, "", `집합교육 실시: ${s.title} (${s.attended}/${s.n}명)`);
  const now = pd(d.base);
  add(el, h("div", { class: "alert info" }, `${y}년 법정의무교육 흐름입니다. 기한·안내 시점은 교육 규칙표와 설정의 안내 기준으로 자동 계산합니다.`),
    h("div", { class: "months" }, ev.map((list, m) => h("div", { class: "month" + (m === now.getMonth() ? " now" : "") },
      h("h3", {}, `${m + 1}월`, m === now.getMonth() ? h("span", { class: "badge b-brand" }, "이번 달") : null),
      list.sort((a, b) => a.iso.localeCompare(b.iso)).map((e) => h("div", { class: `ev ${e.cls}${e.iso < d.base ? " past" : ""}` }, h("span", { class: "d" }, kd(e.iso)), e.text))))));
}

// ⑨ 질문하기
function tabAsk(el, d) {
  const pid = d.project.id;
  const chat = h("div", { class: "chat" });
  const input = h("input", { placeholder: "예) 김민수 뭐 남았어?", style: "flex:1" });
  const send = async (q) => {
    q = (q || input.value).trim();
    if (!q) return;
    input.value = "";
    chat.append(h("div", { class: "bubble q" }, q));
    const r = await api(`/api/projects/${pid}/ask`, { method: "POST", json: { q } });
    chat.append(h("div", { class: "bubble a" }, r.answer,
      r.sources.length ? h("div", { class: "chips", style: "margin-top:8px" }, r.sources.map((s) => h("span", { class: "chip", title: s.text }, `${s.file} · ${s.where}`))) : null));
    chat.scrollTop = chat.scrollHeight;
  };
  input.onkeydown = (e) => { if (e.key === "Enter") send(); };
  const ideas = ["급한 거 알려줘", "김민수 뭐 남았어?", "체육시설팀 미이수자", "청렴교육 미이수자 몇 명이야?", "기간제도 청렴교육 대상이야?", "야간 근무 다음날 교육 가능해?", "산업안전보건교육 몇 시간 들어야 해?"];
  add(el, h("div", { class: "card" }, chat,
    h("div", { class: "chips", style: "margin:12px 0" }, ideas.map((q) => h("span", { class: "chip src", onclick: () => send(q) }, q))),
    h("div", { class: "row" }, input, h("button", { class: "btn primary", onclick: () => send() }, "질문"))),
    h("p", { class: "small muted" }, "이수 판정 결과, 교육 규칙표, 넣은 기관 지침에서만 답합니다. 찾지 못하면 모른다고 답합니다."));
}

// ───────────── 설정
async function viewSettings() {
  const s = await api("/api/settings");
  const rules = await api("/api/rules");
  const org = { name: h("input", { value: s.org.name }), dept: h("input", { value: s.org.dept }), manager: h("input", { value: s.org.manager || "" }) };
  const sc = { ratio: h("input", { type: "number", step: "0.1", min: "0", max: "0.9", value: s.schedule.min_on_duty_ratio }),
    cap: h("input", { type: "number", min: "1", value: s.schedule.room_capacity }), max: h("input", { type: "number", min: "1", value: s.schedule.max_sessions }),
    hol: h("textarea", { value: (s.schedule.holidays || []).join(", ") }) };
  const prof = h("select", {}, Object.entries(s.profiles).map(([k, v]) => h("option", { value: k }, v.label)));
  prof.value = s.active_profile;
  const url = h("input", { style: "width:100%" }), model = h("input", { style: "width:100%" }), key = h("input", { type: "password", style: "width:100%", placeholder: "필요할 때만(이 PC에만 저장)" });
  const chk = h("div", { class: "small" });
  const fillProf = () => { const p = s.profiles[prof.value]; url.value = p.base_url || ""; model.value = p.model || ""; key.value = ""; key.placeholder = p.has_key ? "저장된 키 있음(바꿀 때만 입력)" : "필요할 때만(이 PC에만 저장)"; url.disabled = model.disabled = key.disabled = p.kind !== "openai"; chk.textContent = ""; };
  prof.onchange = fillProf; fillProf();
  const st0 = s;
  const tierRows = (s.fees.tiers || []).map((t) => ({ grade: h("input", { value: t.grade, style: "width:70px" }), desc: h("input", { value: t.desc || "", style: "width:220px" }),
    first: h("input", { type: "number", value: t.first, style: "width:100px" }), extra: h("input", { type: "number", value: t.extra, style: "width:100px" }) }));
  const manu = h("input", { type: "number", value: s.fees.manuscript_per_page || 0 });
  const sgv = s.org.signers || {};
  const sg = { drafter: h("input", { value: sgv.drafter || "" }), reviewer: h("input", { value: sgv.reviewer || "" }), approver: h("input", { value: sgv.approver || "" }) };
  const save = async () => {
    const body = { org: { name: org.name.value, dept: org.dept.value, manager: org.manager.value,
        signers: { drafter: sg.drafter.value, reviewer: sg.reviewer.value, approver: sg.approver.value } },
      fees: { tiers: tierRows.map((r) => ({ grade: r.grade.value, desc: r.desc.value, first: r.first.value, extra: r.extra.value })), manuscript_per_page: manu.value },
      schedule: { min_on_duty_ratio: sc.ratio.value, room_capacity: sc.cap.value, max_sessions: sc.max.value, holidays: sc.hol.value.split(/[\s,]+/).filter(Boolean) },
      active_profile: prof.value };
    if (s.profiles[prof.value].kind === "openai") body.profile = { name: prof.value, base_url: url.value, model: model.value, ...(key.value ? { api_key: key.value } : {}) };
    await api("/api/settings", { method: "POST", json: body }); await loadInfo(); toast("저장했습니다");
  };
  const TGT = [["all", "전 직원"], ["flag:개인정보취급자", "개인정보취급자"], ["flag:관리감독자", "관리감독자"], ["ex:관리감독자", "전 직원(관리감독자 제외)"], ["hire", "올해 입사자"]];
  const tgtKey = (t) => !t || !Object.keys(t).length ? "all" : t.flag ? "flag:" + t.flag : t.exclude_flag ? "ex:" + t.exclude_flag : t.hired_this_year ? "hire" : "all";
  const tgtVal = (k) => k === "all" ? {} : k === "hire" ? { hired_this_year: true } : k.startsWith("flag:") ? { flag: k.slice(5) } : { exclude_flag: k.slice(3) };
  const rows = rules.courses.map((c) => {
    const r = {
      c, mand: h("input", { type: "checkbox", checked: c.mandatory !== false }), name: h("input", { value: c.name, style: "width:150px" }),
      law: h("input", { value: c.law || "", style: "width:220px" }),
      cycle: h("select", {}, h("option", { value: "year" }, "연 1회"), h("option", { value: "half" }, "반기"), h("option", { value: "hire" }, "채용 시")),
      hours: h("input", { value: typeof c.hours === "object" ? Object.entries(c.hours).map(([k, v]) => `${k}:${v}`).join(", ") : c.hours, style: "width:110px" }),
      due: h("input", { value: c.due || "", style: "width:62px", placeholder: "12-31" }),
      tgt: h("select", {}, TGT.map(([k, l]) => h("option", { value: k }, l))), kw: h("input", { value: (c.keywords || []).join(", "), style: "width:200px" }),
    };
    r.cycle.value = c.cycle || "year"; r.tgt.value = tgtKey(c.target);
    return r;
  });
  const saveRules = async () => {
    const courses = rows.map((r) => {
      const hv = r.hours.value.includes(":") ? Object.fromEntries(r.hours.value.split(",").map((x) => x.split(":").map((y) => y.trim())).map(([k, v]) => [k, Number(v)])) : Number(r.hours.value);
      return { ...r.c, name: r.name.value, law: r.law.value, cycle: r.cycle.value, hours: hv, due: r.cycle.value === "year" ? (r.due.value || "12-31") : undefined,
        target: tgtVal(r.tgt.value), mandatory: r.mand.checked, keywords: r.kw.value.split(",").map((x) => x.trim()).filter(Boolean) };
    });
    await api("/api/rules", { method: "PUT", json: { ...rules, courses } }); toast("교육 규칙표를 저장했습니다(모든 작업에 바로 반영)");
  };
  mount(h("div", { class: "ph" }, h("h1", {}, "설정"), h("a", { class: "btn", href: "#/" }, "처음 화면")),
    h("div", { class: "grid g2", style: "margin-top:14px" },
      h("div", { class: "card" }, h("h2", {}, "기관 정보"),
        h("div", { class: "field" }, h("label", { class: "f" }, "기관명"), org.name), h("div", { class: "field" }, h("label", { class: "f" }, "담당 부서"), org.dept),
        h("div", { class: "field" }, h("label", { class: "f" }, "담당자 표시(안내문 문의처)"), org.manager),
        h("h2", { style: "margin-top:16px" }, "일정 짜기 규칙"),
        h("div", { class: "field" }, h("label", { class: "f" }, "교육 중 팀별 현장에 남길 근무자 비율(0.5 = 절반)"), sc.ratio),
        h("div", { class: "grid g2" }, h("div", { class: "field" }, h("label", { class: "f" }, "교육장 정원"), sc.cap), h("div", { class: "field" }, h("label", { class: "f" }, "최대 회차 수"), sc.max)),
        h("div", { class: "field" }, h("label", { class: "f" }, "공휴일(YYYY-MM-DD, 쉼표로 구분)"), sc.hol)),
      h("div", { class: "card" }, h("h2", {}, "AI 모델(선택)"),
        h("p", { class: "small muted" }, "판정·일정·보고서는 모델 없이 동작합니다. 모델은 질문하기의 답변 문장에만 씁니다. OpenAI 호환 API(Ollama·vLLM·HyperCLOVA X 등)를 연결할 수 있습니다."),
        h("div", { class: "field" }, h("label", { class: "f" }, "사용할 모델"), prof),
        h("div", { class: "field" }, h("label", { class: "f" }, "서버 주소"), url), h("div", { class: "field" }, h("label", { class: "f" }, "모델 이름"), model),
        h("div", { class: "field" }, h("label", { class: "f" }, "API 키"), key),
        h("div", { class: "row" }, h("button", { class: "btn", onclick: async () => { await save(); chk.textContent = "확인 중…"; const r = await api(`/api/llm/check?profile=${encodeURIComponent(prof.value)}`); chk.textContent = (r.ok ? "연결 성공: " : "연결 실패: ") + r.detail; } }, "저장 후 연결 확인"), chk))),
    h("div", { class: "grid g2" },
      h("div", { class: "card" }, h("h2", {}, "강사료 기준"), h("p", { class: "small muted" }, st0.fees._안내 || ""),
        h("table", { class: "rules-table" }, h("tr", {}, h("th", {}, "등급"), h("th", {}, "설명"), h("th", {}, "첫 1시간"), h("th", {}, "추가 1시간")),
          tierRows.map((r) => h("tr", {}, h("td", {}, r.grade), h("td", {}, r.desc), h("td", {}, r.first), h("td", {}, r.extra)))),
        h("div", { class: "field", style: "margin-top:8px" }, h("label", { class: "f" }, "원고료(1매당)"), manu)),
      h("div", { class: "card" }, h("h2", {}, "결재선(공문 하단)"),
        h("div", { class: "field" }, h("label", { class: "f" }, "기안자"), sg.drafter), h("div", { class: "field" }, h("label", { class: "f" }, "검토자"), sg.reviewer),
        h("div", { class: "field" }, h("label", { class: "f" }, "결재권자"), sg.approver))),
    lawCard(s),
    h("div", { class: "row", style: "margin-bottom:16px" }, h("button", { class: "btn primary", onclick: save }, "기관·일정·모델·강사료 설정 저장")),
    h("div", { class: "card" }, h("div", { class: "row between" }, h("h2", { style: "margin:0" }, "교육 규칙표"),
      h("div", { class: "row" }, h("button", { class: "btn", onclick: async () => { if (!confirm("기본 규칙표로 되돌릴까요?")) return; await api("/api/rules/reset", { method: "POST" }); viewSettings(); toast("기본값으로 되돌렸습니다"); } }, "기본값으로"),
        h("button", { class: "btn primary", onclick: saveRules }, "규칙표 저장"))),
      h("p", { class: "small muted" }, rules._안내 || ""),
      h("div", { style: "overflow:auto" }, h("table", { class: "rules-table" },
        h("tr", {}, h("th", {}, "법정"), h("th", {}, "교육"), h("th", {}, "근거"), h("th", {}, "주기"), h("th", {}, "시간(직무별은 사무:6, 현장:12)"), h("th", {}, "기한"), h("th", {}, "대상"), h("th", {}, "과정명 키워드")),
        rows.map((r) => h("tr", {}, h("td", {}, r.mand), h("td", {}, r.name), h("td", {}, r.law), h("td", {}, r.cycle), h("td", {}, r.hours), h("td", {}, r.due), h("td", {}, r.tgt), h("td", {}, r.kw)))))));
}

// ───────────── 할 일
function taskCard(d, tasks) {
  const pid = d.project.id;
  const open = tasks.filter((t) => !t.done);
  const urgent = open.filter((t) => t.dday != null && t.dday <= 14);
  let showAll = false;
  const box = h("div", { class: "card" });
  const draw = () => {
    const list = showAll ? tasks : (urgent.length ? urgent : open.slice(0, 5));
    box.replaceChildren(
      h("div", { class: "row between" }, h("h2", { style: "margin:0" }, "할 일", h("span", { class: "small muted", style: "margin-left:8px;font-weight:400" }, `2주 안 ${urgent.length}건 · 전체 남은 일 ${open.length}건`)),
        h("button", { class: "btn sm ghost", onclick: () => { showAll = !showAll; draw(); } }, showAll ? "가까운 일만" : "전체 보기")),
      h("table", { style: "margin-top:8px" }, list.map((t) => h("tr", { class: t.done ? "muted" : "" },
        h("td", { style: "width:34px" }, h("input", { type: "checkbox", checked: t.done, disabled: t.auto, title: t.auto ? "문서를 만들거나 출석을 받으면 자동으로 완료됩니다" : "완료 표시",
          onchange: async () => { await api(`/api/projects/${pid}/tasks/${encodeURIComponent(t.key)}`, { method: "POST" }); t.done = !t.done; draw(); } })),
        h("td", { style: "width:150px", class: "small" }, t.date ? kd(t.date) : "", t.dday != null && !t.done ? h("div", {}, h("span", { class: "badge " + (t.dday < 0 ? "b-none" : t.dday <= 7 ? "b-part" : "") }, t.dday < 0 ? `${-t.dday}일 지남` : t.dday === 0 ? "오늘" : `D-${t.dday}`)) : null),
        h("td", {}, t.done ? h("s", {}, t.title) : h("b", {}, t.title), t.detail ? h("div", { class: "tiny muted" }, t.detail) : null),
        h("td", { class: "num" }, t.link && !t.done ? h("a", { class: "btn sm", href: `#/p/${pid}/${t.link}` }, "바로 가기") : null)))));
  };
  draw();
  return box;
}

// ───────────── 교육 운영(회차 목록)
async function tabRun(el, d) {
  const pid = d.project.id;
  const list = await api(`/api/projects/${pid}/sessions`);
  const colSel = h("select", {}, d.columns.filter((c) => c.mandatory).map((c) => h("option", { value: c.key }, c.label)));
  const dateIn = h("input", { type: "date", value: d.base });
  add(el, h("div", { class: "alert info" }, "집합교육 한 회차의 일을 여기서 끝냅니다: 실시계획 기안 → 출석 키오스크(전자 서명) → 퇴실 만족도 → 결과보고 → 강사료 지급. 출석은 바로 이수 현황에 반영됩니다."),
    h("div", { class: "card row" }, h("b", {}, "회차 직접 추가"), colSel, dateIn,
      h("button", { class: "btn", onclick: async () => { const r = await api(`/api/projects/${pid}/sessions`, { method: "POST", json: { manual: true, col: colSel.value, date: dateIn.value } }); location.hash = `#/p/${pid}/session/${r.ids[0]}`; } }, "추가"),
      h("span", { class: "small muted right" }, "또는 ‘일정 짜기’에서 ‘이 일정으로 회차 만들기’")));
  if (!list.length) return add(el, h("div", { class: "card empty" }, "아직 회차가 없습니다. ‘일정 짜기’에서 회차를 만들어 보세요."));
  add(el, h("div", { class: "card", style: "padding:0" }, h("table", {},
    h("tr", {}, h("th", {}, "일시"), h("th", {}, "교육"), h("th", {}, "장소·강사"), h("th", { class: "num" }, "출석"), h("th", { class: "num" }, "만족도"), h("th", {})),
    list.map((s) => h("tr", { class: "click", onclick: () => (location.hash = `#/p/${pid}/session/${s.id}`) },
      h("td", { class: "small" }, kd(s.date), h("div", { class: "tiny muted" }, `${s.start}~${s.end} · ${fh(s.hours)}시간`)),
      h("td", {}, h("b", {}, s.title)),
      h("td", { class: "small" }, s.place || h("span", { class: "muted" }, "장소 미정"), h("div", { class: "tiny muted" }, s.instructor.name ? `${s.instructor.name}(${s.instructor.org})` : "강사 미정")),
      h("td", { class: "num" }, s.attended ? h("span", { class: "badge b-done" }, `${s.attended}/${s.n_targets}`) : `0/${s.n_targets}`),
      h("td", { class: "num" }, s.survey ? `${s.survey.overall}점(${s.survey.n})` : "-"),
      h("td", { class: "num" }, h("button", { class: "btn sm primary", onclick: (e) => { e.stopPropagation(); window.open(`#/kiosk/${pid}/${s.id}`, "_blank"); } }, "출석 키오스크")))))));
}

// ───────────── 회차 상세
async function tabSession(el, d, sid) {
  const pid = d.project.id;
  const s = await api(`/api/projects/${pid}/sessions/${sid}`);
  const f = {};
  const inp = (k, v, attrs = {}) => (f[k] = h("input", { value: v ?? "", ...attrs }));
  const I = s.instructor;
  const grade = h("select", {}, h("option", { value: "" }, "등급 선택"), (s.tiers || []).map((t) => h("option", { value: t.grade }, `${t.grade} – ${t.desc} (첫 1시간 ${t.first.toLocaleString()}원, 추가 ${t.extra.toLocaleString()}원)`)));
  grade.value = I.grade || "";
  const income = h("select", {}, ["기타소득", "사업소득", "근로"].map((x) => h("option", { value: x }, x === "근로" ? "내부 직원(근로소득 합산)" : x)));
  income.value = I.income || "기타소득";
  const save = async () => {
    await api(`/api/projects/${pid}/sessions/${sid}`, { method: "PATCH", json: {
      title: f.title.value, date: f.date.value, start: f.start.value, end: f.end.value, hours: f.hours.value, place: f.place.value,
      instructor: { name: f.iname.value, org: f.iorg.value, grade: grade.value, income: income.value, pages: f.pages.value, travel: f.travel.value } } });
    toast("저장했습니다"); route();
  };
  const ex = (doc, fmt) => dl(`/api/projects/${pid}/export?doc=${doc}&fmt=${fmt}&session=${sid}`);
  const fee = s.fee;
  const attendRow = (t) => h("tr", {},
    h("td", {}, t.name, t.walkin ? h("span", { class: "badge", style: "margin-left:6px" }, "대상 외") : null), h("td", { class: "small" }, t.dept), h("td", { class: "small" }, t.team || "일근"),
    h("td", {}, t.at ? h("span", { class: "badge b-done" }, `출석 ${t.at.slice(11, 16)}`) : h("span", { class: "badge" }, "미출석")),
    h("td", { class: "num" }, t.at ? h("button", { class: "btn sm ghost", onclick: async () => { if (!confirm(`${t.name}님 출석을 취소할까요?`)) return; await api(`/api/projects/${pid}/sessions/${sid}/attend/${t.id}`, { method: "DELETE" }); route(); } }, "취소")
      : h("button", { class: "btn sm", onclick: async () => { await api(`/api/projects/${pid}/sessions/${sid}/attend`, { method: "POST", json: { person: t.id, manual: true } }); toast(`${t.name}님 수기 출석`); route(); } }, "수기 출석")));
  add(el,
    h("div", { class: "row between", style: "margin-bottom:12px" }, h("a", { href: `#/p/${pid}/run` }, "← 회차 목록"),
      h("div", { class: "row" }, h("button", { class: "btn primary", onclick: () => window.open(`#/kiosk/${pid}/${sid}`, "_blank") }, "출석 키오스크 열기"),
        h("button", { class: "btn ghost", onclick: async () => { if (!confirm("이 회차를 지울까요? 출석 기록도 함께 지워집니다.")) return; await api(`/api/projects/${pid}/sessions/${sid}`, { method: "DELETE" }); location.hash = `#/p/${pid}/run`; } }, "회차 삭제"))),
    h("div", { class: "grid g2" },
      h("div", { class: "card" }, h("h2", {}, "교육 정보"),
        h("div", { class: "field" }, h("label", { class: "f" }, "교육명"), inp("title", s.title)),
        h("div", { class: "grid g3" }, h("div", { class: "field" }, h("label", { class: "f" }, "날짜"), inp("date", s.date, { type: "date" })),
          h("div", { class: "field" }, h("label", { class: "f" }, "시작"), inp("start", s.start, { placeholder: "09:00" })), h("div", { class: "field" }, h("label", { class: "f" }, "끝"), inp("end", s.end, { placeholder: "13:00" }))),
        h("div", { class: "grid g2" }, h("div", { class: "field" }, h("label", { class: "f" }, "인정 시간"), inp("hours", s.hours, { type: "number", step: "0.5", min: "0.5" })),
          h("div", { class: "field" }, h("label", { class: "f" }, "장소"), inp("place", s.place))),
        h("h2", { style: "margin-top:8px" }, "강사"),
        h("div", { class: "grid g2" }, h("div", { class: "field" }, h("label", { class: "f" }, "이름"), inp("iname", I.name)), h("div", { class: "field" }, h("label", { class: "f" }, "소속"), inp("iorg", I.org))),
        h("div", { class: "field" }, h("label", { class: "f" }, "강사료 등급(넣은 강사수당 기준 문서, 없으면 설정)"), grade),
        h("div", { class: "grid g3" }, h("div", { class: "field" }, h("label", { class: "f" }, "소득 구분"), income),
          h("div", { class: "field" }, h("label", { class: "f" }, "원고 매수"), inp("pages", I.pages, { type: "number", min: "0" })),
          h("div", { class: "field" }, h("label", { class: "f" }, "교통비(실비)"), inp("travel", I.travel, { type: "number", min: "0" }))),
        h("button", { class: "btn primary", onclick: save }, "저장")),
      h("div", {},
        h("div", { class: "card" }, h("h2", {}, "공문·서류"),
          [["session_plan", "실시계획 기안", "교육 전"], ["signsheet", "서명부", "교육 후"], ["session_result", "결과보고 기안", "교육 후"], ["session_fee", "강사료 지급 기안", "교육 후"]].map(([doc, label, when]) =>
            h("div", { class: "row between", style: "padding:6px 0;border-bottom:1px solid var(--line)" }, h("div", {}, h("b", {}, label), h("span", { class: "tiny muted", style: "margin-left:6px" }, when)),
              h("div", { class: "row" }, h("button", { class: "btn sm primary", disabled: doc === "session_fee" && !I.name, onclick: () => ex(doc, doc === "signsheet" ? "docx" : "hwpx") }, doc === "signsheet" ? "워드(서명 이미지)" : "한글"),
                h("button", { class: "btn sm", disabled: doc === "session_fee" && !I.name, onclick: () => ex(doc, doc === "signsheet" ? "hwpx" : "docx") }, doc === "signsheet" ? "한글" : "워드"))))),
        h("div", { class: "card" }, h("h2", {}, "강사료"),
          fee ? [h("div", { class: "row", style: "gap:18px" }, h("div", {}, h("div", { class: "kpi-v" }, `${fee.total.toLocaleString()}원`), h("div", { class: "tiny muted" }, "지급 총액(세전)")),
            h("div", {}, h("div", { class: "kpi-v" }, `${fee.withholding.toLocaleString()}원`), h("div", { class: "tiny muted" }, `원천징수(${fee.income})`)),
            h("div", {}, h("div", { class: "kpi-v" }, `${fee.net.toLocaleString()}원`), h("div", { class: "tiny muted" }, "실지급액"))),
            h("ul", { class: "small", style: "margin:8px 0 0" }, fee.steps.map((x) => h("li", {}, x)))] : h("p", { class: "muted small" }, "강사 이름과 등급을 넣으면 계산합니다."),
          h("p", { class: "tiny muted", style: "margin:8px 0 0" }, "세금 계산은 기본값(기타소득 필요경비 60%·세율 20%·과세최저한 5만원, 사업소득 3%)이며 기관 회계 기준으로 확인하세요.")),
        s.survey ? h("div", { class: "card" }, h("h2", {}, `퇴실 만족도 ${s.survey.n}명`),
          h("div", { class: "row small" }, h("span", { class: "badge b-brand" }, `평균 ${s.survey.overall}점`), h("span", { class: "badge b-done" }, `만족 ${s.survey.satisfied}%`)),
          h("table", { style: "margin-top:6px" }, Object.entries(s.survey.avg).map(([k, v]) => h("tr", {}, h("td", { class: "small" }, k), h("td", { class: "num" }, v + "점"))))) : null)),
    h("div", { class: "card", style: "padding:0" },
      h("div", { class: "row between", style: "padding:14px 16px 6px" }, h("h2", { style: "margin:0" }, `출석 ${s.attended} / 대상 ${s.n_targets}명`),
        h("span", { class: "small muted" }, "키오스크에서 서명하면 여기와 이수 현황에 바로 반영됩니다")),
      h("table", {}, h("tr", {}, h("th", {}, "성명"), h("th", {}, "소속"), h("th", {}, "근무조"), h("th", {}, "출석"), h("th", {})), s.targets.map(attendRow))));
}

// ───────────── 출석 키오스크(교육장 입구 노트북·태블릿)
async function viewKiosk(pid, sid) {
  let s = await api(`/api/projects/${pid}/sessions/${sid}`);
  const app = $("#app");
  let mode = "in";
  const refresh = async () => { s = await api(`/api/projects/${pid}/sessions/${sid}`); };
  const header = () => h("div", { class: "k-head" },
    h("div", {}, h("div", { class: "k-title" }, s.title), h("div", { class: "k-sub" }, `${kd(s.date, true)} ${s.start}~${s.end} · ${s.place || ""}`)),
    h("div", { class: "k-count" }, h("b", {}, s.attended), ` / ${s.n_targets}명 출석`),
    h("div", { class: "k-modes" }, h("button", { class: "k-mode" + (mode === "in" ? " on" : ""), onclick: () => { mode = "in"; home(); } }, "입실 서명"),
      h("button", { class: "k-mode" + (mode === "out" ? " on" : ""), onclick: () => { mode = "out"; home(); } }, "퇴실 만족도")));
  const screen = (...kids) => { app.replaceChildren(); add(app, h("div", { class: "kiosk" }, header(), h("div", { class: "k-body" }, kids),
    h("a", { class: "k-exit", href: `#/p/${pid}/session/${sid}` }, "관리 화면으로"))); };
  const attendedIds = () => new Set(s.targets.filter((t) => t.at).map((t) => t.id));
  function home() {
    if (mode === "out") return survey();
    const q = h("input", { class: "k-input", placeholder: "이름을 입력하세요 (예: 김민수)", autocomplete: "off" });
    const list = h("div", { class: "k-list" });
    const draw = () => {
      const v = q.value.replace(/\s/g, "");
      list.replaceChildren();
      if (!v) return list.append(h("div", { class: "k-hint" }, "이름 두 글자 이상을 입력하면 아래에 나타납니다"));
      const done = attendedIds();
      const tgt = new Set(s.targets.map((t) => t.id));
      const found = s.everyone.filter((p) => p.name.includes(v) || p.id.endsWith(v)).sort((a, b) => (tgt.has(b.id) - tgt.has(a.id))).slice(0, 8);
      if (!found.length) return list.append(h("div", { class: "k-hint" }, "명단에서 찾을 수 없습니다. 담당자에게 알려 주세요."));
      found.forEach((p) => list.append(h("button", { class: "k-person" + (done.has(p.id) ? " done" : ""), disabled: done.has(p.id), onclick: () => sign(p) },
        h("b", {}, p.name), h("span", {}, `${p.dept}${p.team ? " · " + p.team + "조" : ""}`), done.has(p.id) ? h("em", {}, "출석 완료") : (tgt.has(p.id) ? null : h("em", {}, "대상 외")))));
    };
    q.oninput = draw;
    screen(h("div", { class: "k-big" }, "출석 확인"), q, list);
    draw(); q.focus();
  }
  function sign(p) {
    const cv = h("canvas", { class: "k-canvas", width: "600", height: "240" });
    const ctx = cv.getContext("2d");
    ctx.lineWidth = 3.2; ctx.lineCap = "round"; ctx.strokeStyle = "#111";
    let drawing = false, strokes = 0;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
    cv.onpointerdown = (e) => { drawing = true; cv.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); };
    cv.onpointermove = (e) => { if (!drawing) return; ctx.lineTo(...pos(e)); ctx.stroke(); strokes++; };
    cv.onpointerup = () => { drawing = false; };
    const ok = h("button", { class: "k-btn primary", onclick: async () => {
      if (strokes < 5) return toast("서명을 해 주세요");
      ok.disabled = true;
      const r = await api(`/api/projects/${pid}/sessions/${sid}/attend`, { method: "POST", json: { person: p.id, sign: cv.toDataURL("image/png") } }).catch(() => null);
      if (!r) { ok.disabled = false; return; }
      await refresh();
      screen(h("div", { class: "k-done" }, h("div", { class: "k-check" }, "✓"), h("div", { class: "k-big" }, `${p.name}님, 출석이 확인되었습니다`),
        h("div", { class: "k-sub" }, r.already ? "이미 출석한 기록이 있습니다" : `${fh(s.hours)}시간 이수로 기록됩니다`)));
      setTimeout(home, 2200);
    } }, "서명 완료");
    screen(h("div", { class: "k-big" }, `${p.name}님, 아래 칸에 서명해 주세요`), h("div", { class: "k-sub" }, `${p.dept}${p.team ? " · " + p.team + "조" : ""}`), cv,
      h("div", { class: "k-actions" }, h("button", { class: "k-btn", onclick: home }, "이전"), h("button", { class: "k-btn", onclick: () => { ctx.clearRect(0, 0, cv.width, cv.height); strokes = 0; } }, "다시 쓰기"), ok));
  }
  function survey() {
    const ans = {};
    const rows = s.survey_items.map((item) => {
      const btns = [1, 2, 3, 4, 5].map((n) => h("button", { class: "k-score", onclick: () => { ans[item] = n; btns.forEach((b, i) => b.classList.toggle("on", i + 1 === n)); } }, n));
      return h("div", { class: "k-q" }, h("div", { class: "k-qt" }, item.replace(/\(.*\)/, "")), h("div", { class: "k-scores" }, btns));
    });
    const cm = h("textarea", { class: "k-comment", placeholder: "하고 싶은 말(선택)" });
    screen(h("div", { class: "k-big" }, "교육은 어떠셨나요? (1점 매우 불만 ~ 5점 매우 만족)"), rows, cm,
      h("div", { class: "k-actions" }, h("button", { class: "k-btn primary", onclick: async () => {
        if (Object.keys(ans).length < s.survey_items.length) return toast("모든 문항에 답해 주세요");
        await api(`/api/projects/${pid}/sessions/${sid}/survey`, { method: "POST", json: { scores: ans, comment: cm.value } });
        screen(h("div", { class: "k-done" }, h("div", { class: "k-check" }, "✓"), h("div", { class: "k-big" }, "응답해 주셔서 고맙습니다")));
        setTimeout(survey, 1800);
      } }, "제출")));
  }
  home();
}


// ───────────── 국가법령정보 연동
function lawText(a) {
  return h("div", { class: "law" },
    h("div", { class: "row between" }, h("b", {}, `${a.law} 제${a.jo}조${a.branch && a.branch !== "0" ? "의" + a.branch : ""} ${a.title || ""}`),
      h("a", { href: a.url, target: "_blank", rel: "noopener", class: "small" }, "국가법령정보센터")),
    h("div", { class: "tiny muted" }, `시행 ${a.effective || "-"} · 받은 때 ${(a.fetched || "").replace("T", " ")}`),
    h("div", { class: "law-text" }, a.text));
}
function lawBox(rule) {
  const box = h("div", { style: "margin-top:10px" }, h("div", { class: "tiny muted" }, "법령 원문 불러오는 중…"));
  const load = async (cacheOnly) => {
    const r = await api(`/api/law/rule/${rule}?cache_only=${cacheOnly}`).catch(() => null);
    if (!r) return box.replaceChildren();
    const ok = r.items.filter((x) => x.ok);
    box.replaceChildren(
      ok.map(lawText),
      r.items.filter((x) => !x.ok).length ? h("div", { class: "row small", style: "margin-top:6px" },
        r.has_oc ? h("button", { class: "btn sm", onclick: () => { box.replaceChildren(h("div", { class: "tiny muted" }, "국가법령정보센터에서 받는 중…")); load(false); } }, "국가법령정보에서 조문 원문 받기")
          : h("span", { class: "muted" }, "설정 → 국가법령정보 연동에서 인증키를 넣으면 조문 원문을 볼 수 있습니다."),
        !cacheOnly ? r.items.filter((x) => !x.ok).map((x) => h("div", { class: "tiny", style: "color:var(--none)" }, x.error)) : null,
        r.items.filter((x) => !x.ok).map((x) => h("a", { href: x.url, target: "_blank", rel: "noopener", class: "tiny" }, `${x.law} 제${x.jo}조 바로 열기`))) : null);
  };
  load(true);
  return box;
}
function lawCard(s) {
  const ocIn = h("input", { type: "password", placeholder: s.law.has_oc ? "저장된 인증키 있음(바꿀 때만 입력)" : "인증키(OC) – 신청 승인 메일의 OC 값", style: "width:100%" });
  const msg = h("div", { class: "small" });
  const out = h("div");
  const showStatus = (st) => {
    if (!st || !st.items) return out.replaceChildren(h("p", { class: "small muted" }, "아직 확인한 적이 없습니다."));
    const pend = new Set(st.pending || []);
    out.replaceChildren(
      h("div", { class: "row between", style: "margin:8px 0" }, h("span", { class: "small muted" }, `마지막 확인 ${String(st.checked || "").replace("T", " ")}`),
        pend.size ? h("button", { class: "btn sm", onclick: async () => { showStatus(await api("/api/law/ack", { method: "POST", json: {} })); toast("개정 확인을 완료로 표시했습니다"); } }, "개정 내용 확인 완료") : null),
      h("table", {}, h("tr", {}, h("th", {}, "교육"), h("th", {}, "근거 조문"), h("th", {}, "시행일"), h("th", {})),
        st.items.map((i) => h("tr", {}, h("td", { class: "small" }, i.course),
          h("td", { class: "small" }, h("a", { href: i.url, target: "_blank", rel: "noopener" }, i.ref), i.title ? h("div", { class: "tiny muted" }, i.title) : null,
            i.ok ? null : h("div", { class: "tiny", style: "color:var(--none)" }, i.error)),
          h("td", { class: "small" }, i.effective || "-"),
          h("td", {}, !i.ok ? h("span", { class: "badge b-none" }, "실패") : pend.has(i.ref) ? h("span", { class: "badge b-part", title: `이전 시행일 ${i.before || ""}` }, "개정됨 – 확인 필요") : h("span", { class: "badge b-done" }, "확인"))))));
  };
  api("/api/law/status").then(showStatus).catch(() => {});
  return h("div", { class: "card" }, h("h2", {}, "국가법령정보 연동"),
    h("p", { class: "small muted" }, "국가법령정보 공동활용(open.law.go.kr)에서 받은 인증키(OC)를 넣으면 교육 규칙표의 근거 조문 원문과 시행일자를 확인하고, 법령이 개정되면 ‘할 일’에 알립니다. 인증키는 이 PC에만 저장됩니다. 신청 때 등록한 IP·도메인의 PC에서만 응답이 옵니다."),
    h("div", { class: "row" }, h("div", { class: "grow" }, ocIn),
      h("button", { class: "btn", onclick: async () => {
        if (ocIn.value) { await api("/api/settings", { method: "POST", json: { law: { oc: ocIn.value } } }); ocIn.value = ""; ocIn.placeholder = "저장된 인증키 있음(바꿀 때만 입력)"; }
        msg.textContent = "연결 확인 중…";
        try { msg.textContent = (await api("/api/law/check")).detail; } catch (e) { msg.textContent = "연결 실패: " + e.message; }
      } }, "저장 후 연결 확인"),
      h("button", { class: "btn primary", onclick: async (e) => {
        e.target.disabled = true; msg.textContent = "근거 조문을 확인하는 중…(법령 수에 따라 수십 초)";
        try { const st = await api("/api/law/rules-check", { method: "POST" }); showStatus(st); msg.textContent = `확인 완료: ${st.items.filter((i) => i.ok).length}/${st.items.length}건` + (st.pending.length ? `, 개정 ${st.pending.length}건` : ""); }
        catch (err) { msg.textContent = "확인 실패: " + err.message; }
        e.target.disabled = false;
      } }, "근거 법령 최신 확인")), msg, out);
}

// ───────────── 규정·기준(규정 문서에서 읽은 계산 기준)
async function tabRegs(el, d) {
  const r = await api(`/api/projects/${d.project.id}/regs`);
  const groups = {};
  r.items.forEach((it) => (groups[it.group] = groups[it.group] || []).push(it));
  const showSrc = (it) => it.src && openDrawer("규정 원문", h("div", { class: "small muted" }, `${it.src.file} · ${it.src.where}`), h("div", { class: "law-text" }, it.src.text));
  add(el,
    h("div", { class: "alert info" }, "넣은 규정·편람·계획 문서에서 다이수가 읽어 낸 계산 기준입니다. 모든 계산과 보고서는 이 기준을 따르며, 값마다 원문 근거가 붙습니다."),
    r.warnings.map((w) => h("div", { class: "alert warn" }, w)),
    h("div", { class: "card", style: "padding:0" }, h("table", {}, h("tr", {}, h("th", {}, "읽은 문서"), h("th", {}, "종류")),
      r.docs.length ? r.docs.map((x) => h("tr", {}, h("td", { class: "small" }, x.file), h("td", {}, h("span", { class: "badge b-brand" }, x.label))))
        : h("tr", {}, h("td", { colspan: "2", class: "muted" }, "규정 문서가 없습니다. 교육훈련규정·여비규정·강사수당 기준·경영평가 편람을 함께 넣어 보세요.")))),
    Object.entries(groups).map(([g, items]) => h("div", { class: "card" }, h("h2", {}, g),
      h("table", {}, items.map((it) => h("tr", {}, h("td", { style: "width:26%" }, h("b", {}, it.label)), h("td", { style: "width:32%" }, it.value),
        h("td", {}, it.src ? h("span", { class: "chip src", title: it.src.text, onclick: () => showSrc(it) }, `${it.src.file.split("/").pop()} · ${it.src.where}`) : null)))))),
    h("p", { class: "small muted" }, "값이 실제 규정과 다르면 원문을 고쳐 다시 넣거나 설정에서 덮어쓰세요. 보고서 탭의 ‘규정 해석 기준표’로 결재 붙임을 만들 수 있습니다."));
}

// ───────────── 교육 실적(모든 교육: 법정·필수·직무·외부)
async function tabResults(el, d) {
  const pid = d.project.id;
  const o = await api(`/api/projects/${pid}/overview`);
  const CAT = { "법정": "법정의무", "필수": "필수(내규)", "직무": "직무·역량", "외부": "외부(위탁)" };
  const kpiCards = o.kpis.map((k) => h("div", { class: "card kpi" + (k.value == null ? " warn" : "") },
    h("div", { class: "v" }, k.value == null ? "자료 필요" : `${typeof k.value === "number" ? k.value.toLocaleString() : k.value}${k.unit}`),
    h("div", { class: "l" }, k.name, k.weight ? ` (배점 ${k.weight})` : ""), h("div", { class: "tiny muted", title: k.basis }, k.formula)));
  const max = Math.max(o.target_hours || 0, o.gov_hours || 0, o.per_capita) || 1;
  const bar = (v, cls, label) => h("div", { class: "row", style: "gap:8px;margin:6px 0;flex-wrap:nowrap" }, h("span", { class: "small", style: "width:110px" }, label),
    h("div", { class: "bar grow" }, h("i", { class: cls, style: `width:${100 * v / max}%` })), h("b", { class: "small", style: "width:70px;text-align:right" }, `${v}시간`));
  let filter = "", sortKey = "total";
  const tbl = h("div");
  const draw = () => {
    const rows = o.per_person.filter((p) => !filter || (filter === "below" ? o.target_hours && p.total < o.target_hours : p.dept === filter))
      .sort((a, b) => b[sortKey] - a[sortKey]);
    tbl.replaceChildren(h("div", { class: "matrix-wrap", style: "max-height:420px" }, h("table", {},
      h("tr", {}, h("th", {}, "성명"), h("th", {}, "소속·직급"), ["법정", "필수", "직무", "외부"].map((c) => h("th", { class: "num", style: "cursor:pointer", onclick: () => { sortKey = c; draw(); } }, CAT[c])),
        h("th", { class: "num", style: "cursor:pointer", onclick: () => { sortKey = "total"; draw(); } }, "합계"), o.target_hours ? h("th", { class: "num" }, "목표 대비") : null),
      rows.map((p) => h("tr", {}, h("td", {}, p.name), h("td", { class: "small" }, `${p.dept} · ${p.grade}`),
        ["법정", "필수", "직무", "외부"].map((c) => h("td", { class: "num" }, p[c] || "")), h("td", { class: "num" }, h("b", {}, p.total)),
        o.target_hours ? h("td", { class: "num" }, h("span", { class: "badge " + (p.total >= o.target_hours ? "b-done" : "b-part") }, `${Math.round(100 * p.total / o.target_hours)}%`)) : null)))));
  };
  const sel = h("select", { onchange: () => { filter = sel.value; draw(); } }, h("option", { value: "" }, "전체"), o.target_hours ? h("option", { value: "below" }, `목표(${o.target_hours}시간) 미달`) : null,
    d.depts.map((x) => h("option", { value: x }, x)));
  const ex = o.external;
  add(el,
    h("h2", {}, "경영평가 교육훈련 지표"), h("div", { class: "grid g3" }, kpiCards),
    h("div", { class: "grid g2" },
      h("div", { class: "card" }, h("h2", {}, "1인당 교육시간"), bar(o.per_capita, "d", "우리 기관(현재)"),
        o.target_hours ? bar(o.target_hours, "p", "내규 목표") : null, o.gov_hours ? bar(o.gov_hours, "n", "정부 권장") : null,
        o.target_hours ? h("p", { class: "small muted" }, `목표 미달 ${o.below}명 · 기준일 현재`) : null),
      h("div", { class: "card" }, h("h2", {}, "분야별 교육시간"),
        h("table", {}, Object.entries(CAT).map(([c, l]) => h("tr", {}, h("td", {}, l), h("td", { class: "num" }, `${o.courses[c]}개 과정`),
          h("td", { class: "num" }, `${o.totals[c].toLocaleString()}시간`), h("td", { class: "num" }, `${Math.round(100 * o.totals[c] / Math.max(1, o.total_hours))}%`))),
          h("tr", {}, h("td", {}, h("b", {}, "합계")), h("td", {}), h("td", { class: "num" }, h("b", {}, `${o.total_hours.toLocaleString()}시간`)), h("td", {}))))),
    o.priorities.length ? h("div", { class: "card" }, h("h2", {}, "정부 중점 과제 대비"), h("ul", { class: "small" }, o.priorities.map((x) => h("li", {}, x)))) : null,
    h("div", { class: "card" }, h("div", { class: "row between" }, h("h2", { style: "margin:0" }, "직원별 교육시간"), h("div", { class: "row" }, sel,
      h("button", { class: "btn sm", onclick: () => dl(`/api/projects/${pid}/export?doc=stats`) }, "엑셀"))), h("div", { style: "margin-top:8px" }, tbl)),
    h("div", { class: "card" }, h("div", { class: "row between" }, h("h2", { style: "margin:0" }, `외부(위탁)교육 ${ex.rows.length}건`),
      h("button", { class: "btn sm", onclick: () => dl(`/api/projects/${pid}/export?doc=settle`) }, "정산 내역 엑셀")),
      h("div", { class: "row small", style: "margin:8px 0" }, h("span", { class: "badge b-brand" }, `교육비 ${ex.total_cost.toLocaleString()}원`),
        ex.has_travel_rule ? h("span", { class: "badge b-brand" }, `여비(규정 산정) ${ex.total_travel.toLocaleString()}원`) : h("span", { class: "badge b-part" }, "여비규정 없음"),
        ex.report_days != null ? h("span", { class: "badge " + (ex.late + ex.missing ? "b-none" : "b-done") }, `결과보고 지연 ${ex.late} · 미제출 ${ex.missing}`) : null,
        ex.over_limit.length ? h("span", { class: "badge b-none" }, `지원 한도 초과: ${ex.over_limit.map((x) => x.name).join(", ")}`) : null),
      h("div", { class: "matrix-wrap", style: "max-height:360px" }, h("table", {},
        h("tr", {}, h("th", {}, "성명"), h("th", {}, "교육"), h("th", {}, "기간"), h("th", { class: "num" }, "교육비"), h("th", { class: "num" }, "여비"), h("th", {}, "결과보고")),
        ex.rows.map((x) => h("tr", {}, h("td", {}, x.name, h("div", { class: "tiny muted" }, `${x.dept} · ${x.grade}`)),
          h("td", { class: "small" }, x.title, h("div", { class: "tiny muted" }, x.inst)), h("td", { class: "small" }, `${x.start}~${(x.end || "").slice(5)} (${x.days}일)`),
          h("td", { class: "num" }, (x.cost || 0).toLocaleString()), h("td", { class: "num", title: x.notes.join(" / ") }, x.travel == null ? "-" : x.travel.toLocaleString()),
          h("td", {}, x.report_state ? h("span", { class: "badge " + (x.report_state.includes("기한 내") ? "b-done" : x.report_state.includes("대기") ? "" : "b-none") }, x.report_state) : "")))))));
  draw();
}
