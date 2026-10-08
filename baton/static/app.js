/* 업무바통 – 화면 스크립트(빌드 도구·외부 CDN 없이 동작: 폐쇄망 대응) */
"use strict";

// ───────────── 공통 도구
const $ = (s, el = document) => el.querySelector(s);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v; // 고정 문자열에만 사용
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    add(el, kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
function svg(tag, attrs, ...kids) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
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
  if (!r.ok) { const m = (data && data.detail) || r.statusText; toast("⚠ " + m, 4000); throw new Error(m); }
  return data;
}
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ } },
};

const TRUST = {
  official: ["공식문서", "t-official", "#16a34a"], doc: ["일반문서", "t-doc", "#64748b"], mail: ["메일", "t-mail", "#0284c7"],
  memo: ["개인메모", "t-memo", "#d97706"], oral: ["전임자 구술", "t-oral", "#7c3aed"], none: ["근거 없음", "t-none", "#dc2626"],
};
const KIND = { official: ["공식문서", "t-official"], data: ["데이터·대장", "t-data"], doc: ["일반문서", "t-doc"], mail: ["메일", "t-mail"], memo: ["개인메모", "t-memo"], oral: ["전임자 구술", "t-oral"], relay: ["이전 인수인계", "t-oral"] };
const STATUS = { verified: "확인됨", edited: "수정됨", ai: "검수 전", deleted: "삭제", unsupported: "근거 없음" };
const ORIGIN = { rule: "규칙엔진", llm: "AI 작성", interview: "인터뷰 답변", manual: "직접 추가" };
const QTYPE = { conflict: ["자료 불일치", "t-none"], open: ["결론 없는 협의", "t-memo"], person: ["협의 상대", "t-mail"], tacit: ["숨은 노하우", "t-oral"], llm: ["AI 질문", "t-official"], successor: ["후임자 질문", "t-mail"] };

const S = { info: null, project: null, poll: null };

// ───────────── 라우팅
window.addEventListener("hashchange", route);
document.addEventListener("DOMContentLoaded", async () => {
  $("#drawerClose").onclick = closeDrawer;
  $("#modelBadge").onclick = () => (location.hash = "#/settings");
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
  await loadInfo();
  route();
});
async function loadInfo() {
  S.info = await api("/api/info");
  $("#modelBadge").textContent = "🤖 " + S.info.active_label;
}
function route() {
  clearInterval(S.poll);
  closeDrawer();
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  if (parts[0] === "p" && parts[1]) return viewProject(parts[1], parts[2] || "docs");
  if (parts[0] === "settings") return viewSettings();
  return viewHome();
}
function add(el, ...kids) { el.append(...kids.flat(Infinity).filter((k) => k != null && k !== false)); return el; }
function mount(...nodes) { const app = $("#app"); app.replaceChildren(...nodes); window.scrollTo(0, 0); }

// ───────────── 근거 원문 보기(서랍)
async function openSource(cid, hint = "") {
  const p = S.project;
  const d = $("#drawer"), body = $("#drawerBody");
  body.replaceChildren(h("div", { class: "muted" }, h("span", { class: "spin" }), " 불러오는 중"));
  d.classList.add("open"); d.setAttribute("aria-hidden", "false");
  const c = await api(`/api/projects/${p.id}/chunks/${cid}`);
  $("#drawerTitle").textContent = `근거 ${cid}`;
  const kind = KIND[c.kind] || ["", ""];
  const words = [...new Set((hint.match(/[가-힣A-Za-z0-9]{2,}/g) || []).filter((w) => w.length >= 2))].slice(0, 12);
  const quote = h("div", { class: "quote" });
  highlight(quote, c.text, words);
  body.replaceChildren(
    h("dl", { class: "kv" },
      h("dt", {}, "파일"), h("dd", {}, c.file),
      h("dt", {}, "위치"), h("dd", {}, c.where || "-"),
      h("dt", {}, "자료 성격"), h("dd", {}, h("span", { class: "badge " + kind[1] }, kind[0] || c.kind)),
      c.doc ? [h("dt", {}, "수정일"), h("dd", {}, c.doc.mtime || "-"), h("dt", {}, "원본 지문"), h("dd", { class: "tiny muted" }, (c.doc.sha256 || "").slice(0, 24) + "…")] : null),
    quote,
    h("p", { class: "tiny muted" }, "※ 원본 파일은 읽기 전용으로만 열었으며, 민감정보(비밀번호·주민번호·휴대전화)는 가려서 보여 줍니다."));
}
function highlight(el, text, words) {
  if (!words.length) { el.textContent = text; return; }
  const re = new RegExp("(" + words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "g");
  for (const part of text.split(re)) el.append(words.includes(part) ? h("mark", {}, part) : document.createTextNode(part));
}
function closeDrawer() { const d = $("#drawer"); d.classList.remove("open"); d.setAttribute("aria-hidden", "true"); }
function srcChips(sources, hint) {
  const idx = (S.project && S.project.chunk_index) || {};
  return (sources || []).map((sid) => {
    if (sid.startsWith("Q")) return h("button", { class: "src", onclick: () => openSource(sid, hint), title: "전임자 인터뷰 답변" }, "🎙 ", h("span", {}, "전임자 구술 " + sid));
    const c = idx[sid]; if (!c) return null;
    const k = KIND[c[2]] || ["", ""];
    return h("button", { class: "src", title: `${c[0]} · ${c[1]}`, onclick: () => openSource(sid, hint) },
      h("i", { class: "dot", style: `background:${(TRUST[c[2]] || TRUST.official)[2]}` }), h("span", {}, `${c[0].split("/").pop()} · ${c[1]}`));
  });
}
function trustBadge(t) { const x = TRUST[t] || TRUST.none; return h("span", { class: "badge " + x[1] }, x[0]); }

