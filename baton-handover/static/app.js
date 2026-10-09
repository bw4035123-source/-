"use strict";
let H = null;          // 현재 인수인계 건
let pickedFiles = [];
const CTX = () => `/api/handovers/${H.id}/context`;

const SEC = {
  rnr: { title: "담당 업무(R&R)", cols: [{ k: "duty", l: "담당 업무" }, { k: "detail", l: "세부 내용·메모" }] },
  schedule: { title: "연간 업무 일정", cols: [{ k: "months", l: "월", t: "months" }, { k: "day", l: "일", t: "num" }, { k: "task", l: "할 일" }, { k: "related", l: "관련" }] },
  contacts: { title: "협의 연락망", cols: [{ k: "name", l: "이름" }, { k: "org", l: "소속" }, { k: "title", l: "직위" }, { k: "phones", l: "연락처", t: "list" }, { k: "emails", l: "메일", t: "list" }, { k: "topics", l: "협의 업무", t: "list" }] },
  issues: { title: "진행 중인 현안", cols: [{ k: "title", l: "현안" }, { k: "state", l: "상태" }, { k: "next_action", l: "다음 할 일" }, { k: "due", l: "기한" }] },
};
const STATUS_TAG = { "초안": "gray", "확인": "ok", "수정": "info", "추가": "info", "삭제": "bad" };

// ------------------------------------------------------------ 자료 넣기
function setupStart() {
  $$("input[name=src]").forEach(r => r.addEventListener("change", () => {
    $$(".src-box").forEach(b => b.hidden = b.id !== "src-" + r.value);
  }));
  $("#pick-folder").onclick = () => $("#in-folder").click();
  $("#pick-files").onclick = () => $("#in-files").click();
  const setPicked = files => {
    pickedFiles = [...files];
    $("#picked").textContent = pickedFiles.length ? `${pickedFiles.length}개 파일 선택됨` : "";
  };
  $("#in-folder").onchange = e => setPicked(e.target.files);
  $("#in-files").onchange = e => setPicked(e.target.files);
  const drop = $("#drop");
  drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", async e => { e.preventDefault(); drop.classList.remove("over"); setPicked(await filesFromDrop(e)); });
  $("#create").onclick = async () => {
    const kind = $("input[name=src]:checked").value;
    const source = { kind };
    if (kind === "upload") {
      if (!pickedFiles.length) return toast("폴더나 파일을 먼저 선택해 주세요", true);
      source.files = await readFiles(pickedFiles);
    } else if (kind === "local") source.path = $("#local-path").value.trim();
    else if (kind === "docsystem") { source.base_url = $("#ds-url").value.trim(); source.owner = $("#ds-owner").value.trim(); }
    const btn = $("#create");
    busy(btn, true, "자료를 읽고 분석하는 중");
    try {
      const h = await api("POST", "/api/handovers", { source, predecessor: $("#pred").value, successor: $("#succ").value, title: $("#title").value });
      toast("초안을 만들었습니다");
      await refreshList(h.id);
      goTab("draft");
    } finally { busy(btn, false); }
  };
}

async function refreshList(selectId) {
  const { handovers } = await api("GET", "/api/handovers");
  const sel = $("#cur-h");
  sel.innerHTML = "";
  if (!handovers.length) sel.append(el("option", { value: "" }, "인수인계 건 없음"));
  handovers.forEach(h => sel.append(el("option", { value: h.id }, `${h.title}`)));
  const list = $("#h-list");
  list.innerHTML = "";
  if (!handovers.length) list.append(el("div", { class: "empty" }, "아직 없습니다. 왼쪽에서 자료를 넣어 시작하세요. 처음이면 '시연용 모의자료'를 골라 보세요."));
  else list.append(el("table", { class: "t" },
    el("tr", {}, el("th", {}, "제목"), el("th", {}, "전임자"), el("th", {}, "상태"), el("th", {}, "만든 시각"), el("th", {}, "")),
    handovers.map(h => el("tr", {},
      el("td", {}, el("a", { href: "#", onclick: e => { e.preventDefault(); select(h.id); goTab("draft"); } }, h.title)),
      el("td", {}, h.predecessor || "-"),
      el("td", {}, el("span", { class: "tag " + (h.confirmed ? "ok" : "warn") }, h.confirmed ? "전임자 확인 완료" : "검토 중")),
      el("td", { class: "small muted" }, h.created),
      el("td", {}, el("button", { class: "small danger", onclick: async () => {
        if (!confirm("이 인수인계 건(작업 사본)을 지울까요? 원본 자료는 지워지지 않습니다.")) return;
        await api("DELETE", `/api/handovers/${h.id}`); if (H && H.id === h.id) H = null; refreshList();
      } }, "삭제"))))));
  const id = selectId || (H && H.id) || (handovers[0] && handovers[0].id);
  if (id) await select(id); else { H = null; renderAll(); }
}

