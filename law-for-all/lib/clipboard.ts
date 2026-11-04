/** 클립보드 복사(비보안 컨텍스트·구형 브라우저 대비 fallback 포함) */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fallback */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** 표처럼 서식이 있는 내용 복사 — 한글·Word에 붙이면 표로 들어가도록 HTML과 일반 텍스트를 함께 넣음(안 되면 텍스트만) */
export async function copyRich(html: string, text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]);
      return true;
    }
  } catch {
    /* fallback */
  }
  return copyText(text);
}
