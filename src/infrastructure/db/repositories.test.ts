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
      db1.$client.close();
      const db2 = openDatabase(file);
      expect(sqliteRepositories(db2).settings.getAutoTradingEnabled()).toBe(true);
      db2.$client.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
