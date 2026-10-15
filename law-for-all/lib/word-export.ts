/** Word(.doc) 내려받기 — HTML 기반 Word 문서(MS Word·한글에서 열림). 외부 라이브러리 불필요 */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function downloadWord(filename: string, sections: { title?: string; body?: string; html?: string }[]): void {
  const html = `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(filename)}</title>
<style>body{font-family:'맑은 고딕','Malgun Gothic',sans-serif;font-size:11pt;line-height:1.6}pre{font-family:inherit;white-space:pre-wrap;margin:0}h2{font-size:13pt;margin:18pt 0 6pt}table{border-collapse:collapse;width:100%}td,th{border:1px solid #333;padding:6pt;vertical-align:top;font-size:10pt;white-space:pre-wrap}th{background:#eee}u{text-decoration:underline;font-weight:bold}br.pb{page-break-before:always}</style></head><body>
${sections.map((s, i) => `${i ? '<br class="pb" style="page-break-before:always">' : ""}${s.title ? `<h2>${esc(s.title)}</h2>` : ""}${s.html ?? `<pre>${esc(s.body ?? "")}</pre>`}`).join("\n")}
</body></html>`;
  const blob = new Blob(["﻿", html], { type: "application/msword" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${filename.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80)}.doc`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

export { esc as escapeHtml };