// ───────────── 처음 화면
async function viewHome() {
  const list = await api("/api/projects");
  const today = new Date().toISOString().slice(0, 10);
  const form = {
    name: h("input", { placeholder: "예) 정보보안·정보화예산 담당", value: "" }),
    from: h("input", { placeholder: "예) 김바통 주무관" }),
    to: h("input", { placeholder: "예) 이어달 주무관" }),
    date: h("input", { type: "date", value: today }),
  };
  let mode = "folder";
  const fileInput = h("input", { type: "file", webkitdirectory: true, multiple: true, style: "display:none" });
  const fileInfo = h("div", { class: "small muted" }, "선택된 폴더 없음");
  const pathInput = h("input", { placeholder: "예) C:\\Users\\me\\Documents\\인수인계자료  또는  /home/me/업무" });
  const prog = h("div", { class: "progress", style: "display:none;margin-top:10px" }, h("i", { style: "width:0" }));
  fileInput.onchange = () => {
    const files = [...fileInput.files];
    const ok = files.filter((f) => S.info.supported.some((e) => f.name.toLowerCase().endsWith(e)));
    fileInfo.textContent = files.length ? `${files.length}개 파일 중 ${ok.length}개 분석 가능 (${[...new Set(ok.map((f) => f.name.split(".").pop().toUpperCase()))].join(", ")})` : "선택된 폴더 없음";
  };
  const panes = {
    folder: h("div", {}, h("div", { class: "drop" }, h("p", { class: "small" }, "전임자 업무 폴더를 통째로 선택하세요. 한글·PDF·엑셀·워드·메일(eml)·메모가 섞여 있어도 됩니다."),
      h("button", { class: "btn", onclick: () => fileInput.click() }, "📁 폴더 선택"), fileInput, fileInfo)),
    path: h("div", {}, h("label", { class: "f" }, "이 PC의 폴더 경로(원본은 읽기만 하고 복사하지 않음)"), pathInput),
    demo: h("div", {},
      h("label", { class: "check" }, h("input", { type: "radio", name: "sample", value: "security", checked: true }),
        h("div", {}, h("b", {}, "정보보안·정보화예산 담당 (가상시 스마트정보과)"), h("div", { class: "tiny muted" }, "공문 PDF·계획 HWPX·사무분장 엑셀·회의록·메일 4통·개인 메모·이전 담당자 바통 파일"))),
      h("label", { class: "check" }, h("input", { type: "radio", name: "sample", value: "facility" }),
        h("div", {}, h("b", {}, "체육센터 시설관리 담당 (공공기관 시설운영팀)"), h("div", { class: "tiny muted" }, "안전점검 계획 HWPX·수질검사 PDF·용역 계약 엑셀·업무분장 워드·연락처·메일·메모 – 착공일 충돌·바뀐 연락처·기한 지남 포함"))),
      h("p", { class: "tiny muted" }, "모든 인물·기관·연락처는 가상입니다.")),
  };
  const paneBox = h("div", {}, panes.folder);
  const modeBtns = [["folder", "📁 폴더 올리기"], ["path", "🖥 PC 경로"], ["demo", "✨ 샘플로 체험"]].map(([k, label]) =>
    h("button", { class: "tab" + (k === mode ? " on" : ""), onclick: (e) => { mode = k; paneBox.replaceChildren(panes[k]); modeBtns.forEach((b) => b.classList.remove("on")); e.target.classList.add("on"); } }, label));
  const startBtn = h("button", { class: "btn primary", onclick: start }, "바통 받을 준비 시작 →");

  async function start() {
    const meta = { name: form.name.value.trim(), from_name: form.from.value.trim(), to_name: form.to.value.trim(), base_date: form.date.value };
    startBtn.disabled = true;
    try {
      let res;
      if (mode === "demo") res = await api("/api/projects/demo", { method: "POST", json: { sample: (document.querySelector("input[name=sample]:checked") || {}).value || "security" } });
      else if (mode === "path") {
        if (!pathInput.value.trim()) { toast("폴더 경로를 입력하세요"); return; }
        res = await api("/api/projects/path", { method: "POST", json: { ...meta, path: pathInput.value.trim() } });
      } else {
        const files = [...fileInput.files].filter((f) => S.info.supported.some((e) => f.name.toLowerCase().endsWith(e)));
        if (!files.length) { toast("분석할 수 있는 파일이 있는 폴더를 선택하세요"); return; }
        const fd = new FormData();
        for (const f of files) { fd.append("files", f); fd.append("paths", f.webkitRelativePath || f.name); }
        Object.entries(meta).forEach(([k, v]) => fd.append(k, v));
        prog.style.display = "block";
        res = await new Promise((ok, bad) => {
          const x = new XMLHttpRequest(); x.open("POST", "/api/projects/upload");
          x.upload.onprogress = (e) => { if (e.lengthComputable) prog.firstChild.style.width = (100 * e.loaded / e.total) + "%"; };
          x.onload = () => (x.status < 300 ? ok(JSON.parse(x.responseText)) : bad(new Error(x.responseText)));
          x.onerror = () => bad(new Error("업로드 실패")); x.send(fd);
        });
      }
      location.hash = `#/p/${res.id}/docs`;
    } catch (e) { toast("⚠ " + e.message, 4000); } finally { startBtn.disabled = false; }
  }

  mount(
    h("section", { class: "hero" },
      h("div", { class: "card" },
        h("span", { class: "badge t-official" }, "2026 공공 AI 대전환 챌린지 · 세션2 과제① 업무바통"),
        h("h1", {}, "인사발령 났나요? 폴더째 넣으면 인수인계가 시작됩니다"),
        h("p", { class: "muted" }, "흩어진 한글·PDF·엑셀·메일·메모를 읽어 ‘언제 무엇을, 누구와’ 해야 하는지 출처와 함께 정리하고, 문서에 없는 전임자의 노하우까지 인터뷰로 끌어냅니다."),
        h("div", { class: "steps" },
          h("div", { class: "step" }, h("b", {}, "① 자료 넣기"), h("span", { class: "small" }, "폴더째 투입 · 원본은 읽기만")),
          h("div", { class: "step" }, h("b", {}, "② 전임자 검수"), h("span", { class: "small" }, "출처 확인 · 암묵지 인터뷰")),
          h("div", { class: "step" }, h("b", {}, "③ 후임자 수령"), h("span", { class: "small" }, "달력 · 협업지도 · 질문 · 30일 플랜"))),
        h("ul", { class: "small", style: "margin:12px 0 0;padding-left:18px" },
          h("li", {}, "모든 문장에 근거 각주 – 클릭하면 원문 해당 부분이 열립니다"),
          h("li", {}, "신뢰 신호등: 공식문서 / 메일 / 개인메모 / 전임자 구술을 색으로 구분"),
          h("li", {}, "자료끼리 날짜가 다르면 ‘불일치’로 잡아 전임자에게 되묻습니다"),
          h("li", {}, "LLM 없이도 동작하고, Gemma·EXAONE·Llama·GPT-OSS·HyperCLOVA X·Solar로 교체할 수 있습니다"))),
      h("div", { class: "card" },
        h("h2", {}, "새 인수인계 시작"),
        h("div", { class: "grid g2" },
          h("div", {}, h("label", { class: "f" }, "업무명"), form.name),
          h("div", {}, h("label", { class: "f" }, "인수인계 기준일"), form.date),
          h("div", {}, h("label", { class: "f" }, "전임자"), form.from),
          h("div", {}, h("label", { class: "f" }, "후임자"), form.to)),
        h("div", { class: "tabs", style: "margin-top:14px" }, modeBtns),
        paneBox, prog,
        h("div", { class: "row", style: "margin-top:14px;justify-content:flex-end" }, startBtn))),
    h("h2", { style: "margin-top:26px" }, "진행 중인 인수인계"),
    list.length ? h("div", { class: "grid g3" }, list.map((p) =>
      h("a", { class: "card", href: `#/p/${p.id}/${p.stage === "done" ? "handover" : "review"}`, style: "text-decoration:none;color:inherit" },
        h("div", { class: "row between" }, h("b", {}, p.name), h("span", { class: "badge " + (p.stage === "done" ? "t-official" : "t-mail") }, { ingesting: "자료 읽는 중", ingested: "자료 투입", review: "검수 중", done: "인계 완료" }[p.stage] || p.stage)),
        h("div", { class: "small muted" }, `${p.from_name || "전임자"} → ${p.to_name || "후임자"} · 자료 ${p.n_docs}개 · ${p.created}`))))
      : h("div", { class: "card empty" }, "아직 없습니다. 위에서 ‘샘플로 체험’을 눌러 보세요."));
}

