import { describe, expect, it } from "vitest";
import type { Repositories } from "@/application/ports";
import { memoryRepositories } from "@/infrastructure/memory/memory-repositories";
import { openDatabase } from "./database";
import { sqliteRepositories } from "./sqlite-repositories";

/** SQLite とメモリの実装が、同じふるまいをすることを確かめる(ADR-0003 の差し替え) */
let clock = new Date("2026-11-20T15:00:00Z");
const now = () => clock;
const IMPLEMENTATIONS: [string, () => Repositories][] = [
  ["SQLite", () => sqliteRepositories(openDatabase(":memory:"), now)],
  ["メモリ", () => memoryRepositories(now)],
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
      { symbol: "SOXL", barCount: 3, dayCount: 0, firstDate: null, lastDate: null },
      { symbol: "TQQQ", barCount: 1, dayCount: 0, firstDate: null, lastDate: null },
    ]);
  });

  it("取り終えた日を記録し、期間で読み出せる。同じ日を2回記録しても1回分", () => {
    const { bars } = create();
    bars.markFetched("SOXL", ["2026-11-02", "2026-11-03"]);
    bars.markFetched("SOXL", ["2026-11-03", "2026-11-04"]);
    bars.markFetched("TQQQ", ["2026-11-02"]);
    expect(bars.fetchedDates("SOXL", "2026-11-03", "2026-11-30")).toEqual(["2026-11-03", "2026-11-04"]);
    expect(bars.summary()).toEqual([
      { symbol: "SOXL", barCount: 0, dayCount: 3, firstDate: "2026-11-02", lastDate: "2026-11-04" },
      { symbol: "TQQQ", barCount: 0, dayCount: 1, firstDate: "2026-11-02", lastDate: "2026-11-02" },
    ]);
  });

  it("ADR-0009: 自動売買の ON / OFF を変えた時刻の履歴を、古い順に返す", () => {
    const { settings } = create();
    clock = new Date("2026-11-20T15:00:00Z");
    settings.setAutoTradingEnabled(false);
    clock = new Date("2026-11-20T16:00:00Z");
    settings.setAutoTradingEnabled(true);
    expect(settings.listAutoTradingChanges()).toEqual([
      { at: new Date("2026-11-20T15:00:00Z"), enabled: false },
      { at: new Date("2026-11-20T16:00:00Z"), enabled: true },
    ]);
  });

  it("足を期間で読み出す。受け取った時刻も残る。取り終えた日を、ある日より前から新しい順に数えて返す", () => {
    const { bars } = create();
    const b = (iso: string, receivedAt?: Date) => ({
      symbol: "SOXL",
      start: new Date(iso),
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      volume: 10,
      receivedAt,
    });
    bars.saveBars([
      b("2026-11-20T14:35:00Z", new Date("2026-11-20T15:00:00Z")),
      b("2026-11-20T14:30:00Z"),
      b("2026-11-20T21:00:00Z"),
    ]);
    const got = bars.barsBetween("SOXL", new Date("2026-11-20T14:30:00Z"), new Date("2026-11-20T21:00:00Z"));
    expect(got.map((x) => [x.start.toISOString(), x.receivedAt?.toISOString()])).toEqual([
      ["2026-11-20T14:30:00.000Z", undefined],
      ["2026-11-20T14:35:00.000Z", "2026-11-20T15:00:00.000Z"],
    ]);
    bars.markFetched("SOXL", ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]);
    expect(bars.fetchedDatesBefore("SOXL", "2026-11-20", 3)).toEqual(["2026-11-17", "2026-11-18", "2026-11-19"]);
  });

  it("その日の記録を置き換え、前の日までの損益の合計を返す。動いた日と様子を保存する", () => {
    const { trading } = create();
    const record = (date: string, pnl: number | null) => ({
      date,
      symbol: "SOXL",
      signalBarStart: new Date(`${date}T14:45:00Z`),
      entryTime: new Date(`${date}T14:50:00Z`),
      entryPrice: 78.45,
      shares: 0.4248,
      stopPrice: 77.1,
      exit: pnl === null ? null : { time: new Date(`${date}T14:55:00Z`), price: 77.1, reason: "stop" as const, pnlJpy: pnl },
      late: false,
    });
    trading.replaceDayTrades("2026-11-18", [record("2026-11-18", -86.022)]);
    trading.replaceDayTrades("2026-11-19", [record("2026-11-19", 100), record("2026-11-19", null)]);
    trading.replaceDayTrades("2026-11-19", [record("2026-11-19", 50)]);
    expect(trading.listTrades("2026-11-19")).toEqual([record("2026-11-19", 50)]);
    expect(trading.realizedBefore("2026-11-20")).toBeCloseTo(-36.022, 9);
    expect(trading.realizedBefore("2026-11-19")).toBeCloseTo(-86.022, 9);

    const run = {
      date: "2026-11-20",
      principalJpy: 10_000,
      fxRateX100: 15_000,
      startingRealizedJpy: -36.022,
      closed: false,
      startedAt: new Date("2026-11-20T14:30:00Z"),
    };
    trading.putDayRun(run);
    trading.putDayRun({ ...run, closed: true });
    expect(trading.getDayRun("2026-11-20")).toEqual({ ...run, closed: true });
    expect(trading.listDayRuns()).toHaveLength(1);

    const status = {
      heartbeatAt: new Date("2026-11-20T15:00:00Z"),
      lastBarReceivedAt: null,
      state: "running" as const,
      message: "動いています",
    };
    trading.putWorkerStatus(status);
    expect(trading.getWorkerStatus()).toEqual(status);
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
