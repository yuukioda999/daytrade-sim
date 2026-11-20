import { describe, expect, it } from "vitest";
import type { Repositories } from "@/application/ports";
import { memoryRepositories } from "@/infrastructure/memory/memory-repositories";
import { openDatabase } from "./database";
import { sqliteRepositories } from "./sqlite-repositories";

/** SQLite とメモリの実装が、同じふるまいをすることを確かめる(ADR-0003 の差し替え) */
const IMPLEMENTATIONS: [string, () => Repositories][] = [
  ["SQLite", () => sqliteRepositories(openDatabase(":memory:"))],
  ["メモリ", () => memoryRepositories()],
];

const CREDS = { keyId: "PKTESTKEY0000000ABCD", secret: "TestSecret0000000000000000000000000000000" };

describe.each(IMPLEMENTATIONS)("%s の保存先", (_, create) => {
  it("自動売買の ON / OFF は、保存前は null、保存後はその値", () => {
    const { settings } = create();
    expect(settings.getAutoTradingEnabled()).toBeNull();
    settings.setAutoTradingEnabled(true);
    expect(settings.getAutoTradingEnabled()).toBe(true);
    settings.setAutoTradingEnabled(false);
    expect(settings.getAutoTradingEnabled()).toBe(false);
  });

  it("元手と為替の履歴は、使い始める日の古い順。同じ日は置き換える", () => {
    const { settings } = create();
    settings.putMoneySettings({ effectiveDate: "2026-11-23", principalJpy: 20_000, fxRateX100: 15_000 });
    settings.putMoneySettings({ effectiveDate: "2026-11-02", principalJpy: 10_000, fxRateX100: 15_000 });
    settings.putMoneySettings({ effectiveDate: "2026-11-23", principalJpy: 30_000, fxRateX100: 14_050 });
    expect(settings.listMoneySettings()).toEqual([
      { effectiveDate: "2026-11-02", principalJpy: 10_000, fxRateX100: 15_000 },
      { effectiveDate: "2026-11-23", principalJpy: 30_000, fxRateX100: 14_050 },
    ]);
  });

  it("AC-006-10: 同じ銘柄の同じ時刻の足は二重に保存しない。新しく保存した本数を返す", () => {
    const { bars } = create();
    const bar = (symbol: string, iso: string, close: number) => ({
      symbol,
      start: new Date(iso),
      open: 1,
      high: 2,
      low: 0.5,
      close,
      volume: 100,
      vwap: 1.2,
    });
    expect(bars.saveBars([bar("SOXL", "2026-11-02T14:30:00Z", 1), bar("SOXL", "2026-11-02T14:35:00Z", 1)])).toBe(2);
    // 重なる期間を取り直しても、新しい足だけが増える(同じ時刻の足は前に保存したものを残す)
    expect(
      bars.saveBars([
        bar("SOXL", "2026-11-02T14:35:00Z", 9),
        bar("SOXL", "2026-11-02T14:40:00Z", 1),
        bar("TQQQ", "2026-11-02T14:35:00Z", 1),
      ]),
    ).toBe(2);
    expect(bars.summary()).toEqual([
      { symbol: "SOXL", barCount: 3, firstDate: null, lastDate: null },
      { symbol: "TQQQ", barCount: 1, firstDate: null, lastDate: null },
    ]);
  });

  it("取り終えた日を記録し、期間で読み出せる。同じ日を2回記録しても1回分", () => {
    const { bars } = create();
    bars.markFetched("SOXL", ["2026-11-02", "2026-11-03"]);
    bars.markFetched("SOXL", ["2026-11-03", "2026-11-04"]);
    bars.markFetched("TQQQ", ["2026-11-02"]);
    expect(bars.fetchedDates("SOXL", "2026-11-03", "2026-11-30")).toEqual(["2026-11-03", "2026-11-04"]);
    expect(bars.summary()).toEqual([
      { symbol: "SOXL", barCount: 0, firstDate: "2026-11-02", lastDate: "2026-11-04" },
      { symbol: "TQQQ", barCount: 0, firstDate: "2026-11-02", lastDate: "2026-11-02" },
    ]);
  });

  it("接続用キーを保存、上書き、削除できる", () => {
    const { credentials } = create();
    expect(credentials.get()).toBeNull();
    credentials.save(CREDS);
    expect(credentials.get()).toEqual(CREDS);
    const next = { keyId: "PKOTHERKEY000000WXYZ", secret: "OtherSecret000000000000000000000000000000" };
    credentials.save(next);
    expect(credentials.get()).toEqual(next);
    credentials.delete();
    expect(credentials.get()).toBeNull();
  });
});

describe("SQLite のファイル", () => {
  it("閉じて開き直しても、保存した値が残る。WAL で開く", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const dir = mkdtempSync(path.join(tmpdir(), "daytrade-"));
    const file = path.join(dir, "sub", "test.db");
    try {
      const db1 = openDatabase(file);
      sqliteRepositories(db1).settings.setAutoTradingEnabled(true);
      expect(db1.$client.pragma("journal_mode", { simple: true })).toBe("wal");
      // キーを平文で保存するので、自分だけが読める権限(T7 のセキュリティレビュー)
      const { statSync } = await import("node:fs");
      expect(statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
      for (const f of [file, `${file}-wal`, `${file}-shm`]) expect(statSync(f).mode & 0o777).toBe(0o600);
      db1.$client.close();
      const db2 = openDatabase(file);
      expect(sqliteRepositories(db2).settings.getAutoTradingEnabled()).toBe(true);
      db2.$client.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
