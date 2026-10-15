import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // 테스트는 네트워크 없이: 기본 중계 서버(Render) 대신 직접 모드 + fetch 모킹
  test: { environment: "node", include: ["tests/**/*.test.ts"], env: { LAW_PROXY_URL: "off" } },
  resolve: {
    alias: {
      "@": r("./"),
      // Next.js 서버 전용 표식 모듈은 테스트에서 무력화
      "server-only": r("./tests/server-only-stub.ts"),
    },
  },
});
