import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 画面のテストでは、2つ目のサーバー(ダッシュボードのテスト用)のビルドを別の場所に置く(playwright.config.ts)
  distDir: process.env.DAYTRADE_NEXT_DIST_DIR || ".next",
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
