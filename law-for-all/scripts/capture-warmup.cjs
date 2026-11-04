// 모의데이터 3종(한글·Word·PDF) 규정을 화면에서 실제로 검증해, 화면이 /api/compliance-ai 로 보내는 요청 본문을 그대로 저장
// → python/law_for_all/data/compliance_warmup.json (클라우드 서버가 뜰 때 이 본문으로 AI 검토를 미리 해 캐시에 넣음)
// 규칙(lib/compliance.ts)·조문 나누기·모의데이터를 바꾸면 다시 실행:  node scripts/capture-warmup.cjs [https://lawon.onrender.com]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] ?? "https://lawon.onrender.com";
(async () => {
  const b = await chromium.launch();
  const bodies = [];
  for (const kind of ["HWPX", "DOCX", "PDF"]) {
    const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
    p.on("request", (r) => {
      if (r.url().includes("/api/compliance-ai") && r.method() === "POST") bodies.push(JSON.parse(r.postData()));
    });
    await p.goto(`${BASE}/compliance?mode=officer`, { waitUntil: "networkidle" });
    await p.locator("main button:visible", { hasText: kind }).first().click();
    await p.waitForFunction(() => /AI 검토 완료|AI 검토를 하지 못했/.test(document.querySelector("#compliance-result")?.innerText ?? ""), null, { timeout: 240000 });
    await p.close();
  }
  const out = path.resolve(__dirname, "../python/law_for_all/data/compliance_warmup.json");
  fs.writeFileSync(out, JSON.stringify(bodies));
  console.log(`${bodies.length}묶음 저장 → ${out}`);
  await b.close();
})();
