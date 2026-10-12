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
  if (parts[0] === "p" && parts[1]) return viewProject(parts[1], parts[2] || "board", decodeURIComponent(parts[3] || ""));
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
    sample: h("div", {}, h("p", { class: "small" }, "가상의 ‘가상구시설관리공단’(직원 120명, 교대 현장직 69명) 자료 11개로 전 과정을 체험합니다."),
      h("ul", { class: "small muted" }, h("li", {}, "직원 명단·사이버교육 이수현황(엑셀)"), h("li", {}, "집합교육 서명부(한글·엑셀·워드), 외부교육 수료증(PDF)"),
        h("li", {}, "11월 교대근무표, 만족도 조사, 기관 교육 운영지침(한글)"))),
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
      location.hash = `#/p/${r.id}/board`;
    } catch { go.disabled = false; go.textContent = "시작하기"; }
  }
  mount(
    h("div", { class: "grid g2" },
      h("div", { class: "card hero" },
        h("h1", {}, "법정의무교육, 누가 다 이수했나요?"),
        h("p", {}, "직원 명단과 이수 기록(사이버교육 엑셀, 집합교육 서명부, 수료증)을 넣으면 직원별 이수 현황을 자동으로 맞춰 보고, ",
          "교대근무표에 맞춘 교육 일정, 미이수자 안내문, 실적 보고서와 증빙 묶음까지 만들어 줍니다."),
        h("div", { class: "steps" },
          h("div", { class: "step" }, h("b", {}, "1. 자료 넣기"), h("span", { class: "small" }, "형식이 달라도 폴더째")),
          h("div", { class: "step" }, h("b", {}, "2. 자동 대조"), h("span", { class: "small" }, "법령 기준으로 이수·부족·미이수 판정")),
          h("div", { class: "step" }, h("b", {}, "3. 일정·안내·보고"), h("span", { class: "small" }, "근무표 반영 일정, 안내문, 한글 보고서"))),
        h("ul", { class: "small muted" },
          h("li", {}, "동명이인·이름 오타·분류 안 되는 과정은 ‘확인 필요’로 모아 사람이 정합니다."),
          h("li", {}, "판정은 규칙과 계산으로 하고 모든 결과에 근거 파일·행이 붙습니다(AI 추측 없음)."),
          h("li", {}, "인터넷 없이 동작하며, 교육 규칙표는 설정에서 기관에 맞게 고칩니다."))),
      h("div", { class: "card" }, h("h2", {}, "새 작업"),
        modeTabs, pane,
        h("div", { class: "grid g2", style: "margin-top:12px" },
          h("div", { class: "field" }, h("label", { class: "f" }, "작업 이름(선택)"), name),
          h("div", { class: "field" }, h("label", { class: "f" }, "기준일(오늘 기준으로 기한 판정)"), base)),
        h("div", { class: "row" }, go))),
    h("h2", { style: "margin-top:8px" }, "진행 중인 작업"),
    list.length ? h("div", { class: "card", style: "padding:0" }, h("table", {},
      h("tr", {}, h("th", {}, "이름"), h("th", {}, "기준일"), h("th", {}, "자료"), h("th", {}, "만든 때"), h("th", {})),
      list.map((p) => h("tr", { class: "click", onclick: () => (location.hash = `#/p/${p.id}/board`) },
        h("td", {}, p.name), h("td", {}, p.base_date), h("td", {}, p.files + "개"), h("td", { class: "muted" }, p.created),
        h("td", { class: "num" }, h("button", { class: "btn sm ghost", onclick: async (e) => { e.stopPropagation(); if (!confirm("이 작업을 지울까요? (원본 자료는 그대로)")) return; await api(`/api/projects/${p.id}`, { method: "DELETE" }); viewHome(); } }, "삭제"))))))
      : h("div", { class: "card empty" }, "아직 없습니다. ‘샘플로 체험’으로 시작해 보세요."));
}

// ───────────── 작업 화면
const TABS = [["files", "자료"], ["board", "현황판"], ["matrix", "이수 현황표"], ["issues", "확인 필요"], ["plan", "일정 짜기"],
  ["notify", "안내문"], ["report", "보고·증빙"], ["year", "연간 계획"], ["ask", "질문하기"]];

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
  const tabs = h("nav", { class: "tabs" }, TABS.map(([k, l]) => h("a", { class: "tab" + (k === tab ? " on" : ""), href: `#/p/${pid}/${k}` }, l,
    k === "issues" ? h("span", { class: "cnt" + (nIssues ? "" : " ok") }, nIssues || "0") : null)));
  const body = h("div");
  mount(head, tabs, body);
  const fn = { files: tabFiles, board: tabBoard, matrix: tabMatrix, issues: tabIssues, plan: tabPlan, notify: tabNotify, report: tabReport, year: tabYear, ask: tabAsk }[tab] || tabBoard;
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
function tabBoard(el, d) {
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
    h("h3", { style: "margin-top:14px" }, "근거"), h("div", { class: "small" }, c.law),
    c.note ? h("div", { class: "small muted" }, c.note) : null,
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
        h("div", { class: "row", style: "margin-top:8px" }, h("button", { class: "btn sm", onclick: () => dl(`/api/projects/${pid}/export?doc=plan&fmt=hwpx&col=${encodeURIComponent(pl.col.key)}`) }, "일정 안내 한글"),
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
  const sv = await api(`/api/projects/${pid}/survey`);
  add(el, h("h2", { style: "margin-top:6px" }, "집합교육 결과보고서"),
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
  const save = async () => {
    const body = { org: { name: org.name.value, dept: org.dept.value, manager: org.manager.value },
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
    h("div", { class: "row", style: "margin-bottom:16px" }, h("button", { class: "btn primary", onclick: save }, "기관·일정·모델 설정 저장")),
    h("div", { class: "card" }, h("div", { class: "row between" }, h("h2", { style: "margin:0" }, "교육 규칙표"),
      h("div", { class: "row" }, h("button", { class: "btn", onclick: async () => { if (!confirm("기본 규칙표로 되돌릴까요?")) return; await api("/api/rules/reset", { method: "POST" }); viewSettings(); toast("기본값으로 되돌렸습니다"); } }, "기본값으로"),
        h("button", { class: "btn primary", onclick: saveRules }, "규칙표 저장"))),
      h("p", { class: "small muted" }, rules._안내 || ""),
      h("div", { style: "overflow:auto" }, h("table", { class: "rules-table" },
        h("tr", {}, h("th", {}, "법정"), h("th", {}, "교육"), h("th", {}, "근거"), h("th", {}, "주기"), h("th", {}, "시간(직무별은 사무:6, 현장:12)"), h("th", {}, "기한"), h("th", {}, "대상"), h("th", {}, "과정명 키워드")),
        rows.map((r) => h("tr", {}, h("td", {}, r.mand), h("td", {}, r.name), h("td", {}, r.law), h("td", {}, r.cycle), h("td", {}, r.hours), h("td", {}, r.due), h("td", {}, r.tgt), h("td", {}, r.kw)))))));
}