// ───────────── 인수인계 건 화면
const TABS = [
  ["docs", "① 자료", "전임자"], ["review", "② 초안 검수", "전임자"], ["interview", "③ 암묵지 인터뷰", "전임자"],
  ["calendar", "④ 업무 달력", "후임자"], ["map", "⑤ 협업 지도", "후임자"], ["ask", "⑥ 질문하기", "후임자"], ["plan", "⑦ 첫 30일", "후임자"],
  ["handover", "⑧ 바통 터치", "함께"],
];
async function viewProject(pid, tab) {
  const p = await api(`/api/projects/${pid}`);
  S.project = p;
  const running = p.job && p.job.state === "running";
  const head = h("div", { class: "row between" },
    h("div", {}, h("h1", {}, p.name),
      h("div", { class: "small muted" }, `${p.org || ""} ${p.dept || ""} · ${p.from_name || "전임자"} → ${p.to_name || "후임자"} · 기준일 ${p.base_date}`)),
    h("div", { class: "row" }, p.draft ? h("span", { class: "badge" }, `초안: ${p.draft.generated_by}`) : null));
  if (running || !p.draft) {
    const bar = h("i", { style: `width:${Math.round(100 * ((p.job && p.job.frac) || 0))}%` });
    const msg = h("div", { class: "small muted" }, (p.job && p.job.step) || "준비 중");
    const box = h("div", { class: "card", style: "margin-top:16px" },
      h("h2", {}, h("span", { class: "spin" }), " 전임자의 자료를 읽고 있어요"), h("div", { class: "progress" }, bar), msg,
      h("p", { class: "small muted" }, "원본 파일은 읽기 전용으로 열고, 민감정보는 가린 뒤 분석합니다."));
    mount(head, box);
    if (p.job && p.job.state === "error") { box.replaceChildren(h("div", { class: "alert bad" }, "오류: " + p.job.error)); return; }
    if (!running && !p.draft && p.stage !== "ingesting") { box.replaceChildren(h("div", { class: "alert warn" }, "분석할 수 있는 자료가 없습니다. 지원 형식: " + S.info.supported.join(" "))); return; }
    S.poll = setInterval(async () => {
      const j = await api(`/api/projects/${pid}/job`);
      bar.style.width = Math.round(100 * (j.frac || 0)) + "%"; msg.textContent = j.step || "";
      if (j.state === "done" || j.state === "error") { clearInterval(S.poll); route(); }
    }, 700);
    return;
  }
  const d = p.draft;
  const allItems = d.sections.flatMap((s) => s.items);
  const live = allItems.filter((i) => i.status !== "deleted");
  const verified = live.filter((i) => ["verified", "edited"].includes(i.status)).length;
  const openQ = d.questions.filter((q) => q.status === "open").length;
  const counts = { review: `${verified}/${live.length}`, interview: openQ ? String(openQ) : "✓" };
  let lastRole = "";
  const tabs = h("nav", { class: "tabs" }, TABS.map(([k, label, role]) => {
    const out = [];
    if (role !== lastRole) { out.push(h("span", { class: "role" }, role)); lastRole = role; }
    out.push(h("a", { class: "tab" + (k === tab ? " on" : ""), href: `#/p/${pid}/${k}`, style: "text-decoration:none" }, label, counts[k] ? h("span", { class: "cnt" }, counts[k]) : null));
    return out;
  }));
  const body = h("div");
  mount(head, tabs, body);
  const views = { docs: tabDocs, review: tabReview, interview: tabInterview, calendar: tabCalendar, map: tabMap, ask: tabAsk, plan: tabPlan, handover: tabHandover };
  await (views[tab] || tabDocs)(body, p);
}
async function refresh() { const p = await api(`/api/projects/${S.project.id}`); S.project = p; return p; }

// ① 자료
function tabDocs(el, p) {
  const byKind = {};
  p.docs.forEach((d) => (byKind[d.kind] = (byKind[d.kind] || 0) + 1));
  const masked = p.docs.reduce((a, d) => a + (d.masked || 0), 0);
  const cards = Object.fromEntries((p.draft.doc_cards || []).map((c) => [c.doc_id, c]));
  const integ = p.integrity || {};
  const models = h("select", { style: "width:auto" });
  api("/api/settings").then((r) => {
    for (const [k, v] of Object.entries(r.settings.llm.profiles)) models.append(h("option", { value: k, selected: k === r.settings.llm.active }, v.label || k));
  });
  add(el, 
    integ.ok ? h("div", { class: "alert ok" }, `🔒 원본 보호 확인: 분석한 ${integ.checked}개 파일의 지문(SHA-256)이 처리 전후 동일합니다 (${integ.at}). 산출물은 별도 작업 폴더에만 저장됩니다.`)
      : h("div", { class: "alert bad" }, "⚠ 원본 변경 감지: " + (integ.changed || []).join(", ")),
    (p.lineage || []).length ? lineageCard(p) : null,
    h("div", { class: "grid g4" },
      stat(p.docs.length, "분석한 파일"), stat(Object.keys(p.chunk_index).length, "근거조각"),
      stat(masked, "가린 민감정보"), stat((p.draft.facts.conflicts || []).length, "자료 간 불일치")),
    h("div", { class: "legend", style: "margin:14px 0" }, Object.entries(KIND).filter(([k]) => byKind[k]).map(([k, v]) => h("span", { class: "badge " + v[1] }, `${v[0]} ${byKind[k]}`))),
    h("div", { class: "card" },
      h("div", { class: "row between" }, h("h2", {}, "투입된 자료"),
        h("div", { class: "row" }, models, h("button", { class: "btn", onclick: async () => {
          if (!confirm("지금까지 검수·인터뷰한 내용이 새 초안으로 바뀝니다. 다시 만들까요?")) return;
          await api(`/api/projects/${p.id}/draft`, { method: "POST", json: { profile: models.value } }); route();
        } }, "↻ 이 모델로 초안 다시 만들기"))),
      h("table", { class: "tbl" },
        h("tr", {}, h("th", {}, "성격"), h("th", {}, "파일"), h("th", {}, "요약"), h("th", {}, "조각"), h("th", {}, "가림")),
        p.docs.map((d) => h("tr", {},
          h("td", {}, h("span", { class: "badge " + (KIND[d.kind] || ["", "t-none"])[1] }, d.error ? "읽기 실패" : (KIND[d.kind] || [d.kind])[0])),
          h("td", {}, h("div", {}, d.file), h("div", { class: "tiny muted" }, `${(d.info && d.info.format) || d.ext} · ${Math.round(d.size / 1024)}KB · ${d.mtime}`)),
          h("td", { class: "small" }, d.error ? h("span", { class: "bad-t" }, d.error) : ((cards[d.id] && cards[d.id].summary) || d.preview || "").slice(0, 160)),
          h("td", {}, d.n_chunks), h("td", {}, d.masked ? h("span", { class: "badge t-memo" }, d.masked) : "-"))))),
    p.skipped && p.skipped.length ? h("div", { class: "card", style: "margin-top:12px" }, h("h3", {}, `제외된 파일 ${p.skipped.length}개`),
      h("div", { class: "small muted" }, p.skipped.map((s) => `${s.file} (${s.reason})`).join(" · "))) : null,
    p.draft.warnings && p.draft.warnings.length ? h("div", { class: "alert warn", style: "margin-top:12px" }, p.draft.warnings.join(" / ")) : null,
    h("div", { class: "row", style: "justify-content:flex-end;margin-top:14px" }, h("a", { class: "btn primary", href: `#/p/${p.id}/review` }, "초안 검수하러 가기 →")));
}
function lineageCard(p) {
  const chain = [...(p.lineage || []).map((g) => g.name), p.from_name || "전임자", p.to_name || "후임자"].filter((x, i, a) => x && a.indexOf(x) === i);
  if (chain.length <= 2 && !(p.lineage || []).length) return null;
  return h("div", { class: "card", style: "margin-top:14px" }, h("h3", {}, "🧬 이 업무의 바통 계보"),
    h("div", { class: "lineage" }, chain.map((n, i) => [i ? h("span", { class: "arrow" }, "→") : null,
      h("span", { class: "gen" + (i === chain.length - 1 ? " now" : "") }, h("small", {}, `${i + 1}대`), n)])),
    h("p", { class: "tiny muted" }, "이전 담당자들이 남긴 바통 파일의 내용이 ‘이전 인수인계’ 근거로 함께 쓰였습니다."));
}
function stat(n, label) { return h("div", { class: "card" }, h("div", { class: "stat" }, n), h("div", { class: "small muted" }, label)); }