async function select(id) {
  H = await api("GET", `/api/handovers/${id}`);
  $("#cur-h").value = id;
  $("#m-name").value = H.successor || "";
  renderAll();
}
const predName = () => (H && H.draft.predecessor) || "전임자";
function renderAvatarHead() {
  const n = predName();
  $("#ask-tab").textContent = `③ AI ${n}에게 묻기`;
  $("#av-init").textContent = n.slice(0, 1);
  $("#av-title").textContent = `AI ${n}에게 묻기`;
  $("#av-sub").textContent = `${n} 님 본인이 아니라, ${n} 님이 남긴 자료와 답변으로만 답하는 AI 분신입니다. 자료에 없는 건 지어내지 않고 진짜 ${n} 님께 질문을 넘깁니다.`;
}

function needH(sec) {
  if (H) return false;
  sec.innerHTML = "";
  sec.append(el("div", { class: "empty" }, "먼저 ① 자료 넣기에서 인수인계 건을 만들거나 선택하세요."));
  return true;
}

// ------------------------------------------------------------ 초안·검토
function cellValue(it, c) {
  const v = it[c.k];
  if (c.t === "months") return it.recurring === "매월" ? "매월" : (v || []).join(", ");
  if (c.t === "list") return (v || []).join(", ");
  return v ?? "";
}
function parseCell(c, text) {
  text = text.trim();
  if (c.t === "months") return text === "매월" ? [1,2,3,4,5,6,7,8,9,10,11,12] : text.split(/[,\s]+/).map(Number).filter(n => n >= 1 && n <= 12);
  if (c.t === "list") return text ? text.split(/\s*,\s*/) : [];
  if (c.t === "num") return text ? Number(text) || null : null;
  return text;
}

function renderSection(key) {
  const S = SEC[key];
  const items = H.draft.sections[key];
  const wrap = el("div", { class: "panel" });
  wrap.append(el("div", { class: "row" }, el("h2", { style: { flex: 1, margin: 0 } }, `${S.title} (${items.filter(i => i.status !== "삭제").length})`),
    el("button", { class: "small", onclick: () => addItem(key) }, "+ 직접 추가")));
  const tbl = el("table", { class: "t", style: { marginTop: "8px" } });
  tbl.append(el("tr", {}, S.cols.map(c => el("th", {}, c.l)), el("th", {}, "근거(출처)"), el("th", {}, "검토"), el("th", {}, "")));
  for (const it of items) {
    const tr = el("tr", { style: it.status === "삭제" ? { opacity: .45, textDecoration: "line-through" } : {} });
    for (const c of S.cols) {
      const td = el("td", { contenteditable: H.review.confirmed ? null : "true" }, String(cellValue(it, c)));
      td.addEventListener("blur", async () => {
        const nv = parseCell(c, td.textContent);
        if (JSON.stringify(nv) === JSON.stringify(it[c.k] ?? (c.t === "list" || c.t === "months" ? [] : ""))) return;
        const upd = { id: it.id, [c.k]: nv };
        if (c.t === "months") upd.recurring = td.textContent.trim() === "매월" ? "매월" : (it.recurring === "매월" ? "" : it.recurring);
        const saved = await api("POST", `/api/handovers/${H.id}/item`, { section: key, item: upd });
        Object.assign(it, saved); tr.querySelector(".st").replaceWith(statusTag(it));
      });
      tr.append(td);
    }
    tr.append(el("td", {}, citeChips(it.sources, CTX()), (it.origin || []).includes("개인메모") ? el("span", { class: "tag warn", title: "개인메모에서 나온 내용" }, "메모") : null,
      carriedTag(it),
      key === "schedule" ? schedTags(it) : null));
    tr.append(el("td", {}, statusTag(it)));
    tr.append(el("td", { style: { whiteSpace: "nowrap" } },
      H.review.confirmed ? null : el("button", { class: "small", title: "내용이 맞음", onclick: async () => {
        Object.assign(it, await api("POST", `/api/handovers/${H.id}/item`, { section: key, item: { id: it.id }, confirm: true }));
        tr.querySelector(".st").replaceWith(statusTag(it));
      } }, "확인"),
      H.review.confirmed ? null : el("button", { class: "small danger", onclick: async () => {
        Object.assign(it, await api("POST", `/api/handovers/${H.id}/item/delete`, { section: key, id: it.id })); renderDraft();
      } }, it.status === "삭제" ? "되살리기" : "삭제")));
    tbl.append(tr);
  }
  if (!items.length) tbl.append(el("tr", {}, el("td", { colspan: S.cols.length + 3, class: "muted" }, "자료에서 찾지 못했습니다. '직접 추가'로 보완하세요.")));
  wrap.append(tbl);
  return wrap;
}
// 일정 시기 표시: 완료·지난 일·기한 지남, 대략적인 시기, 다른 해
const TIMING_TAG = { "완료": "gray", "지난 일": "gray", "기한 지남": "bad" };
function baseYear() { return Number(((H && H.draft.today) || new Date().toISOString()).slice(0, 4)); }
function schedTags(it) {
  return [it.timing ? el("span", { class: "tag " + (TIMING_TAG[it.timing] || "gray"), title: "오늘 기준" }, it.timing) : null,
    it.approx ? el("span", { class: "tag info", title: it.when || "" }, "시기 대략") : null,
    it.year && it.year !== baseYear() ? el("span", { class: "tag info" }, `${it.year}년`) : null];
}
function carriedTag(it) {
  const c = it.carried;
  return c ? el("span", { class: "tag ok", title: `${c.gen}대 담당자 ${c.name}의 인수인계서(바통 파일)에서 이어받은 항목` }, `이어받음 · ${c.gen}대 ${c.name}`) : null;
}
function statusTag(it) { return el("span", { class: "st tag " + (STATUS_TAG[it.status] || "gray") }, it.status || "초안"); }

