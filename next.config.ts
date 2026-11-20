import type { NextConfig } from "next";

// 画面のテストでは、2つ目のサーバー(ダッシュボードのテスト用)のビルドを別の場所に置く(playwright.config.ts)。
// ビルドは置き場を消してから作るので、決めた2つの名前のほかは受け付けない(誤って data/ などを指すと消えるため。T10 のセキュリティレビュー 3)
const DIST_DIRS = [".next", ".next-e2e-dashboard"];
const distDir = process.env.DAYTRADE_NEXT_DIST_DIR || ".next";
if (!DIST_DIRS.includes(distDir)) {
  throw new Error(`DAYTRADE_NEXT_DIST_DIR は ${DIST_DIRS.join(" か ")} だけを指定できます`);
}

const nextConfig: NextConfig = {
  distDir,
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