// ② 초안 검수
function tabReview(el, p) {
  const d = p.draft;
  const live = d.sections.flatMap((s) => s.items).filter((i) => i.status !== "deleted");
  const done = live.filter((i) => ["verified", "edited"].includes(i.status)).length;
  const toc = h("div", { class: "toc card" }, h("h3", {}, "목차"),
    d.sections.map((s) => {
      const l = s.items.filter((i) => i.status !== "deleted");
      return h("a", { href: "javascript:void 0", onclick: () => document.getElementById("sec-" + s.id).scrollIntoView({ behavior: "smooth" }) },
        h("span", {}, s.title.replace(/^\d+\.\s*/, "")), h("span", { class: "tiny muted" }, `${l.filter((i) => ["verified", "edited"].includes(i.status)).length}/${l.length}`));
    }),
    h("hr", { style: "border:0;border-top:1px solid var(--line)" }),
    h("div", { class: "legend", style: "flex-direction:column;gap:4px" }, Object.values(TRUST).map((t) => h("span", {}, h("i", { class: "dot", style: `background:${t[2]}` }), " ", t[0]))));
  const main = h("div", {},
    h("div", { class: "card", style: "margin-bottom:14px" },
      h("div", { class: "row between" }, h("b", {}, `전임자 검수 진행률 ${live.length ? Math.round(100 * done / live.length) : 0}%`), h("span", { class: "small muted" }, `${done}/${live.length} 항목 확인`)),
      h("div", { class: "progress", style: "margin-top:6px" }, h("i", { style: `width:${live.length ? 100 * done / live.length : 0}%` })),
      h("p", { class: "small muted", style: "margin:8px 0 0" }, "각 문장 아래의 출처를 눌러 원문을 확인한 뒤 ✔ 확인, 고칠 내용은 ✏ 수정하세요. 근거가 없는 AI 문장(빨간색)은 확인해야만 인수인계서에 들어갑니다.")),
    d.sections.map((s) => sectionCard(s, p)));
  add(el, h("div", { class: "layout" }, toc, main));
}
function sectionCard(sec, p) {
  const input = h("input", { placeholder: "직접 추가할 내용(예: 결재는 오전에 올리는 것이 좋음)" });
  return h("div", { class: "card sec", id: "sec-" + sec.id },
    h("div", { class: "sec-head" }, h("div", {}, h("h2", { style: "margin:0" }, sec.title), h("div", { class: "tiny muted" }, sec.guide, " · ", sec.mode === "llm" ? "AI 작성" : "규칙엔진 추출")),
      h("button", { class: "btn sm", onclick: async () => {
        for (const it of sec.items.filter((i) => i.status === "ai")) await api(`/api/projects/${p.id}/items/${it.id}`, { method: "PATCH", json: { status: "verified" } });
        toast("이 항목의 미검수 문장을 모두 확인 처리했습니다"); route();
      } }, "모두 확인")),
    sec.items.length ? sec.items.map((it) => itemRow(it, p)) : h("div", { class: "empty small" }, "자료에서 찾지 못했습니다. 아래에 직접 추가하거나 인터뷰로 채워 주세요."),
    h("div", { class: "row", style: "margin-top:10px" }, h("div", { class: "grow" }, input),
      h("button", { class: "btn", onclick: async () => {
        if (!input.value.trim()) return;
        await api(`/api/projects/${p.id}/sections/${sec.id}/items`, { method: "POST", json: { text: input.value } }); route();
      } }, "+ 추가")));
}
function itemRow(it, p) {
  const t = TRUST[it.trust] || TRUST.none;
  const text = h("div", { class: "text" }, it.text);
  const meta = it.meta || {};
  const extra = [];
  if (meta.status) extra.push(h("span", { class: "badge" }, "상태: " + meta.status));
  if (meta.next) extra.push(h("span", { class: "badge t-memo" }, "다음 할 일: " + meta.next));
  if (meta.due) extra.push(h("span", { class: "badge t-none" }, "기한: " + meta.due));
  if (meta.resolved) extra.push(h("span", { class: "badge t-oral" }, "전임자 확인: " + meta.resolved));
  const related = (meta.related || []).length ? h("div", { class: "tiny muted" }, "관련: " + meta.related.map((r) => r.slice(0, 50)).join(" / ")) : null;
  const row = h("div", { class: `item ${it.status}` },
    h("i", { class: "dot light", style: `background:${it.status === "unsupported" ? TRUST.none[2] : t[2]}`, title: t[0] }),
    h("div", { class: "body" }, text, related,
      h("div", { class: "row", style: "gap:4px;margin-top:2px" },
        h("span", { class: "status s-" + it.status }, STATUS[it.status] || it.status), h("span", { class: "tiny muted" }, ORIGIN[it.origin] || ""), trustBadge(it.status === "unsupported" ? "none" : it.trust), extra),
      h("div", {}, srcChips(it.sources, it.text))),
    h("div", { class: "acts" },
      it.status !== "verified" && it.status !== "deleted" ? h("button", { class: "btn sm", title: "확인", onclick: () => patch({ status: "verified" }) }, "✔") : null,
      it.status !== "deleted" ? h("button", { class: "btn sm", title: "수정", onclick: edit }, "✏") : null,
      it.status === "deleted" ? h("button", { class: "btn sm", onclick: () => patch({ status: "ai" }) }, "복구") : h("button", { class: "btn sm", title: "삭제", onclick: () => patch({ status: "deleted" }) }, "🗑")));
  async function patch(b) { await api(`/api/projects/${p.id}/items/${it.id}`, { method: "PATCH", json: b }); route(); }
  function edit() {
    const ta = h("textarea", {}, it.text);
    text.replaceWith(h("div", {}, ta, h("div", { class: "row", style: "margin-top:4px" },
      h("button", { class: "btn sm primary", onclick: () => patch({ text: ta.value, status: "edited" }) }, "저장"),
      h("button", { class: "btn sm", onclick: route }, "취소"))));
    ta.focus();
  }
  return row;
}

// ③ 암묵지 인터뷰
function tabInterview(el, p) {
  const qs = p.draft.questions;
  const answered = qs.filter((q) => q.status === "answered").length;
  add(el, 
    h("div", { class: "alert info" }, "📝 문서만으로는 알 수 없는 것들을 AI가 골라 물어봅니다. 답변은 ‘전임자 구술’ 근거로 인수인계서에 자동 반영되고, 후임자 질문에도 활용됩니다."),
    h("div", { class: "row between", style: "margin-bottom:10px" }, h("b", {}, `답변 ${answered}/${qs.length}`),
      h("div", { class: "progress grow", style: "max-width:300px" }, h("i", { style: `width:${qs.length ? 100 * answered / qs.length : 0}%` }))),
    qs.slice().sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1)).map((q) => {
      const ty = QTYPE[q.type] || ["질문", "t-doc"];
      const ta = h("textarea", { placeholder: "1~3문장이면 충분합니다. 예) 도 마감(5/22)이 실제 기한입니다. 공문 기한은 도→행안부 제출일이에요." });
      return h("div", { class: "qcard" + (q.status === "answered" ? " answered" : "") },
        h("div", { class: "row between" }, h("span", { class: "badge " + ty[1] }, ty[0]), h("span", { class: "tiny muted" }, q.id)),
        h("p", { style: "margin:8px 0 2px;font-weight:600" }, q.q),
        q.why ? h("div", { class: "why" }, "왜 묻나요? " + q.why) : null,
        h("div", {}, srcChips(q.sources, q.q)),
        q.status === "answered"
          ? h("div", { class: "alert ok", style: "margin:10px 0 0" }, "🎙 ", q.answer, h("div", { class: "tiny" }, `${q.answered_at} 반영됨 → ${q.item_id || ""}`))
          : h("div", { style: "margin-top:8px" }, ta, h("div", { class: "row", style: "justify-content:flex-end;margin-top:6px" },
            h("button", { class: "btn primary sm", onclick: async () => {
              if (!ta.value.trim()) return toast("답변을 입력하세요");
              await api(`/api/projects/${p.id}/questions/${q.id}/answer`, { method: "POST", json: { answer: ta.value } });
              toast("인수인계서에 반영했습니다"); route();
            } }, "답변 저장 → 인수인계서 반영"))));
    }));
}