async function addItem(key) {
  const S = SEC[key];
  const inputs = {};
  const body = el("div", {}, S.cols.map(c => [el("label", { class: "f" }, c.l + (c.t === "months" ? " (예: 3 또는 3, 9 또는 매월)" : c.t === "list" ? " (쉼표로 구분)" : "")),
    inputs[c.k] = el("input", { class: "wide" })]));
  const m = modal(`${S.title} 직접 추가`, body, el("div", { class: "row", style: { marginTop: "10px" } }, el("button", { class: "primary", onclick: async () => {
    const item = {};
    S.cols.forEach(c => item[c.k] = parseCell(c, inputs[c.k].value));
    if (key === "schedule" && inputs.months.value.trim() === "매월") item.recurring = "매월";
    await api("POST", `/api/handovers/${H.id}/item`, { section: key, item });
    m.remove(); H = await api("GET", `/api/handovers/${H.id}`); renderDraft();
  } }, "추가")));
}

function renderDraft() {
  const sec = $("#tab-draft");
  if (needH(sec)) return;
  sec.innerHTML = "";
  const d = H.draft, rv = H.review || {};
  const cnt = k => d.sections[k].filter(i => i.status !== "삭제").length;
  const open = d.flags.filter(f => !f.resolved).length;
  const waiting = (H.questions || []).filter(q => q.status === "대기");
  sec.append(el("div", { class: "panel" },
    el("div", { class: "row" },
      el("h2", { style: { flex: 1, margin: 0 } }, H.title),
      rv.confirmed ? el("span", { class: "stamp", title: `전임자 확인 완료 · ${rv.by || ""} · ${rv.at || ""}`, role: "img", "aria-label": "전임자 확인 완료" },
        el("b", {}, "확인"), el("small", {}, rv.by || "전임자"), el("small", {}, (rv.at || "").slice(0, 10).replace(/-/g, ".")))
        : el("span", { class: "tag warn" }, "검토 중(초안)")),
    el("p", { class: "small muted" }, `전임자: ${d.predecessor || "-"} · 후임자: ${H.successor || "-"} · 작성 방식: ${d.engine} · 분석 ${d.seconds}초 · 자료 ${d.docs.length}건`),
    el("div", { class: "grid3", style: { gridTemplateColumns: "repeat(6,1fr)" } },
      ...[["담당업무", cnt("rnr")], ["일정", cnt("schedule")], ["연락처", cnt("contacts")], ["현안", cnt("issues")], ["확인 필요", open], ["후임자 질문 대기", waiting.length]]
        .map(([a, b]) => el("div", { class: "stat" }, el("b", {}, b), a))),
    el("h3", {}, "업무 개요"), el("p", { style: { whiteSpace: "pre-wrap" } }, d.overview),
    d.filtered && d.filtered.length ? el("details", {}, el("summary", { class: "small" }, `모델 결과 중 원문과 맞지 않아 버린 항목 ${d.filtered.reduce((n, f) => n + (f.count || 1), 0)}건`),
      el("ul", { class: "small" }, d.filtered.map(f => el("li", {}, `[${SEC[f.section] ? SEC[f.section].title : f.section}] ${f.label || "(이름 없음)"}${(f.count || 1) > 1 ? ` (${f.count}회)` : ""} — ${f.reason} `, citeChips(f.sources || [], CTX()))))) : null,
    d.llm_errors && d.llm_errors.length ? el("details", {}, el("summary", { class: "small" }, `모델 처리 경고 ${d.llm_errors.length}건 (해당 부분은 규칙 기반 결과 사용)`), el("pre", { class: "doc small" }, d.llm_errors.join("\n"))) : null,
    H.skipped && H.skipped.length ? el("details", {}, el("summary", { class: "small" }, `읽지 못한 파일 ${H.skipped.length}개`), el("ul", { class: "small" }, H.skipped.map(s => el("li", {}, `${s.file}: ${s.reason}`)))) : null,
    el("div", { class: "row", style: { marginTop: "10px" } },
      el("span", { class: "small muted" }, "인수인계서 내려받기:"), exportButtons(`/api/handovers/${H.id}/export/handover`),
      el("span", { class: "spacer", style: { flex: 1 } }),
      rv.confirmed
        ? el("button", { onclick: async () => { H = await api("POST", `/api/handovers/${H.id}/review`, { confirmed: false }); renderAll(); } }, "확인 취소(다시 수정)")
        : el("button", { class: "primary", onclick: async () => {
            const by = prompt("확인자(전임자) 이름", d.predecessor || "");
            if (by === null) return;
            if (open && !confirm(`확인 필요 사항이 ${open}건 남아 있습니다. 그래도 확인 완료할까요?`)) return;
            H = await api("POST", `/api/handovers/${H.id}/review`, { confirmed: true, by }); renderAll(); toast("전임자 확인을 완료했습니다. 후임자가 바로 활용할 수 있습니다.");
          } }, "전임자 확인 완료"))));
  if (waiting.length || (H.questions || []).length) sec.append(renderInbox());
  sec.append(renderRelay());
  if (!rv.confirmed) sec.append(el("p", { class: "small muted" }, "표의 내용을 눌러 바로 고칠 수 있습니다. 맞는 항목은 '확인', 틀린 항목은 '삭제'를 누르세요. 근거 칩을 누르면 원문 위치가 보입니다."));
  ["issues", "schedule", "contacts", "rnr"].forEach(k => sec.append(renderSection(k)));
  const memo = el("textarea", { placeholder: "후임자에게 남길 말, 자료에 없는 노하우를 적어 주세요" });
  sec.append(el("div", { class: "panel" }, el("h2", {}, "전임자 메모"),
    el("ul", {}, (rv.comments || []).map(c => el("li", {}, el("span", { class: "small muted" }, c.at + " "), c.text))),
    memo, el("button", { style: { marginTop: "6px" }, onclick: async () => {
      if (!memo.value.trim()) return;
      H = await api("POST", `/api/handovers/${H.id}/review`, { comment: memo.value.trim() }); renderDraft();
    } }, "메모 저장")));
}

