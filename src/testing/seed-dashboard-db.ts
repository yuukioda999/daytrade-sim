/**
 * 画面のテスト(e2e/dashboard.spec.ts)が使う DB を作る。通信しない。
 * 2026-11-02 の 09:30 から 10:17(米国東部時間)まで、自動売買のプロセスを1分ごとに動かした時と同じ記録を作る:
 * - SOXL: 09:45 に買いサイン、09:50 に 78.45 で買い、09:55 に 77.10 で損切り(SPEC-003 例1、例2)
 * - TQQQ: 同じ形で買い、そのまま持っている
 * 使い方: tsx src/testing/seed-dashboard-db.ts <DB ファイル>(既定の DB ファイルには書かない)
 */
import { runTick } from "@/application/worker-service";
import { DEFAULT_DB_PATH, openDatabase } from "@/infrastructure/db/database";
import { sqliteRepositories } from "@/infrastructure/db/sqlite-repositories";
import { isSameDbFile } from "@/infrastructure/market-data-factory";
import { bar, CREDS, DATE, et, ScriptedSource, SOXL_DAY } from "./scripted-market";

export const SEED_END = et(10, 17);

export const TQQQ_DAY = [
  ...SOXL_DAY.slice(0, 5).map((b) => ({ ...b, symbol: "TQQQ" })),
  bar("TQQQ", DATE, 9, 55, 78.5, 79.3, 78.4, 79.2, 110),
];

async function main() {
  const file = process.argv[2];
  if (!file || isSameDbFile(file, DEFAULT_DB_PATH)) {
    throw new Error("既定でない DB ファイルを指定してください");
  }
  let clock = et(9, 0);
  const repos = sqliteRepositories(openDatabase(file), () => clock);
  repos.credentials.save(CREDS);
  const source = new ScriptedSource({ SOXL: SOXL_DAY, TQQQ: TQQQ_DAY });
  for (let t = et(9, 30).getTime(); t <= SEED_END.getTime(); t += 60_000) {
    clock = new Date(t);
    await runTick({ repos, source }, clock);
  }
  const trades = repos.trading.listTrades(DATE);
  console.log(`画面のテストの DB を作りました: ${trades.length} 件の練習売買`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
