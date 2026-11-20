import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-e2e-dashboard/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 画面のテストが作る報告書(中身は生成された JavaScript)
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