// ④ 업무 달력
function tabCalendar(el, p) {
  const sec = p.draft.sections.find((s) => s.kind === "calendar");
  if (!sec) return add(el, h("div", { class: "empty" }, "양식에서 ‘시기별 할 일’ 항목이 꺼져 있습니다."));
  const items = sec.items.filter((i) => !["deleted", "unsupported"].includes(i.status));
  let onlyDeadline = store.get("cal.deadline", false);
  const base = new Date(p.base_date);
  const grid = h("div");
  const toggle = h("label", { class: "small" }, h("input", { type: "checkbox", checked: onlyDeadline, onchange: (e) => { onlyDeadline = e.target.checked; store.set("cal.deadline", onlyDeadline); draw(); } }), " 기한(마감)만 보기");
  function chip(it) {
    const m = it.meta || {};
    return h("span", { class: "chip" + (m.deadline ? " deadline" : "") + (m.recur === "yearly" ? " yearly" : ""), title: it.text, onclick: () => it.sources[0] && openSource(it.sources[0], it.text) },
      m.recur === "yearly" ? "🔁 " : "", m.day ? `${m.day}일 ` : (m.part ? `${m.part} ` : ""), it.text.replace(/^\[[^\]]*\]\s*/, "").slice(0, 60));
  }
  function draw() {
    const list = items.filter((i) => !onlyDeadline || (i.meta && i.meta.deadline));
    const routine = list.filter((i) => i.meta && ["monthly", "quarterly"].includes(i.meta.recur));
    const months = Array.from({ length: 12 }, (_, k) => list.filter((i) => i.meta && i.meta.month === k + 1 && !["monthly", "quarterly"].includes(i.meta.recur)));
    const oral = list.filter((i) => !i.meta || (!i.meta.month && !["monthly", "quarterly"].includes(i.meta.recur)));
    grid.replaceChildren(...[
      h("div", { class: "card", style: "margin-bottom:12px" }, h("h3", {}, "🔄 매월·매분기 반복"), routine.length ? routine.map(chip) : h("span", { class: "muted small" }, "없음")),
      h("div", { class: "cal" }, months.map((ms, k) => h("div", { class: "month" + (base.getMonth() === k ? " now" : "") },
        h("h3", {}, h("span", {}, `${k + 1}월`), base.getMonth() === k ? h("span", { class: "badge t-mail" }, "기준월") : h("span", { class: "tiny muted" }, ms.length || "")),
        ms.sort((a, b) => (a.meta.day || 15) - (b.meta.day || 15)).map(chip)))),
      oral.length ? h("div", { class: "card", style: "margin-top:12px" }, h("h3", {}, "🎙 전임자가 알려준 시기 정보"), oral.map((i) => h("div", { class: "small" }, "• " + i.text))) : null].filter(Boolean));
  }
  draw();
  add(el, h("div", { class: "row between", style: "margin-bottom:10px" },
    h("div", { class: "legend" }, h("span", { class: "chip deadline", style: "display:inline-block" }, "기한"), h("span", { class: "chip yearly", style: "display:inline-block" }, "🔁 매년"), h("span", { class: "chip", style: "display:inline-block" }, "일반 일정")),
    h("div", { class: "row" }, toggle, h("a", { class: "btn primary sm", href: `/api/projects/${p.id}/export?fmt=ics`, title: "Outlook·그룹웨어·휴대폰 달력에서 가져오기" }, "📅 내 일정으로 내보내기(.ics)"))), grid,
    h("p", { class: "tiny muted" }, "내보낸 일정은 매월·매년 반복으로 등록되고, 기한 3일 전에 알림이 울립니다. 각 일정 설명에 근거 파일이 적혀 있습니다."));
}

// ⑤ 협업 지도
function tabMap(el, p) {
  const people = (p.draft.facts.people || []).slice(0, 14);
  const sec = p.draft.sections.find((s) => s.kind === "people");
  const detail = h("div", { class: "card" }, h("div", { class: "muted" }, "사람을 누르면 어떤 일로, 어떻게 연락하는지 보여 줍니다."));
  if (!people.length) return add(el, h("div", { class: "empty" }, "자료에서 협의 상대를 찾지 못했습니다."));
  const W = 640, H = 520, cx = W / 2, cy = H / 2;
  const orgs = [...new Set(people.map((x) => x.org || orgOf(x)))];
  const palette = ["#2563eb", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d", "#64748b"];
  const maxW = Math.max(...people.map((x) => x.weight));
  const nodes = people.map((x, i) => {
    const ang = (2 * Math.PI * i) / people.length - Math.PI / 2;
    const r = 120 + (1 - x.weight / maxW) * 110;
    return { ...x, x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang), color: palette[orgs.indexOf(x.org || orgOf(x)) % palette.length], size: 16 + 18 * (x.weight / maxW) };
  });
  const map = svg("svg", { class: "map", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "협업 지도" },
    nodes.map((n) => svg("line", { x1: cx, y1: cy, x2: n.x, y2: n.y, stroke: n.color, "stroke-opacity": 0.35, "stroke-width": 1 + 5 * (n.weight / maxW) })),
    svg("circle", { cx, cy, r: 34, fill: "#0f172a" }),
    svg("text", { x: cx, y: cy + 5, "text-anchor": "middle", fill: "#fff", "font-size": 14, "font-weight": 700 }, "나(후임자)"),
    nodes.map((n) => svg("g", { class: "node", onclick: () => showPerson(n) },
      svg("circle", { cx: n.x, cy: n.y, r: n.size, fill: n.color, "fill-opacity": 0.9 }),
      svg("text", { x: n.x, y: n.y + 4, "text-anchor": "middle", fill: "#fff", "font-size": 12, "font-weight": 700 }, n.name),
      svg("text", { x: n.x, y: n.y + n.size + 14, "text-anchor": "middle", fill: "#334155", "font-size": 11 }, [n.title, n.org].filter(Boolean).join(" · ").slice(0, 18)))));
  function showPerson(n) {
    const item = sec && sec.items.find((i) => i.meta && i.meta.person === n.id);
    detail.replaceChildren(...[
      h("h2", {}, `${n.name} ${n.title}`), h("div", { class: "muted small" }, n.org || orgOf(n) || "소속 미상"),
      h("dl", { class: "kv", style: "margin-top:10px" },
        h("dt", {}, "관련 업무"), h("dd", {}, n.topics.join(", ") || "-"),
        h("dt", {}, "메일"), h("dd", {}, n.emails.join(", ") || "-"),
        h("dt", {}, "전화"), h("dd", {}, n.tels.join(", ") || "-"),
        h("dt", {}, "등장"), h("dd", {}, `메일 ${n.mails}회 · 문서 언급 ${n.mentions}회`)),
      n.contexts.length ? [h("h3", {}, "자료 속 맥락"), n.contexts.map((c) => h("div", { class: "small", style: "margin-bottom:6px" }, "• " + c.text, " ", srcChips([c.source], c.text)))] : null,
      item && item.status !== "deleted" ? h("div", { class: "tiny muted" }, "인수인계서 항목: " + item.text) : null,
      h("div", {}, srcChips(n.sources, n.name))].flat(Infinity).filter(Boolean));
  }
  showPerson(nodes[0]);
  add(el, h("div", { class: "legend", style: "margin-bottom:8px" }, orgs.map((o, i) => h("span", {}, h("i", { class: "dot", style: `background:${palette[i % palette.length]}` }), " ", o || "소속 미상"))),
    h("div", { class: "map-wrap" }, map, detail),
    h("p", { class: "tiny muted" }, "원의 크기·선 굵기 = 메일 주고받은 횟수와 문서 언급 횟수. 메일 주소 도메인으로 기관을 추정합니다."));
}
function orgOf(x) { const e = (x.emails || [])[0]; return e ? e.split("@")[1] : ""; }