// 전임자 화면: AI 분신이 답하지 못해 후임자가 넘긴 질문에 답하기
function renderInbox() {
  const qs = H.questions || [];
  const n = qs.filter(q => q.status === "대기").length;
  return el("div", { class: "panel", style: n ? { borderColor: "var(--brand)" } : {} },
    el("h2", {}, `후임자가 보낸 질문 ${n ? `(${n}건 답변 대기)` : ""}`),
    el("p", { class: "small muted" }, `AI ${predName()}(분신)이 자료에서 답을 찾지 못해 후임자가 넘긴 질문입니다. 답하면 이후 같은 질문에는 이 답으로 응답하고, 인수인계서와 바통 파일에도 남습니다.`),
    qs.map(q => {
      const ta = el("textarea", { placeholder: "답변을 적어 주세요", style: { width: "100%", minHeight: "56px" } }, q.answer || "");
      return el("div", { class: "panel", style: { padding: "10px" } },
        el("div", {}, el("span", { class: "tag " + (q.status === "대기" ? "warn" : "ok") }, q.status), " ", el("b", {}, q.q),
          el("span", { class: "small muted" }, ` · ${q.asked_by} · ${q.asked_at}`)),
        ta, el("button", { class: "small primary", style: { marginTop: "6px" }, onclick: async () => {
          if (!ta.value.trim()) return toast("답변을 입력해 주세요", true);
          await api("POST", `/api/handovers/${H.id}/questions/${q.id}/answer`, { answer: ta.value.trim() });
          H = await api("GET", `/api/handovers/${H.id}`); renderAll(); toast("답변을 저장했습니다. AI 분신도 이제 이 답으로 응답합니다.");
        } }, q.status === "대기" ? "답변 보내기" : "답변 고치기"));
    }));
}

