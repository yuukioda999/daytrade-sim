import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixedNowFromEnv, isSameDbFile } from "./market-data-factory";

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

describe("同じ DB ファイルかの判定(T9 のセキュリティレビュー 1)", () => {
  it("シンボリックリンクと、大文字と小文字の違いも同じとみなす", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "daytrade-"));
    try {
      mkdirSync(path.join(dir, "data"));
      writeFileSync(path.join(dir, "data", "daytrade.db"), "");
      symlinkSync(path.join(dir, "data"), path.join(dir, "link"));
      const real = path.join(dir, "data", "daytrade.db");
      expect(isSameDbFile(path.join(dir, "link", "daytrade.db"), real)).toBe(true);
      expect(isSameDbFile(path.join(dir, "Data", "daytrade.db"), real)).toBe(true);
      expect(isSameDbFile(path.join(dir, "data", "other.db"), real)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("画面のテストの止まった時計(T10)", () => {
  const fake = { DAYTRADE_FAKE_MARKET_DATA: "1", DAYTRADE_DB_PATH: ".e2e/test.db" };

  it("指定がなければ本物の時計を使う", () => {
    expect(fixedNowFromEnv({ ...fake })).toBeNull();
  });

  it("テスト用の取得元と別の DB ファイルの時だけ、止まった時計を使う", () => {
    expect(fixedNowFromEnv({ ...fake, DAYTRADE_FAKE_NOW: "2026-11-02T15:17:30Z" })?.toISOString()).toBe("2026-11-02T15:17:30.000Z");
  });

  it("本物の取得元や既定の DB と一緒に指定したら、本物の時計に戻さずに断る", () => {
    expect(() => fixedNowFromEnv({ DAYTRADE_FAKE_NOW: "2026-11-02T15:17:30Z" })).toThrow();
    expect(() => fixedNowFromEnv({ DAYTRADE_FAKE_MARKET_DATA: "1", DAYTRADE_FAKE_NOW: "2026-11-02T15:17:30Z" })).toThrow();
    expect(() =>
      fixedNowFromEnv({ DAYTRADE_FAKE_MARKET_DATA: "1", DAYTRADE_DB_PATH: "data/daytrade.db", DAYTRADE_FAKE_NOW: "2026-11-02T15:17:30Z" }),
    ).toThrow();
  });

  it("時刻の形が正しくなければ断る", () => {
    expect(() => fixedNowFromEnv({ ...fake, DAYTRADE_FAKE_NOW: "tomorrow" })).toThrow();
    expect(() => fixedNowFromEnv({ ...fake, DAYTRADE_FAKE_NOW: "2026-13-02T15:17:30Z" })).toThrow();
  });
});
