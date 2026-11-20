import path from "node:path";
import type { MarketDataSource } from "@/application/ports";
import { AlpacaMarketData } from "./alpaca/alpaca-market-data";
import { DEFAULT_DB_PATH } from "./db/database";
import { FakeMarketData } from "./fake/fake-market-data";

/**
 * 市場データの取得元を作る。画面のサーバーと自動売買のプロセスの両方が使う。
 * DAYTRADE_FAKE_MARKET_DATA=1 の時だけ、通信しないテスト用の取得元にする。
 * テスト用の取得元が作る足を本番の DB に保存しないように、既定の DB ファイルとは一緒に使えない(T8 のセキュリティレビュー 1)
 */
export function createMarketDataSource(env: NodeJS.ProcessEnv = process.env): MarketDataSource {
  if (env.DAYTRADE_FAKE_MARKET_DATA !== "1") return new AlpacaMarketData();
  const dbPath = env.DAYTRADE_DB_PATH;
  if (!dbPath || path.resolve(dbPath) === path.resolve(DEFAULT_DB_PATH)) {
    throw new Error("テスト用の取得元(DAYTRADE_FAKE_MARKET_DATA=1)は、既定の DB ファイルとは一緒に使えません");
  }
  return new FakeMarketData({
    failOnce: (env.DAYTRADE_FAKE_FAIL_ONCE ?? "").split(",").filter(Boolean),
    delayMs: Number(env.DAYTRADE_FAKE_DELAY_MS ?? "0"),
  });
}
