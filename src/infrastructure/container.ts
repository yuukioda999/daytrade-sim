import "server-only";
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
    globalForDb.daytradeMarketData =
      process.env.DAYTRADE_FAKE_MARKET_DATA === "1"
        ? new FakeMarketData({
            failOnce: (process.env.DAYTRADE_FAKE_FAIL_ONCE ?? "").split(",").filter(Boolean),
            delayMs: Number(process.env.DAYTRADE_FAKE_DELAY_MS ?? "0"),
          })
        : new AlpacaMarketData();
  }
  return globalForDb.daytradeMarketData;
}
