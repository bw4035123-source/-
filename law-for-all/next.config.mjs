const isExport = process.env.NEXT_OUTPUT === "export";

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 기본: standalone(Node·Docker 배포) / NEXT_OUTPUT=export: 정적 파일(Python 서버 배포판, scripts/build-python.mjs)
  output: isExport ? "export" : "standalone",
  poweredByHeader: false,
  // 정적 배포판에서는 Python 서버가 같은 보안 헤더를 붙인다
  ...(isExport ? {} : { headers: async () => [{ source: "/(.*)", headers: SECURITY_HEADERS }] }),
};

export default nextConfig;
