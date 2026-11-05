"use client";
import * as React from "react";
import { koreanWrap, unwrapKorean } from "@/lib/korean-wrap";

/**
 * 한국어 줄바꿈 다듬기(화면 표시만) — keep-all 에서 '괴롭힘·성희롱'처럼 가운뎃점으로 이은 긴 말은 한 낱말로 취급돼
 * 좁은 화면에서 낱말 중간이나 '·' 앞에서 끊기므로, 가운뎃점 뒤에 보이지 않는 줄바꿈 자리(U+200B), 앞에 줄바꿈 금지(U+2060)를 넣고
 * '2026. 3. 12.' 같은 날짜와 '맹신하지 말고'·'변호사 등'처럼 앞말에 기대는 짧은 말은 붙여 둔다(U+00A0, lib/korean-wrap.ts). 입력칸·코드·원문 서식(pre)은 건드리지 않고,
 * 사용자가 끌어 선택해 복사할 때는 넣은 문자를 다시 빼 원래 글이 복사되게 한다.
 */
// 단추·탭 등 짧은 조작 요소는 줄바꿈 문제가 드물고, 바꾸면 접근성 이름(화면낭독기·자동 시험)이 달라지므로 건드리지 않음
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "SELECT", "OPTION", "PRE", "CODE", "NOSCRIPT", "BUTTON", "LABEL"]);
function fix(node: Text) {
  const v = node.nodeValue;
  if (!v || (v.indexOf("·") < 0 && v.indexOf(" ") < 0)) return;
  for (let p = node.parentElement; p; p = p.parentElement) {
    if (SKIP.has(p.tagName) || p.isContentEditable || p.dataset.noWrapFix !== undefined || (p.getAttribute("role") ?? "") !== "") return;
    if (p === document.body) break;
  }
  const next = koreanWrap(v);
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
      if (!/[\u200B\u2060\u00A0]/.test(s) || !e.clipboardData) return;
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
