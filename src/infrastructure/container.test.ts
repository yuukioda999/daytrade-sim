import { afterEach, describe, expect, it, vi } from "vitest";

/** 環境変数を変えて、container を毎回読み直す(中で一度だけ作って使い回すため) */
async function loadContainer(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v as string);
  delete (globalThis as { daytradeMarketData?: unknown }).daytradeMarketData;
  return import("./container");
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete (globalThis as { daytradeMarketData?: unknown }).daytradeMarketData;
});

describe("市場データの取得元の切り替え(T8 のセキュリティレビュー 1)", () => {
  it("環境変数がなければ Alpaca の取得元", async () => {
    const { getMarketDataSource } = await loadContainer({ DAYTRADE_FAKE_MARKET_DATA: "" });
    expect(getMarketDataSource().isTestSource).toBe(false);
  });

  it("テスト用の取得元は、別の DB ファイルを指定した時だけ使える", async () => {
    const { getMarketDataSource } = await loadContainer({
      DAYTRADE_FAKE_MARKET_DATA: "1",
      DAYTRADE_DB_PATH: ".e2e/test.db",
    });
    expect(getMarketDataSource().isTestSource).toBe(true);
  });

  it.each([undefined, "", "./data/daytrade.db", "data/daytrade.db"])(
    "DB ファイルが既定(%s)のままなら、テスト用の取得元は起動しない",
    async (dbPath) => {
      const { getMarketDataSource } = await loadContainer({ DAYTRADE_FAKE_MARKET_DATA: "1", DAYTRADE_DB_PATH: dbPath });
      expect(() => getMarketDataSource()).toThrow("既定の DB ファイル");
    },
  );
});
