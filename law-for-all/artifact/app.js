/* 법이음 공유판 화면 — 엔진은 window.LAWON(lib/ 의 실제 코드를 묶은 것)을 그대로 사용 */
(function () {
  "use strict";
  var L = window.LAWON;

  // PDF: 전역 pdfjsWorker(페이지에 포함)로 페이지 안에서 처리하므로 워커 파일 경로는 쓰지 않음
  window.__PDF_WORKER_URL = "";

  // ───────────────────────── 보조 함수
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var store = {
    get: function (k) { try { return localStorage.getItem("lawon:" + k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem("lawon:" + k, v); } catch (e) { /* 저장 불가 환경 */ } },
  };
  var ICON = {
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    gavel: '<path d="m14.5 12.5-8 8a2.12 2.12 0 1 1-3-3l8-8"/><path d="m16 16 6-6"/><path d="m8 8 6-6"/><path d="m9 7 8 8"/><path d="m21 11-8-8"/>',
    landmark: '<path d="M3 22h18"/><path d="M6 18v-7"/><path d="M10 18v-7"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="M12 2 20 7H4z"/>',
    book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
    scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/><path d="m16 16-1.9-1.9"/>',
    arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 12v6"/><path d="m15 15-3-3-3 3"/>',
    pen: '<path d="M12 22h6a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v10"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10.4 12.6a2 2 0 1 1 3 3L8 21l-4 1 1-4Z"/>',
    layers: '<path d="m12.83 2.18 8.58 3.9a1 1 0 0 1 0 1.83l-8.58 3.9a2 2 0 0 1-1.66 0L2.6 7.91a1 1 0 0 1 0-1.83l8.58-3.9a2 2 0 0 1 1.66 0Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    list: '<path d="M11 6h9"/><path d="M11 12h9"/><path d="M11 18h9"/><path d="m3 6 1 1 2-2"/><path d="m3 12 1 1 2-2"/><path d="m3 18 1 1 2-2"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  };
  var ico = function (n) { return '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">' + ICON[n] + "</svg>"; };

  var toastTimer;
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2200);
  }
  function copy(text, msg) {
    var done = function () { toast(msg || "복사했어요."); };
    try {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } catch (e) {
      fallbackCopy(text);
      done();
    }
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) { /* 선택만 해 둠 */ }
    ta.remove();
  }

  var lawLabel = function (c) { return "「" + c.lawName + "」 " + L.articleLabel(c.articleNo) + (c.title ? "(" + c.title + ")" : ""); };
  var lawById = function (id) { return L.getMockLaw(id); };
  function citationOf(lawId, no) {
    var law = lawById(lawId);
    var art = law && law.articles.find(function (a) { return a.no === no; });
    return law && art ? L.toCitation(law, art) : null;
  }

  // ───────────────────────── 상태
  var state = {
    mode: store.get("mode") === "officer" ? "officer" : "citizen",
    font: Number(store.get("font")) || 0,
    ask: { query: "", result: null, loading: false },
    analyze: { text: "작년 3월에 전세 보증금 1억 2천만 원으로 계약했는데, 계약이 끝난 지 두 달이 지나도 집주인이 보증금을 돌려주지 않고 연락도 잘 안 받아요. 이사는 가야 하는데 어떻게 해야 하나요?", result: null, loading: false, tab: "lawyer" },
    comp: { orgType: L.ORG_TYPES[0], regName: "", text: "", report: null, filter: "all", loaded: null, error: "", extracting: "" },
    laws: { q: "", kind: "전체" },
    citations: [],
  };

  var NAV = {
    citizen: [["analyze", "상황 분석", "gavel"], ["cases", "판례 보기", "landmark"], ["laws", "법령 둘러보기", "book"]],
    officer: [["compliance", "자체규정 점검", "scan"], ["cases", "판례 보기", "landmark"], ["laws", "법령 둘러보기", "book"]],
  };
  var VIEWS = ["home", "search", "analyze", "compliance", "cases", "laws"];
  var currentView = function () {
    var h = location.hash.replace("#", "");
    return VIEWS.indexOf(h) >= 0 ? h : "home";
  };
  function go(view) {
    if (location.hash === "#" + view) render();
    else location.hash = view;
  }

  function applyChrome() {
    document.documentElement.dataset.font = String(state.font);
    document.querySelectorAll("[data-mode]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)); });
    document.querySelectorAll("[data-font]").forEach(function (b) { b.setAttribute("aria-pressed", String(Number(b.dataset.font) === state.font)); });
    var v = currentView();
    $("#nav").innerHTML = NAV[state.mode]
      .map(function (n) { return '<a href="#' + n[0] + '"' + (v === n[0] ? ' aria-current="page"' : "") + ">" + ico(n[2]) + esc(n[1]) + "</a>"; })
      .join("");
  }

  // ───────────────────────── 첫 화면
  var HERO = {
    citizen: { title: '<span class="phrase">법은 가깝게,</span> <em class="phrase">권리는 든든하게.</em>', sub: [["어려운 법률을", "일상의 언어로 연결합니다."], ["궁금한 상황을 물어보면", "관련 법 조항과 판례,", "해야 할 일을", "차근차근 알려드려요."]], ph: "예) 집주인이 보증금을 안 돌려줘요" },
    officer: { title: '<span class="phrase">정확한 근거로,</span> <em class="phrase">빠른 행정 판단</em>', sub: [["근거 조문·판례 검토부터", "우리 기관 규정 검증까지,"], ["검토 보고서·기안문과", "규정 제·개정 초안을", "한 곳에서 처리하세요."]], ph: "예) 청탁금지법상 외부강의 사례금 상한은?" },
  };
  var FEATURES = {
    citizen: [
      ["users", "쉬운 법률 안내", "일상 언어로 물으면 쉬운 용어 풀이와 '지금 해야 할 3단계'를 알려드려요."],
      ["gavel", "AI 법률 상황 분석실", "상황을 말하면 관련 법령을 추천하고 변호사·검사·판사의 시각으로 검토해요."],
      ["landmark", "판례 보기", "비슷한 사건에서 법원이 어떻게 판단했는지 쉬운 설명과 함께 보여드려요."],
      ["shield", "근거 인용·환각 방지", "모든 답변에 조문 번호와 원문을 인용하고, 근거 밖 인용은 자동 제거합니다."],
      ["layers", "LLM 비종속", "OpenAI·Claude·Ollama(EXAONE·Gemma·Llama·Solar)를 설정 하나로 전환합니다."],
    ],
    officer: [
      ["building", "행정 검토 보고", "검토 결론·근거 체계·쟁점·유의사항·체크리스트를 보고서 형식으로 정리해요."],
      ["list", "보고서 한 번에 작성", "검토 보고서·기안문·민원 회신문·붙임을 한 번에 만들고 Word로 저장해요."],
      ["scan", "자체규정 점검", "우리 기관 규정을 근로기준법·청탁금지법·공직선거법·지방공기업법·공유재산법과 조문 단위로 대조해요."],
      ["pen", "규정 제·개정 지원", "개정안·신구조문 대비표·정합성 점검·개정이유·부칙·입법예고문 초안."],
      ["shield", "근거 인용·환각 방지", "근거 밖 인용 자동 제거, 원문 대조, 인용 표기 복사로 공문서에 바로 활용."],
    ],
  };

  function viewHome() {
    var m = state.mode, H = HERO[m];
    var chips = (m === "officer" ? L.OFFICER_SUGGESTIONS : L.CITIZEN_SUGGESTIONS)
      .map(function (c) { return '<button type="button" class="chip" data-action="ask" data-q="' + esc(c.query) + '"># ' + esc(c.label) + "</button>"; })
      .join("");
    var cta = m === "officer"
      ? '<a class="cta" href="#compliance"><span class="cta-icon">' + ico("scan") + '</span><span style="flex:1;min-width:0"><strong>자체규정 점검</strong><span class="desc">우리 기관 규정 파일(한글·PDF·Word)을 넣으면 상위법령과 대조해 상충·검토 필요 조항, 근거 조문, 개정안을 보여 드려요.</span></span>' + ico("arrow") + "</a>"
      : '<a class="cta" href="#analyze"><span class="cta-icon">' + ico("gavel") + '</span><span style="flex:1;min-width:0"><strong>복잡한 상황이라면? AI 법률 상황 분석실</strong><span class="desc">겪은 일을 이야기하면 관련 법령을 추천하고 변호사·검사·판사의 시각으로 검토해 드려요.</span></span>' + ico("arrow") + "</a>";
    return (
      '<section class="hero"><div class="wrap">' +
      "<h1>" + H.title + "</h1>" +
      '<p class="sub">' + H.sub.map(function (l) { return '<span class="block balance">' + l.map(function (ph) { return '<span class="phrase">' + esc(ph) + "</span>"; }).join(" ") + "</span>"; }).join("") + "</p>" +
      '<form class="search" data-form="ask" role="search"><input id="q" name="q" autocomplete="off" aria-label="법률 질문" placeholder="' + esc(H.ph) + '" value="' + esc(state.ask.query) + '"><button class="btn btn-primary" type="submit">' + ico("search") + "검색</button></form>" +
      '<div class="chips">' + chips + "</div>" + cta +
      "</div></section>" +
      '<section class="wrap"><div class="features">' +
      FEATURES[m].map(function (f) { return '<div class="feature"><span class="feature-icon">' + ico(f[0]) + "</span><h3>" + esc(f[1]) + "</h3><p>" + esc(f[2]) + "</p></div>"; }).join("") +
      "</div></section>"
    );
  }

  // ───────────────────────── 검색 답변
  function citedLines(text, citations) {
    var idx = {};
    citations.forEach(function (c, i) { idx[c.key] = i; });
    return '<ol class="cited">' + L.splitCitedSentences(text).map(function (s) {
      var marks = s.keys.filter(function (k) { return k in idx; }).map(function (k) {
        return '<button type="button" class="num" data-action="cite" data-key="' + esc(k) + '" aria-label="근거 ' + (idx[k] + 1) + " 원문 보기\">" + (idx[k] + 1) + "</button>";
      }).join("");
      return '<li><span class="marks">' + (marks || '<span class="bullet" aria-hidden="true"></span>') + "</span><span>" + esc(s.text) + "</span></li>";
    }).join("") + "</ol>";
  }
  function citationCards(cits) {
    if (!cits.length) return '<p class="muted small">이 질문과 직접 연결된 내장 조문을 찾지 못했어요.</p>';
    return cits.map(function (c, i) {
      return '<div class="cite-card"><div class="head"><span class="num">' + (i + 1) + '</span><span class="name">' + esc(lawLabel(c)) + '</span></div><p class="excerpt">' + esc(c.text) + '</p><div class="row"><button type="button" class="btn btn-outline" data-action="cite" data-key="' + esc(c.key) + '">원문 보기</button><button type="button" class="btn btn-outline" data-action="copy-cite" data-key="' + esc(c.key) + '">' + ico("copy") + "인용 복사</button></div></div>";
    }).join("");
  }
  function guardBadges(r) {
    return '<div class="badges">' +
      (r.topic ? '<span class="badge blue">' + esc(r.topic.label) + "</span>" : "") +
      '<span class="badge ' + (r.guard.passed ? "ok" : "") + '">' + (r.guard.passed ? "근거 검증 통과" : "확인 필요 표현 " + r.guard.unverifiedMentions.length + "건") + "</span>" +
      '<span class="badge">' + esc(r.provider.label) + "</span>" +
      '<span class="badge">공식 원문 스냅샷 ' + esc(L.MOCK_DATASET_DATE) + "</span></div>";
  }
  function caseLink(q) {
    return "https://www.law.go.kr/LSW/precSc.do?query=" + encodeURIComponent(q);
  }
  function viewSearch() {
    var a = state.ask, r = a.result;
    var form = '<form class="search" data-form="ask" role="search" style="margin:0;max-width:none"><input id="q" name="q" autocomplete="off" aria-label="법률 질문" value="' + esc(a.query) + '"><button class="btn btn-primary" type="submit">' + ico("search") + "검색</button></form>";
    if (a.loading || !r) return '<div class="wrap page stack">' + form + '<div class="empty"><div><span class="spinner"></span><strong>근거 조문을 찾는 중…</strong></div></div></div>';
    state.citations = r.citations;
    var main = "", side = "";
    if (r.mode === "citizen" && r.citizen) {
      var c = r.citizen;
      main += '<div class="card stack"><p class="section-title">' + ico("users") + "법도우미 요약</p>" + citedLines(r.summary, r.citations) + "</div>";
      if (c.steps && c.steps.length) main += '<div class="card stack"><p class="section-title">' + ico("list") + "지금 해야 할 일</p><ol class=\"steps\">" + c.steps.map(function (s) { return "<li><div><strong>" + esc(s.title) + "</strong><p>" + esc(s.detail) + "</p></div></li>"; }).join("") + "</ol></div>";
      if (c.easyTerms && c.easyTerms.length) main += '<div class="card stack"><p class="section-title">' + ico("book") + "쉬운 용어 풀이</p><dl class=\"terms\">" + c.easyTerms.map(function (t) { return '<div class="term"><dt>' + esc(t.term) + "</dt><dd>" + esc(t.meaning) + "</dd></div>"; }).join("") + "</dl></div>";
      if (c.tip) main += '<p class="tip">' + esc(c.tip) + "</p>";
    } else if (r.officer) {
      var o = r.officer;
      main += '<div class="card stack"><p class="section-title">' + ico("building") + "검토 결론</p>" + citedLines(r.summary, r.citations) + "</div>";
      if (o.background) main += '<div class="card stack"><p class="section-title">' + ico("book") + "검토 배경</p><p>" + esc(o.background) + "</p></div>";
      if (o.keyPoints.length) main += '<div class="card stack"><p class="section-title">' + ico("scan") + "핵심 쟁점</p><ul class=\"list-dot\">" + o.keyPoints.map(function (k) { return "<li>" + esc(k.replace(/\[\[[^\]]+\]\]/g, "").trim()) + "</li>"; }).join("") + "</ul></div>";
      if (o.adminNotes.length) main += '<div class="card stack"><p class="section-title">' + ico("shield") + "행정 유의사항</p><ul class=\"list-dot\">" + o.adminNotes.map(function (k) { return "<li>" + esc(k) + "</li>"; }).join("") + "</ul></div>";
      if (o.checklist.length) main += '<div class="card stack"><p class="section-title">' + ico("list") + "처리 체크리스트</p><div class=\"checklist\">" + o.checklist.map(function (k, i) { return '<label for="chk-' + i + '"><input type="checkbox" id="chk-' + i + '">' + esc(k) + "</label>"; }).join("") + "</div></div>";
    }
    side += '<div class="card stack"><p class="section-title">' + ico("book") + "근거 조문 " + r.citations.length + "건</p>" + citationCards(r.citations) + "</div>";
    if (r.caseQuery) side += '<div class="card stack"><p class="section-title">' + ico("landmark") + '관련 판례</p><p class="small muted">판례 원문은 국가법령정보센터 실시간 검색이 필요해요. 이 공유판에서는 검색 결과로 바로 연결해 드려요.</p><a class="btn btn-outline" href="' + caseLink(r.caseQuery) + '" target="_blank" rel="noopener">‘' + esc(r.caseQuery) + "’ 판례 검색 열기</a></div>";
    if (r.contacts.length) side += '<div class="card"><p class="section-title" style="margin-bottom:6px">' + ico("phone") + "도움받을 곳</p>" + r.contacts.map(function (k) { return '<div class="contact"><span><b>' + esc(k.name) + '</b><br><span class="muted xs">' + esc(k.desc || "") + '</span></span><span class="tel">' + esc(k.phone || "") + "</span></div>"; }).join("") + "</div>";
    var notices = r.notices.filter(function (n) { return !/LAW_API_OC|인증키|중계/.test(n); });
    return '<div class="wrap page stack">' + form +
      '<div class="answer-head"><p class="eyebrow">' + (r.mode === "officer" ? "공직자 모드 · 행정 검토" : "국민 모드 · 쉬운 법률 안내") + "</p><h1>" + esc(r.query) + "</h1>" + guardBadges(r) + "</div>" +
      (notices.length ? '<p class="notice info">' + notices.map(esc).join("<br>") + "</p>" : "") +
      '<div class="answer-grid" style="margin-top:0"><div class="stack" style="min-width:0">' + main + '</div><aside class="stack" style="min-width:0">' + side + "</aside></div></div>";
  }
  function runAsk(q) {
    q = (q || "").trim();
    if (q.length < 2) { toast("질문을 두 글자 이상 입력해 주세요."); return; }
    state.ask = { query: q, result: null, loading: true };
    go("search");
    L.ask({ query: q, mode: state.mode }).then(function (r) {
      state.ask.result = r;
      state.ask.loading = false;
      if (currentView() === "search") render();
    });
  }

  // ───────────────────────── 상황 분석
  var ROLE = { lawyer: "변호사", prosecutor: "검사", judge: "판사" };
  var REQ = { met: "충족", unclear: "불명확", unmet: "미충족" };
  function viewAnalyze() {
    var s = state.analyze, r = s.result;
    var left = '<section class="card stack" aria-label="상황 입력"><label class="field" for="situation">겪은 일을 자세히 적어 주세요<textarea id="situation" class="textarea prose" rows="9" data-bind="analyze.text">' + esc(s.text) + '</textarea></label><button class="btn btn-primary btn-block" type="button" data-action="analyze">' + (s.loading ? '<span class="spinner"></span>' : ico("gavel")) + "상황 분석하기</button><p class=\"xs muted\">당사자·금액·기간 같은 사실을 뽑고, 관련 법령을 추천한 뒤 변호사·검사·판사 관점으로 나눠 검토해요. 판단은 내장 조문 원문과 정해진 요건으로만 합니다.</p></section>";
    var right;
    if (!r) right = '<div class="empty"><div>' + ico("gavel") + "<strong>상황을 적고 분석하기를 눌러 주세요.</strong><p class=\"small\">예시 문장이 들어 있어요. 그대로 눌러 봐도 돼요.</p></div></div>";
    else {
      state.citations = r.citations;
      var byKey = {};
      r.citations.forEach(function (c) { byKey[c.key] = c; });
      right = '<div class="stack">';
      right += '<div class="card stack"><p class="section-title">' + ico("list") + "뽑아낸 사실</p>" + (r.facts.length ? '<div class="facts">' + r.facts.map(function (f) { return '<span class="fact"><b>' + esc(f.kind) + "</b>" + esc(f.value) + "</span>"; }).join("") + "</div>" : '<p class="small muted">뚜렷한 사실 정보를 찾지 못했어요.</p>') +
        (r.issues.length ? '<p class="small"><b>쟁점</b> ' + r.issues.map(function (i) { return esc(i.label); }).join(" · ") + "</p>" : "") + "</div>";
      right += '<div class="card stack"><p class="section-title">' + ico("book") + "추천 법령</p>" + (r.recommendations.length ? r.recommendations.map(function (x) {
        var c = byKey[x.key];
        return '<div class="row" style="align-items:flex-start;flex-wrap:nowrap"><span class="rel ' + x.relevance + '">' + { high: "높음", medium: "중간", low: "참고" }[x.relevance] + '</span><div style="min-width:0">' + (c ? '<button type="button" class="ref" data-action="cite" data-key="' + esc(c.key) + '">' + esc(lawLabel(c)) + "</button>" : "") + '<p class="small muted" style="margin-top:3px">' + esc(x.reason) + "</p></div></div>";
      }).join("") : '<p class="small muted">관련 법령을 찾지 못했어요.</p>') + "</div>";
      r.analyses.forEach(function (a) {
        var p = a.perspectives, t = s.tab;
        var tabs = '<div class="tabs" role="tablist">' + Object.keys(ROLE).map(function (k) { return '<button type="button" class="tab" role="tab" aria-selected="' + (t === k) + '" data-action="role" data-role="' + k + '">' + ROLE[k] + "</button>"; }).join("") + "</div>";
        var body = "";
        var ul = function (title, arr) { return arr && arr.length ? '<p class="small" style="font-weight:800;margin-top:6px">' + title + '</p><ul class="list-dot">' + arr.map(function (v) { return "<li>" + esc(v) + "</li>"; }).join("") + "</ul>" : ""; };
        if (t === "lawyer") body = "<p>" + esc(p.lawyer.stance) + "</p>" + ul("주장할 점", p.lawyer.arguments) + ul("모아 둘 증거", p.lawyer.evidence) + ul("대응 전략", p.lawyer.strategy);
        if (t === "prosecutor") body = "<p>" + esc(p.prosecutor.stance) + "</p>" + ul("문제 될 수 있는 행위", p.prosecutor.violations) + ul("제재", p.prosecutor.sanctions) + ul("입증할 점", p.prosecutor.proofPoints);
        if (t === "judge") body = "<p>" + esc(p.judge.stance) + "</p>" + ul("쟁점", p.judge.issues) +
          (p.judge.requirements.length ? '<p class="small" style="font-weight:800;margin-top:6px">요건 검토</p><div>' + p.judge.requirements.map(function (q) { return '<div class="req"><span class="st ' + q.status + '">' + REQ[q.status] + "</span><div><b>" + esc(q.label) + '</b><p class="small muted">' + esc(q.basis) + "</p></div></div>"; }).join("") + "</div>" : "") +
          '<p class="tip" style="margin-top:8px">' + esc(p.judge.outlook) + "</p>";
        right += '<div class="card stack"><p class="section-title">' + ico("gavel") + esc(a.issue.label) + " · 관점별 검토</p>" + tabs + '<div class="stack" style="gap:8px">' + body + "</div></div>";
      });
      right += "</div>";
    }
    return '<div class="wrap page"><header class="stack" style="gap:6px;margin-bottom:22px"><span class="pill" style="align-self:flex-start">AI 법률 상황 분석실</span><h1 style="font-size:clamp(1.5rem,3.6vw,1.9rem);font-weight:900">상황 분석</h1><p class="muted"><span class="block">겪은 일을 이야기하면 관련 법령을 추천하고</span><span class="block">변호사·검사·판사의 시각으로 나눠 검토해 드려요.</span></p></header><div class="grid-2">' + left + '<div style="min-width:0">' + right + "</div></div></div>";
  }
  function runAnalyze() {
    var s = state.analyze;
    if (s.text.trim().length < 5) { toast("상황을 조금 더 자세히 적어 주세요."); return; }
    s.loading = true;
    render();
    L.analyze({ situation: s.text }).then(function (r) {
      s.result = r;
      s.loading = false;
      render();
    });
  }

  // ───────────────────────── 자체규정 점검
  var SEV = ["conflict", "review", "ok", "info"];
  var SEV_MARK = { conflict: "✕", review: "!", ok: "✓", info: "i" };
  function diffHtml(parts) {
    return parts.map(function (p) { return p.op === "same" ? esc(p.text) : p.op === "del" ? "<del>" + esc(p.text) + "</del>" : "<ins>" + esc(p.text) + "</ins>"; }).join("");
  }
  function refChip(b) {
    var c = citationOf(b.lawId, b.articleNo);
    var law = lawById(b.lawId);
    var label = "「" + (law ? law.name : b.lawId) + "」 " + L.articleLabel(b.articleNo) + (c ? "(" + c.title + ")" : "");
    if (!c) return '<span class="ref" style="color:var(--muted)">' + esc(label) + "</span>";
    if (!state.citations.some(function (x) { return x.key === c.key; })) state.citations.push(c);
    return '<button type="button" class="ref" data-action="cite" data-key="' + esc(c.key) + '">' + esc(label) + "</button>";
  }
  function viewCompliance() {
    if (state.mode !== "officer") {
      return '<div class="wrap page"><div class="empty"><div>' + ico("scan") + '<strong>자체규정 점검은 공직자 모드에서 제공해요.</strong><p class="small">우리 기관 규정 검증·규정 제·개정 같은 실무 기능은 공직자 모드에서 제공해요.</p><button type="button" class="btn btn-primary" style="margin-top:14px" data-action="set-mode" data-mode-to="officer">공직자 모드로 전환</button></div></div></div>';
    }
    var c = state.comp;
    state.citations = [];
    var orgOpts = L.ORG_TYPES.map(function (o) { return "<option" + (o === c.orgType ? " selected" : "") + ">" + esc(o) + "</option>"; }).join("");
    var samples = L.SAMPLE_REGULATIONS.map(function (s, i) { return '<button type="button" class="chip" data-action="sample" data-i="' + i + '">예시: ' + esc(s.label) + "</button>"; }).join("");
    var drop = '<div class="drop" id="drop" role="button" tabindex="0" aria-label="규정 파일 올리기: 한글, PDF, Word 파일을 끌어다 놓거나 눌러서 선택" data-action="pick-file">' +
      (c.extracting ? '<span class="spinner"></span><strong>‘' + esc(c.extracting) + "’ 읽는 중…</strong>" : ico("file") + '<strong>파일을 끌어다 놓거나 눌러서 선택</strong><p class="hint"><b>한글(HWP·HWPX) · PDF · Word(DOCX)</b>파일은 서버로 보내지 않고 이 브라우저에서만 읽어요</p>') +
      '</div><input type="file" id="file" accept="' + esc(L.ACCEPT) + '" hidden>';
    var loaded = c.loaded && !c.error ? '<div class="loaded"><div style="min-width:0"><b>' + esc(c.loaded.name) + '</b> <span class="badge">' + esc(c.loaded.format) + '</span><p class="muted" style="margin-top:2px">' + (c.loaded.articles ? "조문 " + c.loaded.articles + "개" : "조문 표시 없음") + (c.loaded.pages ? " · " + c.loaded.pages + "쪽" : "") + " · " + c.loaded.chars.toLocaleString() + "자 — 아래에서 고친 뒤 검증할 수 있어요</p>" + c.loaded.warnings.map(function (w) { return '<p style="color:var(--amber)">△ ' + esc(w) + "</p>"; }).join("") + '</div><button type="button" class="icon-btn" style="width:28px;height:28px" data-action="clear-loaded" aria-label="불러온 파일 정보 닫기">✕</button></div>' : "";
    var err = c.error ? '<p class="err" role="alert">' + esc(c.error) + "</p>" : "";
    var targets = L.TARGET_LAWS.map(function (t) { var d = lawById(t.id); return "<p><span>「" + esc(t.name) + "」</span><span class=\"nowrap\">" + (d ? "원문 스냅샷 · " + d.articles.length + "개 조문" : "없음") + "</span></p>"; }).join("");

    var left = '<section class="card stack drag-zone" id="comp-input" aria-label="검증할 기관 규정">' +
      '<label class="field" for="org">기관 유형<select id="org" class="select" data-bind="comp.orgType">' + orgOpts + "</select></label>" +
      '<label class="field" for="regname">규정명<input id="regname" class="input" data-bind="comp.regName" placeholder="예) ○○공사 취업규칙, 임직원 행동강령" value="' + esc(c.regName) + '"></label>' +
      '<div class="stack" style="gap:8px"><p style="font-weight:900;font-size:0.9rem">규정 원문</p>' + drop + loaded + err +
      '<textarea id="regtext" class="textarea" rows="12" data-bind="comp.text" placeholder="또는 여기에 직접 붙여 넣으세요.&#10;제1조(목적) …&#10;제2조(근로시간) ① …">' + esc(c.text) + '</textarea><div class="row" style="gap:6px">' + samples + "</div></div>" +
      '<button type="button" class="btn btn-primary btn-block" data-action="check">' + ico("shield") + "상위법령과 교차 검증</button>" +
      '<div class="target-laws"><p style="color:var(--fg);font-weight:900">대조 법령</p>' + targets + '<p style="display:block;padding-top:4px">판정은 정해진 기준과 조문 원문으로만 하며 AI 생성 문장으로 위반을 단정하지 않습니다. 최종 판단은 소관 부처 해석을 확인하세요.</p></div></section>';

    var right;
    var rep = c.report;
    if (!rep) {
      right = '<div class="empty"><div>' + ico("scan") + "<strong>규정을 붙여 넣거나 예시를 고른 뒤 교차 검증을 눌러 주세요.</strong><p class=\"small\" style=\"margin-top:4px\">근로시간·연차·가산수당, 금품 수수 한도, 선거운동, 임원 임기, 사용허가·대부기간, 인용 조문의 현행 여부를 점검합니다.</p></div></div>";
    } else {
      var shown = rep.results.filter(function (r) { return c.filter === "all" || r.status === c.filter; });
      right = '<div class="stack"><div class="card"><div class="row between" style="align-items:flex-start"><div style="min-width:0"><p class="xs muted" style="font-weight:700">' + esc(rep.orgType) + '</p><h2 style="font-size:1.1rem;font-weight:900">「' + esc(rep.regName) + '」 교차 검증 결과</h2><p class="xs muted">' + rep.results.length + "개 조문 · 인용 조문 검증 " + rep.refsChecked + '건 · 공식 원문 스냅샷 기준</p></div><button type="button" class="btn btn-outline" data-action="copy-report">' + ico("copy") + "보고서 복사</button></div>" +
        '<div class="counts" role="group" aria-label="판정별 보기">' + SEV.map(function (s) { return '<button type="button" class="count tone-' + s + '" aria-pressed="' + (c.filter === s) + '" data-action="filter" data-sev="' + s + '"><span>' + SEV_MARK[s] + " " + esc(L.SEVERITY_LABEL[s]) + "</span><b>" + rep.counts[s] + "</b></button>"; }).join("") + "</div></div>";
      right += shown.map(function (r) {
        var amended = L.amendedText(r);
        var d = amended ? L.diffWords(r.article.text, amended) : null;
        var out = '<article class="card art ' + r.status + '"><div class="row between"><h3 style="font-weight:900;font-size:1rem">' + esc(L.regArticleLabel(r.article)) + '</h3><span class="badge tone-' + r.status + '">' + SEV_MARK[r.status] + " " + esc(L.SEVERITY_LABEL[r.status]) + "</span></div>" +
          '<p class="law-text art-text">' + esc(r.article.text) + "</p>";
        if (r.findings.length) out += '<ul class="stack" style="gap:8px;margin-top:12px">' + r.findings.map(function (f) { return '<li class="finding tone-' + f.severity + '"><strong>' + SEV_MARK[f.severity] + " " + esc(f.title) + "</strong><p>" + esc(f.detail) + "</p>" + (f.basis.length ? '<div class="row" style="gap:6px;margin-top:8px">' + f.basis.map(refChip).join("") + "</div>" : "") + "</li>"; }).join("") + "</ul>";
        if (r.related.length) out += '<div class="row xs muted" style="gap:6px;margin-top:12px"><b>관련 상위 조문</b>' + r.related.map(refChip).join("") + "</div>";
        if (!r.findings.length && !r.related.length) out += '<p class="xs muted" style="margin-top:12px">대조 법령에서 직접 관련된 기준을 찾지 못했어요(기관 자율 사항일 수 있음).</p>';
        if (d) out += '<div class="amend"><div class="row between" style="margin-bottom:8px"><p class="section-title" style="font-size:0.9rem">' + ico("pen") + '개정안(상위법 기준 반영)</p><button type="button" class="btn btn-outline" data-action="copy-amend" data-text="' + esc(L.regArticleLabel(r.article) + " " + amended) + '">' + ico("copy") + '복사</button></div><div class="diff"><div><span class="badge">현행</span><p class="law-text" style="margin-top:4px">' + diffHtml(d.old) + '</p></div><div><span class="badge blue">개정안</span><p class="law-text" style="margin-top:4px">' + diffHtml(d.new) + "</p></div></div></div>";
        return out + "</article>";
      }).join("");
      if (!shown.length) right += '<p class="card small muted">해당 판정의 조문이 없어요.</p>';
      right += "</div>";
    }
    return '<div class="wrap page"><header class="stack" style="gap:6px;margin-bottom:22px"><span class="pill" style="align-self:flex-start">공직자 실무</span><h1 class="row" style="font-size:clamp(1.5rem,3.6vw,1.9rem);font-weight:900;gap:8px;flex-wrap:nowrap"><span style="color:var(--blue-600);display:inline-flex">' + ico("scan") + '</span>자체규정 점검</h1><p class="muted" style="line-height:1.85"><span class="block">우리 기관 규정 파일(한글·PDF·Word)을 넣으면</span><span class="block balance">상위법령과 대조해 <span class="nowrap">상충·검토 필요 조항,</span> <span class="nowrap">근거 조문, 개정안을</span> 보여 드려요.</span></p></header>' +
      '<div class="grid-2">' + left + '<section id="compliance-result" style="min-width:0" aria-label="교차 검증 결과" aria-live="polite">' + right + "</section></div></div>";
  }
  function runCheck() {
    var c = state.comp;
    if (!c.text.trim()) { toast("규정을 붙여 넣거나 파일을 올려 주세요."); return; }
    c.report = L.crossCheck({ text: c.text, orgType: c.orgType, regName: c.regName || undefined, laws: L.TARGET_LAWS.map(function (t) { return lawById(t.id); }).filter(Boolean) });
    c.filter = "all";
    render();
    var el = document.getElementById("compliance-result");
    if (el && window.innerWidth < 900) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function loadFile(file) {
    if (!file) return;
    var c = state.comp;
    c.extracting = file.name;
    c.error = "";
    render();
    L.extractText(file).then(function (info) {
      c.text = info.text;
      if (!c.regName) c.regName = file.name.replace(/\.[^.]+$/, "").replace(/_+/g, " ").trim();
      c.loaded = { name: file.name, format: info.format, pages: info.pages, chars: info.text.length, warnings: info.warnings, articles: (info.text.match(/^\s*제\s*\d+\s*조/gm) || []).length };
      c.report = null;
    }, function (e) {
      c.error = (e && e.message) || "파일을 읽지 못했어요.";
      c.loaded = null;
    }).then(function () {
      c.extracting = "";
      render();
    });
  }

  // ───────────────────────── 판례 보기
  function viewCases() {
    var qs = (state.mode === "officer" ? ["청탁금지법 금품", "공유재산 무단점유 변상금", "공직선거법 기부행위", "통상임금", "지방공기업 임원"] : ["층간소음", "임대차보증금 반환", "임금체불", "음주운전", "정보공개 거부"]);
    return '<div class="wrap page"><header class="stack" style="gap:6px;margin-bottom:22px"><span class="pill" style="align-self:flex-start">판례·법령해석례</span><h1 style="font-size:clamp(1.5rem,3.6vw,1.9rem);font-weight:900">판례 보기</h1><p class="muted"><span class="block">비슷한 사건에서 법원이 어떻게 판단했는지 찾아봐요.</span></p></header>' +
      '<div class="card stack" style="max-width:46rem"><p class="notice info">판례 원문은 국가법령정보센터 실시간 조회(인증키)가 필요해요. 법이음 실행본에서는 화면 안에서 쉬운 설명과 함께 보여 드리고, 이 공유판에서는 국가법령정보센터 판례 검색으로 바로 연결해요.</p>' +
      '<form class="search" data-form="cases" style="margin:0;max-width:none"><input id="caseq" name="q" autocomplete="off" aria-label="판례 검색어" placeholder="예) 임대차보증금 반환"><button class="btn btn-primary" type="submit">' + ico("search") + "판례 검색</button></form>" +
      '<div class="row" style="gap:6px">' + qs.map(function (q) { return '<a class="chip" style="text-decoration:none" href="' + caseLink(q) + '" target="_blank" rel="noopener"># ' + esc(q) + "</a>"; }).join("") + "</div></div></div>";
  }

  // ───────────────────────── 법령 둘러보기
  function viewLaws() {
    var s = state.laws;
    var kinds = ["전체"].concat(Array.from(new Set(L.MOCK_LAWS.map(function (l) { return l.kind; }))));
    var q = s.q.replace(/\s/g, "");
    var list = L.MOCK_LAWS.filter(function (l) {
      return (s.kind === "전체" || l.kind === s.kind) && (!q || l.name.replace(/\s/g, "").indexOf(q) >= 0 || l.articles.some(function (a) { return (a.title || "").indexOf(s.q.trim()) >= 0; }));
    });
    return '<div class="wrap page"><header class="stack" style="gap:6px;margin-bottom:22px"><span class="pill" style="align-self:flex-start">내장 공식 원문 ' + L.MOCK_LAWS.length + '개 법령</span><h1 style="font-size:clamp(1.5rem,3.6vw,1.9rem);font-weight:900">법령 둘러보기</h1><p class="muted"><span class="block">국가법령정보센터 공식 원문 스냅샷(' + esc(L.MOCK_DATASET_DATE) + ')에서 핵심 조문을 바로 읽어요.</span><span class="block">전체 법령 실시간 검색은 법이음 실행본(인증키 연결)에서 제공해요.</span></p></header>' +
      '<div class="row" style="margin-bottom:16px"><input id="lawq" class="input" style="max-width:22rem" data-bind="laws.q" data-live="1" placeholder="법령명 또는 조문 제목" value="' + esc(s.q) + '" aria-label="법령 검색"><div class="row" style="gap:6px">' + kinds.map(function (k) { return '<button type="button" class="chip" data-action="kind" data-kind="' + esc(k) + '"' + (s.kind === k ? ' style="background:var(--blue-600);color:#fff;border-color:var(--blue-600)"' : "") + ">" + esc(k) + "</button>"; }).join("") + "</div></div>" +
      '<div class="law-list" id="law-list">' + (list.length ? list.map(function (l) { return '<button type="button" class="law-item" data-action="open-law" data-id="' + esc(l.id) + '"><span class="xs muted" style="font-weight:700">' + esc(l.kind) + " · " + esc(l.ministry) + "</span><strong>" + esc(l.name) + '</strong><span class="xs muted">수록 조문 ' + l.articles.length + "개" + (l.effectiveDate ? " · 시행 " + esc(l.effectiveDate.replace(/(\d{4})(\d{2})(\d{2})/, "$1.$2.$3")) : "") + "</span></button>"; }).join("") : '<p class="muted small">찾는 법령이 내장 데이터에 없어요.</p>') + "</div></div>";
  }

  // ───────────────────────── 조문 보기 창
  function openLaw(lawId, articleNo) {
    var law = lawById(lawId);
    var dlg = $("#viewer");
    if (!law) return;
    $("#viewer-kind").textContent = law.kind + " · " + law.ministry + (law.officialSnapshot ? " · 공식 원문 " + law.officialSnapshot : "");
    $("#viewer-title").textContent = "「" + law.name + "」";
    $("#viewer-body").innerHTML = law.articles.map(function (a) {
      var c = L.toCitation(law, a);
      return '<section class="viewer-art' + (a.no === articleNo ? " hit" : "") + '" id="va-' + esc(a.no) + '"><div class="row between"><h3>' + esc(L.articleLabel(a.no)) + (a.title ? "(" + esc(a.title) + ")" : "") + '</h3><button type="button" class="btn btn-outline" data-action="copy-cite" data-key="' + esc(c.key) + '">' + ico("copy") + '인용 복사</button></div><p class="law-text" style="margin-top:6px">' + esc(a.text) + "</p></section>";
    }).join("") + '<a class="small" href="' + esc(law.articles[0] ? L.toCitation(law, law.articles[0]).url : "https://www.law.go.kr") + '" target="_blank" rel="noopener">국가법령정보센터에서 전체 원문 보기 →</a>';
    if (!dlg.open) dlg.showModal();
    var hit = articleNo && document.getElementById("va-" + articleNo);
    if (hit) hit.scrollIntoView({ block: "start" });
    else $("#viewer-body").scrollTop = 0;
  }
  function findCitation(key) {
    var c = state.citations.find(function (x) { return x.key === key; });
    if (c) return c;
    var i = key.lastIndexOf(":");
    return citationOf(key.slice(0, i), key.slice(i + 1));
  }

  // ───────────────────────── 렌더링·이벤트
  function render() {
    applyChrome();
    var v = currentView();
    var html = { home: viewHome, search: viewSearch, analyze: viewAnalyze, compliance: viewCompliance, cases: viewCases, laws: viewLaws }[v]();
    $("#main").innerHTML = html;
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-action],[data-mode],[data-font]");
    if (!t) return;
    if (t.dataset.mode && !t.dataset.action) {
      state.mode = t.dataset.mode;
      store.set("mode", state.mode);
      if (state.ask.result && currentView() === "search") runAsk(state.ask.query);
      else render();
      return;
    }
    if (t.dataset.font && !t.dataset.action) {
      state.font = Number(t.dataset.font);
      store.set("font", String(state.font));
      applyChrome();
      return;
    }
    var a = t.dataset.action, c = state.comp;
    if (a === "ask") runAsk(t.dataset.q);
    else if (a === "cite") { var ci = findCitation(t.dataset.key); if (ci) openLaw(ci.lawId, ci.articleNo); }
    else if (a === "copy-cite") { var cc = findCitation(t.dataset.key); if (cc) copy(lawLabel(cc), "인용 표기를 복사했어요."); }
    else if (a === "close-viewer") $("#viewer").close();
    else if (a === "analyze") runAnalyze();
    else if (a === "role") { state.analyze.tab = t.dataset.role; render(); }
    else if (a === "set-mode") { state.mode = t.dataset.modeTo; store.set("mode", state.mode); render(); }
    else if (a === "sample") { var s = L.SAMPLE_REGULATIONS[Number(t.dataset.i)]; c.text = s.text; c.orgType = s.orgType; c.regName = s.name; c.loaded = null; c.error = ""; c.report = null; render(); }
    else if (a === "pick-file") $("#file").click();
    else if (a === "clear-loaded") { c.loaded = null; render(); }
    else if (a === "check") runCheck();
    else if (a === "filter") { c.filter = c.filter === t.dataset.sev ? "all" : t.dataset.sev; render(); }
    else if (a === "copy-report") copy(L.complianceReport(c.report, function (id) { var l = lawById(id); return l ? l.name : id; }), "검토 보고서를 복사했어요.");
    else if (a === "copy-amend") copy(t.dataset.text, "개정안을 복사했어요.");
    else if (a === "kind") { state.laws.kind = t.dataset.kind; render(); }
    else if (a === "open-law") openLaw(t.dataset.id);
  });
  document.addEventListener("keydown", function (e) {
    if ((e.key === "Enter" || e.key === " ") && e.target.id === "drop") { e.preventDefault(); $("#file").click(); }
  });
  document.addEventListener("change", function (e) {
    if (e.target.id === "file") { loadFile(e.target.files && e.target.files[0]); e.target.value = ""; }
  });
  document.addEventListener("input", function (e) {
    var b = e.target.dataset && e.target.dataset.bind;
    if (!b) return;
    var parts = b.split(".");
    state[parts[0]][parts[1]] = e.target.value;
    if (e.target.dataset.live) {
      // 목록만 다시 그려 입력 포커스를 유지
      var tmp = document.createElement("div");
      tmp.innerHTML = viewLaws();
      $("#law-list").replaceWith(tmp.querySelector("#law-list"));
    }
  });
  document.addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target.dataset.form;
    if (f === "ask") runAsk(e.target.q.value);
    if (f === "cases") { var q = e.target.q.value.trim(); if (q) { var a = document.createElement("a"); a.href = caseLink(q); a.target = "_blank"; a.rel = "noopener"; a.click(); } }
  });
  // 파일 끌어다 놓기: 입력 영역 전체가 받는다
  var depth = 0;
  document.addEventListener("dragenter", function (e) {
    var z = e.target.closest && e.target.closest("#comp-input");
    if (!z) return;
    depth++;
    z.classList.add("drag");
    var d = $("#drop");
    if (d) d.classList.add("drag");
  });
  document.addEventListener("dragleave", function (e) {
    var z = e.target.closest && e.target.closest("#comp-input");
    if (!z) return;
    if (--depth <= 0) { depth = 0; z.classList.remove("drag"); var d = $("#drop"); if (d) d.classList.remove("drag"); }
  });
  document.addEventListener("dragover", function (e) { if (e.target.closest && e.target.closest("#comp-input")) e.preventDefault(); });
  document.addEventListener("drop", function (e) {
    var z = e.target.closest && e.target.closest("#comp-input");
    if (!z) return;
    e.preventDefault();
    depth = 0;
    z.classList.remove("drag");
    loadFile(e.dataTransfer.files && e.dataTransfer.files[0]);
  });
  $("#viewer").addEventListener("click", function (e) { if (e.target === e.currentTarget) e.currentTarget.close(); });
  window.addEventListener("hashchange", function () { render(); window.scrollTo(0, 0); });

  $("#banner-data").textContent = "국가법령정보센터 공식 원문 스냅샷 " + L.MOCK_DATASET_DATE;
  $("#footer-date").textContent = "(" + L.MOCK_DATASET_DATE + " 기준, " + L.MOCK_LAWS.length + "개 법령)";
  if (currentView() === "search") location.hash = "home";
  render();
})();