// ⑥ 질문하기
function tabAsk(el, p) {
  const chat = h("div", { class: "chat" });
  const input = h("input", { placeholder: "예) 수준진단 증빙은 어디에 모아 뒀어요?" });
  const sends = h("button", { class: "btn primary", onclick: () => send() }, "질문");
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) send(); });
  // 추천 질문은 지금 인수인계 자료에 맞춰 만든다
  const nextMonth = (new Date(p.base_date).getMonth() + 1) % 12 + 1;
  const ppl = (p.draft.facts && p.draft.facts.people) || [];
  const topic = ppl.find((x) => x.topics && x.topics[0] && x.topics[0].length >= 4);
  const ideas = ["이번 달 기한이 있는 일은?", `${nextMonth}월에 할 일 알려줘`,
    ppl[0] ? `${ppl[0].name} 연락처` : null,
    topic ? `${topic.topics[0].replace(/^\[[^\]]*\]\s*/, "").slice(0, 14)} 누구랑 협의해?` : null,
    "양식이나 자료는 어디에 있어?", "가장 주의해야 할 점은?"].filter(Boolean);
  const who = (p.from_name || "전임자").replace(/\s*(주무관|사무관|서기관|팀장|과장|님)$/, "");
  const avatar = () => h("div", { class: "avatar", title: "실제 본인이 아닌, 자료로만 답하는 AI" }, "🎭");
  for (const log of (p.qa_log || []).slice(-6)) addPair(log.q, log);
  if (!(p.qa_log || []).length) chat.append(h("div", { class: "msg-row" }, avatar(), h("div", { class: "msg ai" }, h("b", {}, `AI ${who}`), h("br"),
    `안녕하세요, ${who}의 업무 자료와 인터뷰 답변으로만 답하는 AI 분신이에요. 제 자료에 없는 건 지어내지 않고, 진짜 ${who} 님께 질문을 넘겨 드릴게요.`)));
  function addPair(q, res) {
    chat.append(h("div", { class: "msg me" }, q));
    const intro = !res.found ? `그건 제 자료에 없어요. 진짜 ${who} 님께 물어봐야 해요.`
      : res.mode === "calendar" ? "제 업무 달력을 보면요," : res.mode === "people" ? "제 연락망에 이렇게 남아 있어요." : "제 자료에 이렇게 남아 있어요.";
    // 엔진 답의 첫 안내 줄(‘…찾았습니다’, ‘…할 일입니다’)은 분신 말투로 바꿨으므로 뺀다
    const body = res.found ? res.answer.replace(/^(자료에서 찾은 관련 내용입니다\.|연락망에서 찾았습니다\.|\d+월에 할 일입니다\.)\n?/, "") : "";
    const ai = h("div", { class: "msg ai" }, h("b", {}, `AI ${who}`), h("span", { class: "tiny muted" }, " · 근거 기반 답변"), h("br"), intro, body ? "\n" + body : "", h("div", {}, srcChips(res.sources, q)));
    const row = h("div", { class: "msg-row" }, avatar(), ai);
    if (!res.found) ai.append(h("div", { style: "margin-top:8px" }, h("button", { class: "btn sm", onclick: async (e) => {
      await api(`/api/projects/${p.id}/questions`, { method: "POST", json: { q } }); e.target.disabled = true; e.target.textContent = "✓ 전임자에게 보냈어요(③ 인터뷰에 표시)";
    } }, `🙋 진짜 ${who} 님께 이 질문 보내기`)));
    chat.append(row); chat.scrollTop = chat.scrollHeight;
  }
  async function send(text) {
    const q = (text || input.value).trim(); if (!q) return;
    input.value = ""; sends.disabled = true;
    const wait = h("div", { class: "msg ai" }, h("span", { class: "spin" }), ` AI ${who}가 자료를 찾는 중…`);
    chat.append(wait);
    try { const res = await api(`/api/projects/${p.id}/ask`, { method: "POST", json: { question: q } }); wait.remove(); addPair(q, res); }
    catch { wait.remove(); } finally { sends.disabled = false; input.focus(); }
  }
  const mine = p.draft.questions.filter((q) => q.asked_by === "successor");
  add(el, h("div", { class: "grid", style: "grid-template-columns:minmax(0,2fr) minmax(0,1fr)" },
    h("div", { class: "card" }, chat, h("div", { class: "suggest" }, ideas.map((t) => h("button", { class: "btn sm", onclick: () => send(t) }, t))),
      h("div", { class: "row" }, h("div", { class: "grow" }, input), sends)),
    h("div", { class: "card" }, h("h3", {}, "🙋 전임자에게 보낸 질문"),
      mine.length ? mine.map((q) => h("div", { class: "small", style: "margin-bottom:8px" }, h("b", {}, "Q. "), q.q,
        q.answer ? h("div", { class: "alert ok", style: "margin:4px 0" }, "A. " + q.answer) : h("div", { class: "tiny muted" }, "답변 대기 중")))
        : h("div", { class: "small muted" }, "자료로 답을 못 찾으면 여기에 쌓이고, 전임자의 ③ 인터뷰 화면에 나타납니다."))));
}

// ⑦ 첫 30일
async function tabPlan(el, p) {
  const plan = await api(`/api/projects/${p.id}/plan`);
  const key = `plan.${p.id}`;
  const done = store.get(key, {});
  const check = (id, title, hint, sources) => h("label", { class: "check" },
    h("input", { type: "checkbox", checked: !!done[id], onchange: (e) => { done[id] = e.target.checked; store.set(key, done); } }),
    h("div", {}, h("div", {}, title), hint ? h("div", { class: "tiny muted" }, hint) : null, h("div", {}, srcChips(sources, title))));
  add(el, h("div", { class: "alert info row between" }, h("span", {}, `📅 기준일 ${plan.base} 부터 60일 안에 다가오는 일정과 첫 주에 할 일입니다. 체크 표시는 이 브라우저에 저장됩니다.`),
      h("span", { class: "row" }, h("a", { class: "btn primary sm", href: `/api/projects/${p.id}/export?fmt=hwpx&doc=manual` }, "📘 업무매뉴얼 한글로 받기"),
        h("a", { class: "btn sm", href: `/api/projects/${p.id}/export?fmt=docx&doc=manual` }, "Word"))),
    h("div", { class: "grid g2" },
      h("div", { class: "card" }, h("h2", {}, "다가오는 일정"),
        plan.timeline.length ? h("div", { class: "tl" }, plan.timeline.map((t) => h("div", { class: "tl-item" + (t.deadline ? " deadline" : "") },
          h("div", {}, h("span", { class: "dday" }, t.dday === 0 ? "D-day" : `D-${t.dday}`), h("span", { class: "small muted" }, t.date + (t.approx ? " (대략)" : "") + (t.deadline ? " · 기한" : ""))),
          h("div", {}, t.title.replace(/^\[[^\]]*\]\s*/, "")), h("div", {}, srcChips(t.sources, t.title))))) : h("div", { class: "muted" }, "60일 안의 일정이 없습니다.")),
      h("div", {},
        h("div", { class: "card", style: "margin-bottom:14px" }, h("h2", {}, "첫 주 체크리스트"),
          plan.week1.map((w, i) => check("w" + i, `[${w.type}] ${w.title}`, w.hint, w.sources))),
        h("div", { class: "card", style: "margin-bottom:14px" }, h("h2", {}, "매월 반복 업무"),
          plan.routines.length ? plan.routines.map((r, i) => check("r" + i, r.title, "", r.sources)) : h("div", { class: "muted small" }, "없음")),
        h("div", { class: "card" }, h("h2", {}, "먼저 읽을 자료"),
          plan.reading.map((r, i) => check("d" + i, r.file, r.kind, []))))));
}

