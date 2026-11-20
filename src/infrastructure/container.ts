import "server-only";
import type { MarketDataSource, Repositories } from "@/application/ports";
import { createMarketDataSource } from "./market-data-factory";
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

/** 市場データの取得元(作り方は market-data-factory.ts) */
export function getMarketDataSource(): MarketDataSource {
  if (!globalForDb.daytradeMarketData) globalForDb.daytradeMarketData = createMarketDataSource();
  return globalForDb.daytradeMarketData;
}
