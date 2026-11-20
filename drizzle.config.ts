import { defineConfig } from "drizzle-kit";

// マイグレーションの SQL を作る設定(npx drizzle-kit generate)。
// 実行は src/infrastructure/db/database.ts が、DB を開く時に行う
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/infrastructure/db/schema.ts",
  out: "./drizzle",
});