// ⑧ 바통 터치
function tabHandover(el, p) {
  const d = p.draft, hd = p.handover || {};
  const live = d.sections.flatMap((s) => s.items).filter((i) => !["deleted", "unsupported"].includes(i.status));
  const verified = live.filter((i) => ["verified", "edited"].includes(i.status)).length;
  const qa = d.questions.filter((q) => q.status === "answered").length;
  const conflicts = d.sections.flatMap((s) => s.items).filter((i) => i.meta && i.meta.type === "conflict");
  const resolved = conflicts.filter((i) => i.meta.resolved).length;
  const ready = verified / Math.max(1, live.length) >= 0.5;
  const sign = async (role, cancel) => {
    await api(`/api/projects/${p.id}/handover`, { method: "POST", json: { role, cancel, name: role === "from" ? p.from_name : p.to_name } });
    if (!cancel && role === "to") toast("🏃 바통 터치 완료! 인수인계가 끝났습니다", 3500);
    route();
  };
  const both = hd.from_signed_at && hd.to_signed_at;
  const baton = h("div", { class: "baton" + (both ? " go" : "") }, svg("svg", { viewBox: "0 0 48 24", width: 48, height: 24 },
    svg("rect", { x: 2, y: 6, width: 44, height: 12, rx: 6, fill: "#2563eb" }), svg("rect", { x: 18, y: 6, width: 12, height: 12, fill: "#f59e0b" })));
  add(el, 
    h("div", { class: "grid g4" }, stat(`${Math.round(100 * verified / Math.max(1, live.length))}%`, `검수 완료 (${verified}/${live.length})`),
      stat(`${qa}/${d.questions.length}`, "인터뷰 답변"), stat(`${resolved}/${conflicts.length}`, "불일치 해소"), stat(p.integrity && p.integrity.ok ? "보존" : "확인 필요", "원본 무결성")),
    lineageCard(p),
    h("div", { class: "card", style: "margin-top:14px" },
      h("h2", {}, "바통 터치"),
      !ready ? h("div", { class: "alert warn" }, "검수율이 50% 미만입니다. 전임자 확인 전에 ② 초안 검수를 더 진행하는 것을 권장합니다.") : null,
      h("div", { class: "baton-stage" },
        h("div", { class: "runner" + (hd.from_signed_at ? " signed" : "") }, h("div", { style: "font-size:30px" }, "🏃"), h("b", {}, p.from_name || "전임자"),
          h("div", { class: "tiny muted" }, hd.from_signed_at ? `확인 ${hd.from_signed_at}` : "인계 전"),
          hd.from_signed_at ? h("button", { class: "btn sm", onclick: () => sign("from", true) }, "확인 취소") : h("button", { class: "btn primary sm", onclick: () => sign("from") }, "내용 확인 · 인계")),
        h("div", { class: "track" }, baton),
        h("div", { class: "runner" + (hd.to_signed_at ? " signed" : "") }, h("div", { style: "font-size:30px;transform:scaleX(-1)" }, "🏃"), h("b", {}, p.to_name || "후임자"),
          h("div", { class: "tiny muted" }, hd.to_signed_at ? `수령 ${hd.to_signed_at}` : "인수 전"),
          hd.to_signed_at ? h("button", { class: "btn sm", onclick: () => sign("to", true) }, "수령 취소") : h("button", { class: "btn ok sm", disabled: !hd.from_signed_at, onclick: () => sign("to") }, "인수인계서 수령"))),
      both ? h("div", { class: "alert ok" }, "✅ 인계·인수가 모두 확인되었습니다. 아래에서 인수인계서를 내려받아 결재에 첨부하세요.") : null),
    h("div", { class: "card", style: "margin-top:14px" }, h("h2", {}, "인수인계서 내보내기"),
      h("p", { class: "small muted" }, "삭제·근거없음 항목은 빠지고 모든 줄에 근거 번호와 출처 목록이 붙습니다. 업무매뉴얼은 첫 주 할 일·월별 달력·기한순 현안·연락망·노하우·용어 풀이를 담습니다."),
      h("div", { class: "row" },
        h("b", { style: "min-width:120px" }, "인수인계서"),
        h("a", { class: "btn primary", href: `/api/projects/${p.id}/export?fmt=hwpx` }, "📄 한글(.hwpx)"),
        h("a", { class: "btn", href: `/api/projects/${p.id}/export?fmt=docx` }, "Word(.docx)"),
        h("a", { class: "btn", href: `/api/projects/${p.id}/export?fmt=html`, target: "_blank" }, "🖨 인쇄(PDF 저장)"),
        h("a", { class: "btn", href: `/api/projects/${p.id}/export?fmt=md` }, "Markdown")),
      h("div", { class: "row", style: "margin-top:8px" },
        h("b", { style: "min-width:120px" }, "후임자 업무매뉴얼"),
        h("a", { class: "btn primary", href: `/api/projects/${p.id}/export?fmt=hwpx&doc=manual` }, "📘 한글(.hwpx)"),
        h("a", { class: "btn", href: `/api/projects/${p.id}/export?fmt=docx&doc=manual` }, "Word(.docx)"),
        h("a", { class: "btn", href: `/api/projects/${p.id}/export?fmt=md&doc=manual` }, "Markdown"),
        h("a", { class: "btn", href: `/api/projects/${p.id}/export?fmt=ics` }, "📅 업무 달력(.ics)"))),
    h("div", { class: "card relay-card", style: "margin-top:14px" }, h("h2", {}, "🧬 다음 주자를 위한 바통 파일"),
      h("p", { class: "small muted" }, `${p.to_name || "후임자"} 님도 언젠가 이 업무를 넘기게 됩니다. 검수된 내용과 인터뷰 답변을 .baton 파일로 저장해 두면, 다음 인수인계 때 자료 폴더에 넣기만 해도 근거로 이어지고 담당자 계보가 쌓입니다.`),
      h("a", { class: "btn primary", href: `/api/projects/${p.id}/export?fmt=baton` }, "🧬 바통 파일(.baton) 내려받기")),
    h("div", { class: "card", style: "margin-top:14px" }, h("h2", {}, "처리 이력"),
      h("table", { class: "tbl" }, h("tr", {}, h("th", {}, "일시"), h("th", {}, "누가"), h("th", {}, "무엇을"), h("th", {}, "대상")),
        (p.audit || []).slice(-25).reverse().map((a) => h("tr", {}, h("td", { class: "small" }, a.at), h("td", {}, a.who), h("td", {}, a.action), h("td", { class: "small muted" }, a.detail))))),
    h("div", { class: "row", style: "justify-content:flex-end;margin-top:14px" }, h("button", { class: "btn", style: "color:var(--bad)", onclick: async () => {
      if (!confirm("이 인수인계 건과 작업 폴더의 산출물을 삭제할까요? (원본 자료는 지워지지 않습니다)")) return;
      await api(`/api/projects/${p.id}`, { method: "DELETE" }); location.hash = "#/";
    } }, "이 인수인계 건 삭제")));
}