// 지식 릴레이: 업무 계보와 바통 파일(.baton) 저장
function renderRelay() {
  const d = H.draft, lin = d.lineage || [];
  const gen = lin.length + 1;
  const card = (cls, g, name, sub) => el("span", { class: "gen " + cls }, el("b", {}, `${g}대 ${name}`), sub);
  const chain = [];
  lin.forEach((x, i) => { chain.push(card("", i + 1, x.name, x.date || "")); chain.push(el("span", { class: "arrow" }, "→")); });
  chain.push(card("now", gen, d.predecessor || "전임자", "지금 넘기는 중"));
  chain.push(el("span", { class: "arrow" }, "→"));
  chain.push(card("next", gen + 1, H.successor || "후임자", "이어받을 사람"));
  const carried = ["rnr", "schedule", "contacts", "issues"].reduce((n, k) => n + d.sections[k].filter(i => i.carried && i.status !== "삭제").length, 0);
  return el("div", { class: "panel" },
    el("div", { class: "row" }, el("h2", { style: { flex: 1, margin: 0 } }, "지식 릴레이 · 업무 계보"),
      el("button", { class: "primary", onclick: () => download(`/api/handovers/${H.id}/baton`, {}) }, "바통 파일로 저장(.baton)")),
    el("div", { class: "relay" }, chain),
    el("p", { class: "small muted" }, lin.length
      ? `${lin.length}대까지의 인수인계서를 이어받아 ${carried}개 항목, 질의응답 ${(d.carried_interview || []).length}건, 메모 ${(d.carried_notes || []).length}건을 넘겨받았습니다. `
      : "이 업무의 첫 바통입니다. ",
      `검토를 마치고 바통 파일로 저장해 ${H.successor || "후임자"} 님께 넘기면, 다음 인수인계 때 '자료 넣기'에 함께 넣기만 해도 ${gen}대까지의 업무 지식(항목·근거·질의응답·메모)이 그대로 이어집니다.`,
      rv_confirmed() ? "" : " (아직 전임자 확인 전이라 초안 상태로 저장됩니다)"),
    (d.carried_interview || []).length ? el("details", {}, el("summary", { class: "small" }, `앞 세대가 남긴 질의응답 ${(d.carried_interview || []).length}건`),
      el("ul", { class: "small" }, d.carried_interview.map(x => el("li", {}, el("b", {}, x.q), ` → ${x.a} (${x.by})`)))) : null,
    (d.carried_notes || []).length ? el("details", {}, el("summary", { class: "small" }, `앞 세대가 남긴 메모 ${(d.carried_notes || []).length}건`),
      el("ul", { class: "small" }, d.carried_notes.map(x => el("li", {}, `${x.text} (${x.by})`)))) : null);
}
const rv_confirmed = () => !!(H.review && H.review.confirmed);

// ------------------------------------------------------------ 달력
// 달마다 드는 24절기(대략의 시기 감각을 돕는 표시)
const JEOLGI = { 1: "소한 · 대한", 2: "입춘 · 우수", 3: "경칩 · 춘분", 4: "청명 · 곡우", 5: "입하 · 소만", 6: "망종 · 하지",
  7: "소서 · 대서", 8: "입추 · 처서", 9: "백로 · 추분", 10: "한로 · 상강", 11: "입동 · 소설", 12: "대설 · 동지" };
const monthHead = m => el("h4", {}, `${m}월`, el("span", { class: "jg" }, JEOLGI[m]));
function renderCalendar() {
  const sec = $("#tab-calendar");
  if (needH(sec)) return;
  sec.innerHTML = "";
  const items = H.draft.sections.schedule.filter(s => s.status !== "삭제");
  const monthly = items.filter(s => s.recurring === "매월");
  const nowM = new Date().getMonth() + 1;
  sec.append(el("div", { class: "panel" }, el("h2", {}, "연간 업무 달력"),
    el("p", { class: "small muted" }, "자료에서 찾은 시기별 할 일입니다. 항목을 누르면 근거를 볼 수 있습니다."),
    monthly.length ? el("div", {}, el("b", {}, "매월 반복: "), monthly.map(s => el("span", { class: "chip", onclick: () => showSource(s.sources[0], CTX()) }, (s.day ? s.day + "일 " : "") + s.task))) : null,
    icsBox()));
  const by = baseYear();
  const later = items.filter(s => s.recurring !== "매월" && !s.recurring && s.year && s.year > by);
  const cal = el("div", { class: "cal" });
  const itemEl = s => el("div", { class: "it", style: { cursor: "pointer", opacity: s.timing === "완료" || s.timing === "지난 일" ? .55 : 1 }, onclick: () => s.sources[0] && showSource(s.sources[0], CTX()) },
    el("b", {}, s.day ? `${s.day}일 ` : ""), s.task, (s.origin || []).every(o => o === "개인메모") ? el("span", { class: "tag warn" }, "메모") : null, schedTags(s));
  for (let m = 1; m <= 12; m++) {
    const its = items.filter(s => s.recurring !== "매월" && !later.includes(s) && (s.months || []).includes(m)).sort((a, b) => (a.day || 0) - (b.day || 0));
    cal.append(el("div", { class: "m" + (m === nowM ? " now" : "") }, monthHead(m),
      its.length ? its.map(itemEl) : el("div", { class: "small muted" }, "일정 없음")));
  }
  sec.append(cal);
  if (later.length) sec.append(el("div", { class: "panel" }, el("h3", {}, `${by + 1}년 이후 일정`),
    later.map(s => el("div", {}, el("b", {}, `${s.year}년 ${s.months[0]}월${s.day ? " " + s.day + "일" : ""} `), itemEl(s)))));
}

