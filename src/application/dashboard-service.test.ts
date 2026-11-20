import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryRepositories } from "@/infrastructure/memory/memory-repositories";
import { bar, CREDS, DATE, et, ScriptedSource, SOXL_DAY } from "@/testing/scripted-market";
import { getDashboardView } from "./dashboard-service";
import type { Repositories } from "./ports";
import { runTick } from "./worker-service";

let clock: Date;
let repos: Repositories;
let source: ScriptedSource;

beforeEach(() => {
  clock = et(9, 0);
  repos = memoryRepositories(() => clock);
  source = new ScriptedSource({ SOXL: SOXL_DAY });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function tickEveryMinute(from: Date, to: Date) {
  for (let t = from.getTime(); t <= to.getTime(); t += 60_000) {
    clock = new Date(t);
    await runTick({ repos, source }, clock);
  }
}

const view = (now: Date) => getDashboardView({ repos }, now);

describe("自動売買のプロセスの様子", () => {
  it("AC-007-09: 一度も動いていなければ、起動の仕方を出す", () => {
    const v = view(et(10, 0));
    expect(v.worker).toMatchObject({ state: "never-started", stopped: true, heartbeatAt: null });
    expect(v.worker.message).toContain("npm run worker");
    expect(v.date).toBeNull();
    expect(v.money).toBeNull();
    expect(v.symbols.map((s) => s.symbol)).toEqual(["SOXL", "TQQQ", "TSLL", "NVDL"]);
  });

  it("AC-007-09: 最後に動いてから3分を超えたら「自動売買が止まっています」と、最後に動いた時刻を出す", async () => {
    repos.credentials.save(CREDS);
    await tickEveryMinute(et(9, 30), et(10, 0));
    expect(view(et(10, 3)).worker.stopped).toBe(false);
    const v = view(et(10, 3, DATE));
    expect(v.worker.heartbeatAt).toBe(et(10, 0).toISOString());
    const later = view(new Date(et(10, 3).getTime() + 1000));
    expect(later.worker).toMatchObject({ stopped: true, message: "自動売買が止まっています" });
  });

  it("AC-007-08: 最後にデータを受け取った時刻を出す", async () => {
    repos.credentials.save(CREDS);
    await tickEveryMinute(et(9, 30), et(10, 0));
    expect(view(et(10, 0)).worker.lastBarReceivedAt).not.toBeNull();
  });
});

describe("監視リストと買い(SPEC-002 例1、SPEC-003 例1)", () => {
  it("AC-007-11、14: 価格、前日の終値からの変化、3条件、朝の高値を超えた時刻を出す", async () => {
    repos.credentials.save(CREDS);
    await tickEveryMinute(et(9, 30), et(10, 12));
    const v = view(et(10, 12));
    expect(v).toMatchObject({ date: DATE, isToday: true });
    const soxl = v.symbols.find((s) => s.symbol === "SOXL");
    expect(soxl).toMatchObject({
      lastPrice: 78.5,
      previousClose: 70,
      orbHigh: 77.9,
      orbLow: 77.1,
      breakoutTime: et(9, 45).toISOString(),
      status: "holding",
    });
    expect(soxl?.changeRatio).toBeCloseTo(78.5 / 70 - 1, 10);
    expect(soxl?.bars).toHaveLength(5);
    expect(soxl?.vwapLine).toHaveLength(5);
    expect(soxl?.conditions?.orbBreakout).toBe(true);
    const tqqq = v.symbols.find((s) => s.symbol === "TQQQ");
    expect(tqqq).toMatchObject({ status: "watching", breakoutTime: null });
  });

  it("AC-007-15、16: 練習で買った価格、株数、損切りの価格と、持っている株の損益を出す", async () => {
    repos.credentials.save(CREDS);
    await tickEveryMinute(et(9, 30), et(10, 12));
    const v = view(et(10, 12));
    expect(v.trades).toHaveLength(1);
    expect(v.trades[0]).toMatchObject({ symbol: "SOXL", entryPrice: 78.45, shares: 0.4248, stopPrice: 77.1, exit: null });
    expect(v.trades[0].costJpy).toBeCloseTo(78.45 * 0.4248 * 150, 6);
    expect(v.positions).toHaveLength(1);
    // 手計算: (78.5 - 78.45) × 0.4248 × 150 = 3.186 円
    expect(v.positions[0]).toMatchObject({ symbol: "SOXL", lastPrice: 78.5, exitPrice: 77.1, exitKind: "stop" });
    expect(v.positions[0].unrealizedJpy).toBeCloseTo(3.186, 6);
    expect(v.money?.unrealizedJpy).toBeCloseTo(3.186, 6);
  });
});

describe("今日のお金の状況", () => {
  it("AC-007-16: 損切りのあと、残高、今日の損益、損失の上限の使用割合を出す", async () => {
    repos.credentials.save(CREDS);
    await tickEveryMinute(et(9, 30), et(10, 20));
    const v = view(et(10, 20));
    expect(v.positions).toEqual([]);
    expect(v.trades[0].exit).toMatchObject({ price: 77.1, reason: "stop" });
    expect(v.symbols.find((s) => s.symbol === "SOXL")?.status).toBe("sold");
    // 手計算: 損益 -86.022 円、上限 10,000 × 10% = 1,000 円、使用割合 0.086022
    expect(v.money?.principalJpy).toBe(10_000);
    expect(v.money?.todayRealizedJpy).toBeCloseTo(-86.022, 6);
    expect(v.money?.balanceJpy).toBeCloseTo(10_000 - 86.022, 6);
    expect(v.money?.dailyLossLimitJpy).toBe(1_000);
    expect(v.money?.lossLimitUsedRatio).toBeCloseTo(0.086022, 6);
    expect(v.money?.limitReached).toBe(false);
  });

  it("AC-007-17: 今日の損失が上限に達したら、達した印を出し、使用割合は 1 で止める", async () => {
    // 09:55 の足が 60 から始まり、損切りの価格より下で売る(損失は 1,000 円を超える)
    source = new ScriptedSource({
      SOXL: [...SOXL_DAY.slice(0, 5), bar("SOXL", DATE, 9, 55, 60, 60.5, 59, 60, 100)],
    });
    repos.credentials.save(CREDS);
    await tickEveryMinute(et(9, 30), et(10, 20));
    const v = view(et(10, 20));
    expect(v.money?.todayRealizedJpy).toBeLessThan(-1_000);
    expect(v.money).toMatchObject({ limitReached: true, lossLimitUsedRatio: 1 });
  });

  it("今日まだ記録がない日は、前の記録の日を出し、今日ではないことを示す", async () => {
    repos.credentials.save(CREDS);
    await tickEveryMinute(et(9, 30), et(10, 20));
    const v = view(et(9, 0, "2026-11-03"));
    expect(v).toMatchObject({ date: DATE, isToday: false });
  });
});