// ───────────── 설정
async function viewSettings() {
  const r = await api("/api/settings");
  const s = r.settings, tpl = r.template;
  const profiles = s.llm.profiles;
  const results = h("div");
  const keys = {};
  const rows = Object.entries(profiles).map(([name, pr]) => {
    const fields = {};
    const tr = h("tr", {},
      h("td", {}, h("input", { type: "radio", name: "active", value: name, checked: s.llm.active === name })),
      h("td", {}, h("b", {}, pr.label || name), h("div", { class: "tiny muted" }, name)),
      h("td", {}, pr.type === "offline" ? h("span", { class: "muted small" }, "LLM 없이 규칙엔진만 사용") :
        h("div", { class: "grid", style: "gap:4px" },
          h("div", { class: "row", style: "flex-wrap:nowrap" },
            fields.type = h("select", { style: "width:auto", title: "연결 방식" },
              h("option", { value: "openai", selected: pr.type !== "ollama" }, "OpenAI 호환"), h("option", { value: "ollama", selected: pr.type === "ollama" }, "Ollama 기본")),
            fields.base_url = h("input", { value: pr.base_url || "", placeholder: "http://localhost:11434/v1" })),
          h("div", { class: "row", style: "flex-wrap:nowrap" },
            fields.model = h("input", { value: pr.model || "", placeholder: "모델 이름", list: "ml-" + name }),
            h("datalist", { id: "ml-" + name }),
            h("button", { class: "btn sm", title: "서버에 실제 등록된 모델 이름 불러오기", onclick: async (e) => {
              const r = await api("/api/llm/models", { method: "POST", json: { base_url: fields.base_url.value, type: fields.type.value } });
              const dl = document.getElementById("ml-" + name); dl.replaceChildren(...r.models.map((m) => h("option", { value: m })));
              toast(`모델 ${r.models.length}개: ${r.models.slice(0, 6).join(", ")}${r.models.length > 6 ? " …" : ""}`, 4000);
              fields.model.focus();
            } }, "목록")),
          keys[name] = h("input", { type: "password", placeholder: pr.has_key ? "API 키 저장됨(바꾸려면 입력)" : (pr.api_key_env ? `API 키 또는 환경변수 ${pr.api_key_env}` : "API 키(로컬 모델은 비워 둠)") }))),
      h("td", {}, h("button", { class: "btn sm", onclick: () => check([name]) }, "자가진단")));
    tr._fields = fields; tr._name = name;
    return tr;
  });
  async function save(silent) {
    const active = (document.querySelector("input[name=active]:checked") || {}).value;
    const prof = {};
    for (const tr of rows) {
      const pr = { ...profiles[tr._name] }; delete pr.has_key;
      if (tr._fields.base_url) { pr.base_url = tr._fields.base_url.value.trim(); pr.model = tr._fields.model.value.trim(); pr.type = tr._fields.type.value; }
      if (keys[tr._name] && keys[tr._name].value) pr.api_key = keys[tr._name].value;
      prof[tr._name] = pr;
    }
    tplSync();
    await api("/api/settings", { method: "POST", json: { llm: { active, profiles: prof }, org: { ...s.org, name: org.name.value, dept: org.dept.value }, template: tpl } });
    await loadInfo();
    if (!silent) toast("저장했습니다");
  }
  async function check(names) {
    await save(true);
    results.replaceChildren(h("div", { class: "muted" }, h("span", { class: "spin" }), ` ${names.length}개 모델 진단 중… (모델이 크면 1~2분 걸릴 수 있음)`));
    const res = await api("/api/llm/check", { method: "POST", json: { profiles: names } });
    results.replaceChildren(h("table", { class: "tbl" }, h("tr", {}, h("th", {}, "모델"), h("th", {}, "결과"), h("th", {}, "세부 시험")),
      res.results.map((x) => h("tr", {}, h("td", {}, x.label || x.profile, x.family ? h("div", { class: "tiny muted" }, x.family) : null), h("td", {}, x.ok ? h("span", { class: "ok-t" }, "✔ 정상") : h("span", { class: "bad-t" }, "✖ 실패")),
        h("td", { class: "small" }, x.tests.map((t) => h("div", {}, t.ok ? "✔ " : "✖ ", h("b", {}, t.name), t.sec != null ? ` (${t.sec}초) ` : " ", h("span", { class: "muted" }, t.detail))))))),
      h("p", { class: "tiny muted" }, `진단 시각 ${res.at} – 이 표를 캡처하면 ‘2종 이상 모델 정상 구동’ 입증 자료로 쓸 수 있습니다.`));
  }
  const org = { name: h("input", { value: s.org.name || "" }), dept: h("input", { value: s.org.dept || "" }) };
  // 양식 편집
  const tplBox = h("div");
  function tplSync() {
    tplBox.querySelectorAll("[data-i]").forEach((row) => {
      const sct = tpl.sections[+row.dataset.i];
      sct.title = row.querySelector(".t").value; sct.guide = row.querySelector(".g").value; sct.enabled = row.querySelector(".e").checked;
      const kw = row.querySelector(".k"); if (kw) sct.keywords = kw.value.split(",").map((x) => x.trim()).filter(Boolean);
    });
    tpl.title = $("#tplTitle") ? $("#tplTitle").value : tpl.title;
  }
  function drawTpl() {
    tplBox.replaceChildren(h("div", {}, h("label", { class: "f" }, "문서 제목"), h("input", { id: "tplTitle", value: tpl.title || "" }),
      tpl.sections.map((sc, i) => h("div", { "data-i": i, class: "row", style: "border-top:1px solid var(--line);padding:8px 0" },
        h("input", { type: "checkbox", class: "e", checked: sc.enabled !== false, title: "사용" }),
        h("div", { class: "grow grid", style: "gap:4px" }, h("input", { class: "t", value: sc.title }), h("input", { class: "g", value: sc.guide || "", placeholder: "설명" }),
          sc.kind === "custom" ? h("input", { class: "k", value: (sc.keywords || []).join(", "), placeholder: "키워드(쉼표로 구분)" }) : h("span", { class: "tiny muted" }, `기본 항목(${sc.kind})`)),
        h("div", { class: "grid", style: "gap:2px" },
          h("button", { class: "btn sm", onclick: () => { tplSync(); if (i > 0) [tpl.sections[i - 1], tpl.sections[i]] = [tpl.sections[i], tpl.sections[i - 1]]; drawTpl(); } }, "▲"),
          h("button", { class: "btn sm", onclick: () => { tplSync(); if (i < tpl.sections.length - 1) [tpl.sections[i + 1], tpl.sections[i]] = [tpl.sections[i], tpl.sections[i + 1]]; drawTpl(); } }, "▼"),
          sc.kind === "custom" ? h("button", { class: "btn sm", onclick: () => { tplSync(); tpl.sections.splice(i, 1); drawTpl(); } }, "✕") : null))),
      h("button", { class: "btn sm", style: "margin-top:8px", onclick: () => { tplSync(); tpl.sections.push({ id: "custom_" + Date.now().toString(36), kind: "custom", title: "새 항목", guide: "", enabled: true, keywords: [] }); drawTpl(); } }, "+ 기관 고유 항목 추가")));
  }
  drawTpl();
  mount(h("h1", {}, "설정"),
    h("div", { class: "card", style: "margin-bottom:14px" },
      h("div", { class: "row between" }, h("h2", {}, "AI 모델 (교체 가능)"),
        h("div", { class: "row" }, h("button", { class: "btn", onclick: () => check(Object.keys(profiles)) }, "전체 모델 자가진단"), h("button", { class: "btn primary", onclick: () => save() }, "저장"))),
      h("p", { class: "small muted" }, "OpenAI 호환 API를 쓰는 모든 모델을 연결할 수 있습니다. Ollama·vLLM으로 내부망에 띄운 Gemma·EXAONE·Llama·GPT-OSS, 또는 HyperCLOVA X·Solar API. 모델이 없거나 연결이 끊겨도 규칙엔진으로 기본 기능이 동작합니다."),
      h("table", { class: "tbl" }, h("tr", {}, h("th", {}, "사용"), h("th", {}, "프로필"), h("th", {}, "연결 정보"), h("th", {}, "")), rows),
      h("div", { style: "margin-top:12px" }, results)),
    h("div", { class: "grid g2" },
      h("div", { class: "card" }, h("h2", {}, "기관 정보"), h("label", { class: "f" }, "기관명"), org.name, h("label", { class: "f" }, "부서명"), org.dept,
        h("p", { class: "tiny muted" }, "프롬프트 문구는 config/prompts 폴더의 텍스트 파일을 고치면 바로 반영됩니다.")),
      h("div", { class: "card" }, h("h2", {}, "인수인계서 양식"), h("p", { class: "small muted" }, "기관 양식에 맞게 항목 이름·순서를 바꾸고, 키워드로 기관 고유 항목을 추가하세요. 다음 초안부터 적용됩니다."), tplBox,
        h("div", { class: "row", style: "justify-content:flex-end;margin-top:10px" }, h("button", { class: "btn primary", onclick: () => save() }, "저장")))));
}