// 내 일정으로 내보내기(.ics): Outlook·그룹웨어 일정에 매월·매년 반복으로
function icsBox(startInput) {
  const start = startInput || el("input", { type: "date", value: new Date().toISOString().slice(0, 10) });
  return el("div", { class: "row", style: { marginTop: "10px", alignItems: "center", flexWrap: "wrap" } },
    startInput ? null : [el("label", { class: "small" }, "착임일(이날부터 일정 시작) "), start],
    el("button", { class: "primary", onclick: () => downloadIcs(start.value) }, "내 일정으로 내보내기(.ics)"),
    el("span", { class: "small muted" }, "Outlook: 파일 열기 → 가져오기 / 그룹웨어: 일정 → iCalendar 가져오기. 매월 업무는 매월, 정기 업무는 매년 반복으로 들어가고 알림이 붙습니다."));
}
async function downloadIcs(start) {
  const r = await fetch(`/api/handovers/${H.id}/calendar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ start }) });
  if (!r.ok) { let m = "내보내기 실패"; try { m = (await r.json()).error || m; } catch (e) {} return toast(m, true); }
  const cd = r.headers.get("Content-Disposition") || "";
  const mm = cd.match(/filename\*=UTF-8''([^;]+)/);
  const name = mm ? decodeURIComponent(mm[1]) : "업무달력.ics";
  const a = el("a", { href: URL.createObjectURL(await r.blob()), download: name });
  document.body.append(a); a.click(); a.remove();
  const sk = Number(r.headers.get("X-Skipped") || 0);
  toast(`${name} 저장됨: 일정 ${r.headers.get("X-Events")}건` + (sk ? ` (이미 지난 일 등 ${sk}건 제외)` : ""));
}

// ------------------------------------------------------------ 확인 필요
function renderFlags() {
  const sec = $("#tab-flags");
  if (needH(sec)) return;
  sec.innerHTML = "";
  const flags = H.draft.flags;
  const types = { "충돌": "bad", "기한 지남": "bad", "불확실": "warn", "누락": "info" };
  const panel = el("div", { class: "panel" }, el("h2", {}, `확인이 필요한 사항 (${flags.filter(f => !f.resolved).length}건 남음)`),
    el("p", { class: "small muted" }, "충돌: 자료끼리 내용이 다름 · 기한 지남: 해야 할 일인데 오늘 기준으로 날짜가 지남 · 불확실: '아마', '미정' 같은 표현 또는 개인메모에만 있음 · 누락: 연락처·기한·다음 할 일 등이 빠짐. 공식문서와 개인메모는 자료 목록에서 구분됩니다."));
  for (const t of ["충돌", "기한 지남", "불확실", "누락"]) {
    const fs = flags.filter(f => f.type === t);
    if (!fs.length) continue;
    panel.append(el("h3", {}, el("span", { class: "tag " + types[t] }, t), ` ${fs.length}건`));
    for (const f of fs) {
      const note = el("input", { placeholder: "처리 내용 (예: 업체 확인 결과 11/3 착공)", value: f.note || "", style: { flex: 1 } });
      panel.append(el("div", { class: "panel", style: { padding: "10px", opacity: f.resolved ? .6 : 1 } },
        el("div", {}, f.message), el("div", { style: { margin: "4px 0" } }, citeChips(f.sources, CTX())),
        el("div", { class: "row" }, note,
          el("button", { class: "small" + (f.resolved ? "" : " primary"), onclick: async () => {
            Object.assign(f, await api("POST", `/api/handovers/${H.id}/flag`, { id: f.id, resolved: !f.resolved, note: note.value }));
            renderFlags();
          } }, f.resolved ? "다시 열기" : "처리 완료"))));
    }
  }
  if (!flags.length) panel.append(el("div", { class: "empty" }, "확인이 필요한 사항이 없습니다."));
  sec.append(panel);
}

// ------------------------------------------------------------ 자료 목록
function renderDocs() {
  const sec = $("#tab-docs");
  if (needH(sec)) return;
  sec.innerHTML = "";
  const kinds = { "이전 인수인계서": "ok", "공식문서": "ok", "메일": "info", "개인메모": "warn", "참고자료": "gray", "읽기 실패": "bad" };
  sec.append(el("div", { class: "panel" }, el("h2", {}, `인계 자료 (${H.draft.docs.length}건)`),
    el("p", { class: "small muted" }, `가져온 곳: ${H.source.kind} ${H.source.path || ""} · 원본은 읽기만 했고 수정하지 않았습니다.`),
    el("table", { class: "t" }, el("tr", {}, el("th", {}, "파일"), el("th", {}, "구분"), el("th", {}, "형식"), el("th", {}, "요약"), el("th", {}, "")),
      H.draft.docs.map(d => el("tr", {}, el("td", {}, d.relpath), el("td", {}, el("span", { class: "tag " + (kinds[d.kind] || "gray") }, d.kind)),
        el("td", {}, d.ext), el("td", { class: "small" }, d.summary),
        el("td", {}, el("button", { class: "small", onclick: async () => {
          const r = await api("GET", `/api/handovers/${H.id}/document?file=${encodeURIComponent(d.relpath)}`);
          modal(d.relpath, el("pre", { class: "doc" }, r.blocks.map(b => `[${b.loc}] ${b.text}`).join("\n")));
        } }, "내용 보기")))))));
}

// ------------------------------------------------------------ 질문
function setupAsk() {
  const send = async (qtext) => {
    if (!H) return toast("먼저 인수인계 건을 선택하세요", true);
    const q = (qtext || $("#q").value).trim();
    if (!q) return;
    $("#q").value = "";
    const chat = $("#chat");
    chat.append(el("div", { class: "msg me" }, q));
    const bot = (...kids) => el("div", { class: "av-row" }, el("span", { class: "avatar", title: "실제 본인이 아닌, 자료로만 답하는 AI 분신" }, predName().slice(0, 1)),
      el("div", { class: "msg bot", style: { width: "auto", flex: 1 } }, ...kids));
    const pending = bot(el("span", { class: "spinner" }), " 자료를 찾는 중");
    chat.append(pending);
    try {
      const r = await api("POST", `/api/handovers/${H.id}/ask`, { q });
      const fwd = el("button", { class: "small" + (r.found ? "" : " primary"), onclick: async e => {
        const x = await api("POST", `/api/handovers/${H.id}/questions`, { q });
        e.target.disabled = true; e.target.textContent = `✓ ${predName()} 님께 넘겼어요 (전임자 검토 화면에 표시)`;
        (H.questions = H.questions || []).some(y => y.id === x.id) || H.questions.push(x);
        renderMyQuestions(); renderDraft();
      } }, r.found ? `답이 부족하면 진짜 ${predName()} 님께 넘기기` : `진짜 ${predName()} 님께 질문 넘기기`);
      const already = r.related && r.related.status === "대기";
      pending.replaceWith(bot(el("div", { style: { whiteSpace: "pre-wrap" } }, r.answer),
        r.sources && r.sources.length ? el("div", { class: "small muted", style: { marginTop: "6px" } }, `근거 (${r.mode}): `, citeChips(r.sources, CTX())) : null,
        r.mode === "전임자 직접 답변" ? null : el("div", { style: { marginTop: "6px" } },
          already ? el("span", { class: "tag warn" }, `같은 질문을 이미 넘겼어요 · ${predName()} 님 답변 대기`) : fwd)));
    } catch (e) { pending.remove(); }
  };
  $("#ask").onclick = () => send();
  $("#q").addEventListener("keydown", e => { if (e.key === "Enter") send(); });
  ["3월에 할 일이 뭐야?", "냉난방기 공사 누구랑 협의해?", "수질검사 부적합 나오면 어떻게 해?", "급한 현안 알려줘", "체육센터 대관료 감면 기준은?"].forEach(x =>
    $("#q-examples").append(el("span", { class: "chip", onclick: () => send(x) }, x)));
}

// 후임자 화면: 전임자에게 넘긴 질문과 답
function renderMyQuestions() {
  const box = $("#my-questions");
  const qs = (H && H.questions) || [];
  box.hidden = !qs.length;
  box.innerHTML = "";
  if (!qs.length) return;
  box.append(el("h3", {}, `${predName()} 님께 넘긴 질문 (${qs.filter(q => q.status === "대기").length}건 답변 대기)`),
    el("ul", {}, qs.map(q => el("li", {}, el("span", { class: "tag " + (q.status === "대기" ? "warn" : "ok") }, q.status), " ", el("b", {}, q.q),
      q.answer ? el("div", { class: "small" }, `↳ ${predName()}: ${q.answer}`) : null))),
    el("button", { class: "small", onclick: async () => { H = await api("GET", `/api/handovers/${H.id}`); renderAll(); } }, "답변 새로 확인"));
}

// ------------------------------------------------------------ 매뉴얼
function setupManual() {
  $("#m-start").value = new Date().toISOString().slice(0, 10);
  $("#m-make").onclick = async () => {
    if (!H) return toast("먼저 인수인계 건을 선택하세요", true);
    const body = { successor: $("#m-name").value || H.successor, start: $("#m-start").value, career: $("#m-career").value };
    const m = await api("POST", `/api/handovers/${H.id}/manual`, body);
    const out = $("#m-out");
    out.innerHTML = "";
    const p = el("div", { class: "panel" }, el("div", { class: "row" }, el("h2", { style: { flex: 1, margin: 0 } }, `${m.successor || "후임자"}님 업무매뉴얼`), exportButtons(`/api/handovers/${H.id}/export/manual`, () => body),
        el("button", { onclick: () => downloadIcs(body.start) }, "내 일정(.ics)")),
      H.review.confirmed ? null : el("p", { class: "tag warn" }, "전임자 확인 전 초안 기준입니다"),
      el("h3", {}, "1. 첫 주에 할 일"), el("ol", {}, m.week1.map(x => el("li", {}, x))),
      el("h3", {}, "2. 착임월부터 12개월 일정"),
      el("div", { class: "cal" }, m.months.map(mo => el("div", { class: "m" }, monthHead(mo.month),
        mo.items.length ? mo.items.map(s => el("div", { class: "it" }, (s.day ? s.day + "일 " : "") + s.task)) : el("div", { class: "small muted" }, "-")))),
      el("h3", {}, "3. 진행 중인 현안 (기한 순)"),
      el("table", { class: "t" }, el("tr", {}, el("th", {}, "현안"), el("th", {}, "남은 기간"), el("th", {}, "다음 할 일"), el("th", {}, "근거")),
        m.issues.map(i => el("tr", {}, el("td", {}, i.title),
          el("td", {}, i.days_left === null ? "기한 없음" : el("span", { class: "tag " + (i.days_left < 0 ? "bad" : i.days_left <= 30 ? "warn" : "gray") }, i.days_left < 0 ? "기한 지남" : `D-${i.days_left}`)),
          el("td", {}, i.next_action || ""), el("td", {}, citeChips(i.sources, CTX()))))),
      el("h3", {}, "4. 꼭 알아둘 연락처"),
      el("table", { class: "t" }, m.contacts.map(c => el("tr", {}, el("td", {}, c.name), el("td", {}, `${c.org || ""} ${c.title || ""}`), el("td", {}, (c.phones || []).join(", ")), el("td", {}, (c.topics || []).slice(0, 2).join(", "))))),
      m.unresolved.length ? [el("h3", {}, "5. 아직 확인되지 않은 내용"), el("ul", {}, m.unresolved.map(f => el("li", {}, `[${f.type}] ${f.message}`)))] : null,
      m.terms.length ? [el("h3", {}, "6. 처음 보는 용어"), el("table", { class: "t" }, m.terms.map(([k, v]) => el("tr", {}, el("td", {}, el("b", {}, k)), el("td", {}, v))))] : null);
    out.append(p);
  };
}

// ------------------------------------------------------------ 이력
async function renderHistory() {
  const sec = $("#tab-history");
  if (needH(sec)) return;
  const { history } = await api("GET", `/api/handovers/${H.id}/history`);
  sec.innerHTML = "";
  sec.append(el("div", { class: "panel" }, el("h2", {}, "처리 이력"),
    el("table", { class: "t" }, el("tr", {}, el("th", {}, "시각"), el("th", {}, "작업"), el("th", {}, "내용")),
      history.slice().reverse().map(x => el("tr", {}, el("td", { class: "small" }, x.at), el("td", {}, x.action), el("td", { class: "small" }, x.detail))))));
}

let goTab;
function renderAll() { renderDraft(); renderCalendar(); renderFlags(); renderDocs(); if (H) { renderAvatarHead(); renderMyQuestions(); } }
document.addEventListener("DOMContentLoaded", async () => {
  setupStart(); setupAsk(); setupManual();
  goTab = setupTabs(id => { if (id === "history") renderHistory(); });
  $("#cur-h").onchange = e => e.target.value && select(e.target.value);
  await refreshList();
});
