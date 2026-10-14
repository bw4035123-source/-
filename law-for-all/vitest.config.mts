import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
  resolve: {
    alias: {
      "@": r("./"),
      // Next.js 서버 전용 표식 모듈은 테스트에서 무력화
      "server-only": r("./tests/server-only-stub.ts"),
    },
  },
});
