/*!
 * 법이음(LAW:ON) — 2026 공공 AI 대전환 챌린지 상단 배너
 * - <body> 바로 뒤(첫 자식)에 고정 배너를 넣는다. 기존 React 번들은 건드리지 않는다.
 * - React 하이드레이션이 끝난 뒤에 넣어 하이드레이션 불일치를 만들지 않는다.
 * - 연동 상태는 /api/health 로 실제 확인해 표시(인증키 미설정이면 '실시간 연동'이라고 표시하지 않음).
 */
(function () {
  "use strict";
  if (window.__gc2026) return;
  window.__gc2026 = true;

  var ID = "gc2026-banner";
  var TITLE = "2026 공공 AI 대전환 챌린지";
  var LIVE = "국가법령정보센터(DRF) 실시간 연동";
  var GUARD = "Rule-Engine + LLM 할루시네이션 방지 가드레일 가동 중";

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function build() {
    var bar = el("div");
    bar.id = ID;
    bar.setAttribute("role", "status");
    bar.setAttribute("aria-live", "polite");
    bar.setAttribute("data-live", "unknown");
    bar.appendChild(el("span", "gc-badge", TITLE));
    bar.appendChild(el("span", "gc-sep", "|"));
    var live = el("span", "gc-live");
    live.appendChild(el("span", "gc-dot"));
    live.appendChild(document.createTextNode(LIVE));
    bar.appendChild(live);
    bar.appendChild(el("span", "gc-long gc-sep", "및"));
    bar.appendChild(el("span", "gc-long", GUARD));
    return bar;
  }

  function syncHeight(bar) {
    var h = bar.getBoundingClientRect().height || 0;
    document.documentElement.style.setProperty("--gc-banner-h", h + "px");
  }

  function checkStatus(bar) {
    if (!window.fetch) return;
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (ctrl) ctrl.abort();
    }, 8000);
    fetch("/api/health", { cache: "no-store", signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (j) {
        clearTimeout(timer);
        if (!j) return;
        var live = j.lawApi === "live";
        bar.setAttribute("data-live", live ? "true" : "false");
        var node = bar.querySelector(".gc-live");
        if (node && !live) node.lastChild.textContent = "국가법령정보센터(DRF) 연동 대기 — 인증키 설정 시 실시간, 현재 내장 원문";
        bar.title = live ? "법제처 국가법령정보 Open API 인증키가 설정되어 실시간 원문을 조회합니다." : "LAW_API_OC(법제처 Open API 인증키)를 설정하면 실시간 연동됩니다.";
        syncHeight(bar);
      })
      .catch(function () {
        clearTimeout(timer);
      });
  }

  function inject() {
    if (document.getElementById(ID) || !document.body) return;
    var bar = build();
    document.body.insertBefore(bar, document.body.firstChild);
    document.documentElement.classList.add("gc-has-banner");
    syncHeight(bar);
    window.addEventListener("resize", function () {
      syncHeight(bar);
    });
    checkStatus(bar);
  }

  // React(Next.js)가 문서를 하이드레이션했는지: 화면 요소에 React 내부 키가 붙었는지로 판단
  function hydrated() {
    var probe = document.querySelector("footer") || document.querySelector("main") || document.querySelector("header");
    if (!probe) return true; // React 화면이 아님(정적 오류 페이지 등) → 바로 주입
    for (var k in probe) {
      if (k.indexOf("__reactFiber$") === 0 || k.indexOf("__reactProps$") === 0) return true;
    }
    return false;
  }

  function waitAndInject() {
    var started = Date.now();
    (function tick() {
      if (hydrated() || Date.now() - started > 6000) {
        // 하이드레이션 커밋이 끝나도록 한 프레임 더 기다린 뒤 주입
        requestAnimationFrame(function () {
          setTimeout(inject, 0);
        });
      } else {
        setTimeout(tick, 60);
      }
    })();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", waitAndInject);
  else waitAndInject();
})();
