import "server-only";
import type { Repositories } from "@/application/ports";
import { DEFAULT_DB_PATH, openDatabase } from "./db/database";
import { sqliteRepositories } from "./db/sqlite-repositories";

// 開発サーバーはファイルを変えるたびにこのモジュールを読み直すので、開いた DB を globalThis に置いて使い回す
const globalForDb = globalThis as unknown as { daytradeRepositories?: Repositories };

/** 画面のプロセスが使う保存先。DB ファイルの場所は DAYTRADE_DB_PATH で変えられる(画面のテスト用) */
export function getRepositories(): Repositories {
  if (!globalForDb.daytradeRepositories) {
    const file = process.env.DAYTRADE_DB_PATH || DEFAULT_DB_PATH;
    globalForDb.daytradeRepositories = sqliteRepositories(openDatabase(file));
  }
  return globalForDb.daytradeRepositories;
}
