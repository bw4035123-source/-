"use client";
import * as React from "react";
import { commaBreak, koreanWrap, unwrapKorean } from "@/lib/korean-wrap";

/**
 * 한국어 줄바꿈 다듬기(화면 표시만) — keep-all 에서 '괴롭힘·성희롱'처럼 가운뎃점으로 이은 긴 말은 한 낱말로 취급돼
 * 좁은 화면에서 낱말 중간이나 '·' 앞에서 끊기므로, 가운뎃점 뒤에 보이지 않는 줄바꿈 자리(U+200B), 앞에 줄바꿈 금지(U+2060)를 넣고
 * '2026. 3. 12.' 같은 날짜와 '맹신하지 말고'·'변호사 등'처럼 앞말에 기대는 짧은 말은 붙여 둔다(U+00A0, lib/korean-wrap.ts). 입력칸·코드·원문 서식(pre)은 건드리지 않고,
 * 안내·설명 글(흐린 글씨 text-muted-foreground 또는 .desc)은 쉼표(', ') 뒤에서 줄을 바꾼다(PC·휴대폰 모두, data-ko-br → pre-line).
 * 사용자가 끌어 선택해 복사할 때는 넣은 문자를 다시 빼 원래 글이 복사되게 한다.
 */
// 단추·탭 등 짧은 조작 요소는 줄바꿈 문제가 드물고, 바꾸면 접근성 이름(화면낭독기·자동 시험)이 달라지므로 건드리지 않음
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "SELECT", "OPTION", "PRE", "CODE", "NOSCRIPT", "BUTTON"]);
// 조작 요소 역할만 건너뜀(note·alert·status·region 같은 안내 글은 다듬음)
const INTERACTIVE = /^(button|tab|menuitem\w*|option|link|switch|checkbox|radio|combobox|textbox|searchbox|slider|spinbutton|treeitem|gridcell)$/;
// 쉼표 줄바꿈을 하지 않는 곳: 법령 원문·표·신구 대비(삭제·추가 표시)·이미 줄을 직접 맞춘 글
const NO_COMMA_TAGS = new Set(["LABEL", "TD", "TH", "INS", "DEL", "S", "U", "SELECT", "OPTION"]);
const NO_COMMA_CLASS = /(^|\s)(law-text|font-serif|font-mono|whitespace-pre|whitespace-pre-wrap|whitespace-pre-line|whitespace-nowrap|keep-phrase|truncate|line-clamp-\d)(\s|$)/;
// 글자 색 클래스 — 가장 가까운 것이 흐린 글씨(안내·설명)일 때만 쉼표 줄바꿈
const COLOR = /(^|\s)text-(muted-foreground|foreground|primary|accent|white|black|card-foreground|secondary-foreground|destructive|(?:rose|red|amber|emerald|sky|blue|green|slate|zinc|gray|orange|yellow|violet|indigo)-\d{2,3})(\s|$)/;

function fix(node: Text) {
  const v = node.nodeValue;
  if (!v || (v.indexOf("·") < 0 && v.indexOf(" ") < 0 && v.indexOf("\u00A0") < 0)) return;
  let dots = true;
  let comma = true;
  let desc: boolean | null = null; // 가장 가까운 글자 색이 흐린 글씨인지
  for (let p = node.parentElement; p; p = p.parentElement) {
    if (p.tagName === "LABEL") dots = false;
    if (SKIP.has(p.tagName) || p.isContentEditable || p.dataset.noWrapFix !== undefined || INTERACTIVE.test(p.getAttribute("role") ?? "")) return;
    const cls = typeof p.className === "string" ? p.className : "";
    if (NO_COMMA_TAGS.has(p.tagName) || NO_COMMA_CLASS.test(cls) || p.dataset.noCommaBreak !== undefined) comma = false;
    if (desc === null) {
      if (/(^|\s)desc(\s|$)/.test(cls) || p.dataset.commaBreak !== undefined) desc = true;
      else {
        const m = cls.match(COLOR);
        if (m) desc = m[2] === "muted-foreground";
      }
    }
    if (p === document.body) break;
  }
  let next = koreanWrap(v, dots);
  if (comma && desc && next.indexOf(",") >= 0) {
    // 같은 문단에서 앞에 있는 글(굵은 글씨 등으로 나뉜 부분)도 쉼표 앞 구절 길이에 셈
    const block = node.parentElement?.closest("p, li, dd, dt, h1, h2, h3, h4, h5, h6, figcaption, blockquote, div");
    let before = "";
    if (block) {
      const r = document.createRange();
      r.setStart(block, 0);
      r.setEnd(node, 0);
      before = r.toString();
    }
    const broken = commaBreak(next, before);
    if (broken !== next) {
      next = broken;
      node.parentElement?.setAttribute("data-ko-br", "");
    }
  }
  if (next !== v) node.nodeValue = next;
}
function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return fix(root as Text);
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = it.nextNode(); n; n = it.nextNode()) fix(n as Text);
}

export function KoreanWrap() {
  React.useEffect(() => {
    walk(document.body);
    let pending: Node[] = [];
    let raf = 0;
    const mo = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === "characterData") pending.push(m.target);
        else m.addedNodes.forEach((n) => pending.push(n));
      }
      if (!raf)
        raf = requestAnimationFrame(() => {
          const todo = pending;
          pending = [];
          raf = 0;
          todo.forEach((n) => n.isConnected && walk(n));
        });
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    const onCopy = (e: ClipboardEvent) => {
      const s = window.getSelection()?.toString() ?? "";
      if (!/[\u200B\u2060\u00A0]|,\n/.test(s) || !e.clipboardData) return;
      e.clipboardData.setData("text/plain", unwrapKorean(s));
      e.preventDefault();
    };
    document.addEventListener("copy", onCopy);
    return () => {
      mo.disconnect();
      cancelAnimationFrame(raf);
      document.removeEventListener("copy", onCopy);
    };
  }, []);
  return null;
}
