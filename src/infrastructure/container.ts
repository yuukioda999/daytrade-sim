import "server-only";
import path from "node:path";
import type { MarketDataSource, Repositories } from "@/application/ports";
import { AlpacaMarketData } from "./alpaca/alpaca-market-data";
import { FakeMarketData } from "./fake/fake-market-data";
import { DEFAULT_DB_PATH, openDatabase } from "./db/database";
import { sqliteRepositories } from "./db/sqlite-repositories";

// 開発サーバーはファイルを変えるたびにこのモジュールを読み直すので、開いた DB を globalThis に置いて使い回す
const globalForDb = globalThis as unknown as { daytradeRepositories?: Repositories; daytradeMarketData?: MarketDataSource };

/** 画面のプロセスが使う保存先。DB ファイルの場所は DAYTRADE_DB_PATH で変えられる(画面のテスト用) */
export function getRepositories(): Repositories {
  if (!globalForDb.daytradeRepositories) {
    const file = process.env.DAYTRADE_DB_PATH || DEFAULT_DB_PATH;
    globalForDb.daytradeRepositories = sqliteRepositories(openDatabase(file));
  }
  return globalForDb.daytradeRepositories;
}

/**
 * 市場データの取得元。画面のテストだけは、通信しないテスト用の取得元を使う(DAYTRADE_FAKE_MARKET_DATA=1)。
 * テスト用の取得元は SOXL などの足を作るだけで、外へ通信しない
 */
export function getMarketDataSource(): MarketDataSource {
  if (!globalForDb.daytradeMarketData) {
    const fake = process.env.DAYTRADE_FAKE_MARKET_DATA === "1";
    // テスト用の取得元が作る足を、本番の DB に保存しないようにする(T8 のセキュリティレビュー 1)
    const dbPath = process.env.DAYTRADE_DB_PATH;
    if (fake && (!dbPath || path.resolve(dbPath) === path.resolve(DEFAULT_DB_PATH))) {
      throw new Error("テスト用の取得元(DAYTRADE_FAKE_MARKET_DATA=1)は、既定の DB ファイルとは一緒に使えません");
    }
    globalForDb.daytradeMarketData =
      fake
        ? new FakeMarketData({
            failOnce: (process.env.DAYTRADE_FAKE_FAIL_ONCE ?? "").split(",").filter(Boolean),
            delayMs: Number(process.env.DAYTRADE_FAKE_DELAY_MS ?? "0"),
          })
        : new AlpacaMarketData();
  }
  return globalForDb.daytradeMarketData;
}
