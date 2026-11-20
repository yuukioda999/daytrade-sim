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
// 冬時間の DATE の足の時刻を、米国東部時間の時と分に戻す(別の日に同じ時刻の足を作るため)
const toHour = (d: Date) => Math.floor((d.getTime() - et(0, 0).getTime()) / 3_600_000);
const toMinute = (d: Date) => Math.floor(((d.getTime() - et(0, 0).getTime()) % 3_600_000) / 60_000);

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

describe("保存した記録と画面の食い違いを防ぐ(T10 のレビュー 2)", () => {
  it("AC-003-10: 「あとから処理」の印は、ワーカーが保存した記録のとおりに出す。画面を開いた時刻で決め直さない", async () => {
    // 09:50 に買い、15:55 の足は届かない。ワーカーは 16:30 に遅れずに締める(印なし)
    source = new ScriptedSource({ SOXL: SOXL_DAY.slice(0, 5) });
    repos.credentials.save(CREDS);
    await tickEveryMinute(et(9, 30), et(10, 15));
    await tickEveryMinute(et(16, 25), et(16, 31));
    const saved = repos.trading.listTrades(DATE);
    expect(saved[0]).toMatchObject({ late: false, exit: { reason: "close" } });
    // 次の日の朝に画面を開いても、印は付かない
    const v = view(et(9, 0, "2026-11-03"));
    expect(v.trades[0]).toMatchObject({ late: false, exit: { reason: "close" } });
    expect(v.positions).toEqual([]);
  });
});

describe("前の取引日の終値(T10 のレビュー 4)", () => {
  it("前の取引日の足を取れていなければ、もっと前の日と比べずに null にする", async () => {
    repos.credentials.save(CREDS);
    await tickEveryMinute(et(9, 30), et(10, 12));
    const soxl = () => view(et(10, 12)).symbols.find((x) => x.symbol === "SOXL");
    expect(soxl()?.previousClose).toBe(70);
    const empty = memoryRepositories(() => clock);
    // 足を1本も持たない保存先に、今日の記録だけを写す
    for (const r of repos.trading.listDayRuns()) empty.trading.putDayRun(r);
    empty.bars.saveBars(repos.bars.barsBetween("SOXL", et(9, 30), et(16, 0)));
    const v = getDashboardView({ repos: empty }, et(10, 12)).symbols.find((x) => x.symbol === "SOXL");
    expect(v?.lastPrice).toBe(78.5);
    expect(v?.previousClose).toBeNull();
    expect(v?.changeRatio).toBeNull();
  });

  it("SPEC-001: 短縮取引日の次の日は、短縮取引日の最後の足(12:55)の終値と比べる", async () => {
    const day = "2026-11-30";
    const early = "2026-11-27";
    source = new ScriptedSource({ SOXL: [bar("SOXL", day, 9, 30, 80, 80, 80, 80, 100)] }, day);
    repos.credentials.save(CREDS);
    repos.bars.saveBars([bar("SOXL", early, 12, 50, 71, 71, 71, 71, 60), bar("SOXL", early, 12, 55, 72, 72, 72, 72.5, 60)]);
    await tickEveryMinute(et(9, 45, day), et(9, 50, day));
    const soxl = view(et(9, 50, day)).symbols.find((x) => x.symbol === "SOXL");
    expect(soxl).toMatchObject({ lastPrice: 80, previousClose: 72.5 });
  });
});

describe("夏時間と週末(SPEC-001)", () => {
  it("夏時間の日も、米国東部時間の取引時間の足を出す", async () => {
    const day = "2026-07-01";
    // 冬時間の 09:30 は 14:30Z、夏時間の 09:30 は 13:30Z。同じ米国東部時間の足を作る
    const shifted = SOXL_DAY.map((b) => ({ ...b, start: et(toHour(b.start), toMinute(b.start), day) }));
    source = new ScriptedSource({ SOXL: shifted }, day);
    repos.credentials.save(CREDS);
    await tickEveryMinute(et(9, 30, day), et(10, 12, day));
    const v = view(et(10, 12, day));
    expect(v).toMatchObject({ date: day, isToday: true });
    expect(v.symbols.find((x) => x.symbol === "SOXL")).toMatchObject({ breakoutTime: et(9, 45, day).toISOString(), status: "holding" });
    expect(v.trades[0]).toMatchObject({ entryPrice: 78.45, entryTime: et(9, 50, day).toISOString() });
  });

  it("AC-007-21: 週末は、金曜日の記録を出し、今日ではないことを示す", async () => {
    const fri = "2026-11-06";
    source = new ScriptedSource({ SOXL: SOXL_DAY.map((b) => ({ ...b, start: et(toHour(b.start), toMinute(b.start), fri) })) }, fri);
    repos.credentials.save(CREDS);
    await tickEveryMinute(et(9, 30, fri), et(10, 20, fri));
    const v = view(et(12, 0, "2026-11-07"));
    expect(v).toMatchObject({ date: fri, isToday: false });
    expect(v.trades).toHaveLength(1);
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

  it("AC-007-16: 利益の日は、損失の上限の使用割合を 0 にする", async () => {
    source = new ScriptedSource({
      SOXL: [...SOXL_DAY.slice(0, 5), bar("SOXL", DATE, 9, 55, 79, 79.5, 78.9, 79.4, 100), bar("SOXL", DATE, 10, 0, 79.4, 79.6, 79.3, 79.5, 100)],
    });
    repos.credentials.save(CREDS);
    // 15:55 の足は届かないので、締める時刻(16:30)に、届いた最後の足の終値で売る
    await tickEveryMinute(et(9, 30), et(10, 20));
    await tickEveryMinute(et(16, 25), et(16, 31));
    const v = view(et(16, 31));
    expect(v.trades[0].exit?.reason).toBe("close");
    // 手計算: (79.50 - 78.45) × 0.4248 × 150 = 66.906 円
    expect(v.money?.todayRealizedJpy).toBeCloseTo(66.906, 6);
    expect(v.money).toMatchObject({ lossLimitUsedRatio: 0, limitReached: false });
  });

  it("AC-007-21: 今日まだ記録がない日は、前の記録の日を出し、今日ではないことを示す", async () => {
    repos.credentials.save(CREDS);
    await tickEveryMinute(et(9, 30), et(10, 20));
    const v = view(et(9, 0, "2026-11-03"));
    expect(v).toMatchObject({ date: DATE, isToday: false });
  });
});
