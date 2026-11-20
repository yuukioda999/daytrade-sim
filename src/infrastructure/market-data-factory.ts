import { existsSync, realpathSync, statSync } from "node:fs";
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
  if (!dbPath || isSameDbFile(dbPath, DEFAULT_DB_PATH)) {
    throw new Error("テスト用の取得元(DAYTRADE_FAKE_MARKET_DATA=1)は、既定の DB ファイルとは一緒に使えません");
  }
  return new FakeMarketData({
    failOnce: (env.DAYTRADE_FAKE_FAIL_ONCE ?? "").split(",").filter(Boolean),
    delayMs: Number(env.DAYTRADE_FAKE_DELAY_MS ?? "0"),
  });
}

/**
 * 画面のテストで使う、止まった時計(DAYTRADE_FAKE_NOW)。テスト用の取得元を使う時だけ受け付ける。
 * 本番の DB と一緒に使う形や、時刻の形が正しくない時は、黙って本物の時計に戻さずに断る
 */
export function fixedNowFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): Date | null {
  const text = env.DAYTRADE_FAKE_NOW;
  if (!text) return null;
  if (env.DAYTRADE_FAKE_MARKET_DATA !== "1" || !env.DAYTRADE_DB_PATH || isSameDbFile(env.DAYTRADE_DB_PATH, DEFAULT_DB_PATH)) {
    throw new Error("止まった時計(DAYTRADE_FAKE_NOW)は、テスト用の取得元と、既定でない DB ファイルと一緒にだけ使えます");
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(text)) {
    throw new Error("DAYTRADE_FAKE_NOW は 2026-11-02T15:17:30Z の形で書きます");
  }
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) throw new Error("DAYTRADE_FAKE_NOW の時刻が正しくありません");
  return d;
}

/**
 * 2つのパスが同じ DB ファイルを指すか。シンボリックリンクと、Mac の大文字と小文字を区別しないファイルシステムを考える
 * (T9 のセキュリティレビュー 1)。迷う時は「同じ」とみなす(テスト用の取得元を断る側に倒す)
 */
export function isSameDbFile(a: string, b: string): boolean {
  const real = (p: string): string => {
    const abs = path.resolve(p);
    const dir = path.dirname(abs);
    const dirReal = existsSync(dir) ? realpathSync(dir) : dir;
    return path.join(dirReal, path.basename(abs));
  };
  const ra = real(a);
  const rb = real(b);
  if (ra.toLowerCase() === rb.toLowerCase()) return true;
  if (existsSync(ra) && existsSync(rb)) {
    const sa = statSync(ra);
    const sb = statSync(rb);
    return sa.dev === sb.dev && sa.ino === sb.ino;
  }
  return false;
}
