"use client";
import * as React from "react";
import { koreanWrap, sentenceBreak, unwrapKorean } from "@/lib/korean-wrap";

/**
 * 한국어 줄바꿈 다듬기(화면 표시만) — keep-all 에서 '괴롭힘·성희롱'처럼 가운뎃점으로 이은 긴 말은 한 낱말로 취급돼
 * 좁은 화면에서 낱말 중간이나 '·' 앞에서 끊기므로, 가운뎃점 뒤에 보이지 않는 줄바꿈 자리(U+200B), 앞에 줄바꿈 금지(U+2060)를 넣고
 * '2026. 3. 12.' 같은 날짜와 '맹신하지 말고'·'변호사 등'처럼 앞말에 기대는 짧은 말은 붙여 둔다(U+00A0, lib/korean-wrap.ts). 입력칸·코드·원문 서식(pre)은 건드리지 않고,
 * 줄을 강제로 바꾸지 않고 의미 단위만 묶는다 — 실제 줄바꿈 위치는 화면 너비에 맡김(반응형).
 * 사용자가 끌어 선택해 복사할 때는 넣은 문자를 다시 빼 원래 글이 복사되게 한다.
 */
// 단추·탭 등 짧은 조작 요소는 줄바꿈 문제가 드물고, 바꾸면 접근성 이름(화면낭독기·자동 시험)이 달라지므로 건드리지 않음
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "SELECT", "OPTION", "PRE", "CODE", "NOSCRIPT", "BUTTON"]);
// 조작 요소 역할만 건너뜀(note·alert·status·region 같은 안내 글은 다듬음)
const INTERACTIVE = /^(button|tab|menuitem\w*|option|link|switch|checkbox|radio|combobox|textbox|searchbox|slider|spinbutton|treeitem|gridcell)$/;
function fix(node: Text) {
  const v = node.nodeValue;
  if (!v || (v.indexOf("·") < 0 && v.indexOf(" ") < 0 && v.indexOf("\u00A0") < 0)) return;
  let dots = true;
  let sentences = false;
  for (let p = node.parentElement; p; p = p.parentElement) {
    if (p.tagName === "LABEL") dots = false;
    if (p.classList.contains("ko-sentences")) sentences = true;
    if (SKIP.has(p.tagName) || p.isContentEditable || p.dataset.noWrapFix !== undefined || INTERACTIVE.test(p.getAttribute("role") ?? "")) return;
    if (p === document.body) break;
  }
  let next = koreanWrap(v, dots);
  // 여러 문장짜리 안내·면책 문구: 마침표 뒤에서 새 줄(.ko-sentences 는 white-space: pre-line)
  if (sentences) {
    next = sentenceBreak(next);
    // 앞 문장이 다른 요소(굵은 글씨·묶음)에서 마침표로 끝났으면 이 글 앞 공백을 새 줄로
    if (/^[ \u00A0]+\S/.test(next)) {
      const block = node.parentElement?.closest(".ko-sentences");
      if (block) {
        const r = document.createRange();
        r.setStart(block, 0);
        r.setEnd(node, 0);
        if (/[가-힣)」』’”]\.$/.test(r.toString())) next = next.replace(/^[ \u00A0]+/, "\n");
      }
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
      if (!/[\u200B\u2060\u00A0]|\.\n/.test(s) || !e.clipboardData) return;
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
