import { describe, expect, it } from "vitest";
import type { Bar } from "@/domain/market/bar";
import { fromEastern } from "@/domain/market/eastern-time";
import { sessionOn, type MarketSession } from "@/domain/market/market-calendar";
import { newAccount } from "./paper-trading";
import { replayDay, type ReplayInput } from "./day-replay";

const DATE = "2026-11-02";
const session = sessionOn(DATE) as MarketSession;

function bar(hhmm: string, o: number, h: number, l: number, c: number, v = 100, vw?: number): Bar {
  const [hh, mm] = hhmm.split(":").map(Number);
  return { start: fromEastern(DATE, hh, mm), open: o, high: h, low: l, close: c, volume: v, vwap: vw };
}

// SPEC-002 例1(09:45 に買いサイン)のあと、SPEC-003 例1(買値 78.45)、例2(損切り 77.10)
const SOXL: Bar[] = [
  bar("09:30", 77.5, 77.7, 77.1, 77.55, 100, 77.4),
  bar("09:35", 77.55, 77.9, 77.4, 77.6, 70, 77.65),
  bar("09:40", 77.6, 77.85, 77.35, 77.45, 55, 77.6),
  bar("09:45", 77.45, 78.05, 77.7, 78.0, 120, 77.9),
  bar("09:50", 78.45, 78.6, 78.2, 78.5, 100),
  bar("09:55", 77.5, 77.6, 77.0, 77.2, 100),
];

function input(over: Partial<ReplayInput> = {}): ReplayInput {
  return {
    session,
    account: newAccount(10_000, 150, DATE),
    bars: { SOXL },
    pastVolumes: () => [60],
    buyingAllowedAt: () => true,
    closeOut: false,
    ...over,
  };
}

describe("その日を足から作り直す(ADR-0009)", () => {
  it("AC-003-01、02: 買いサインの次の足の始値で買い、損切りの価格で売る(SPEC-003 例1、例2)", () => {
    const r = replayDay(input());
    expect(r.buys).toEqual([
      {
        symbol: "SOXL",
        signalBarStart: fromEastern(DATE, 9, 45),
        entryTime: fromEastern(DATE, 9, 50),
        entryPrice: 78.45,
        shares: 0.4248,
        stopPrice: 77.1,
      },
    ]);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]).toMatchObject({ exitPrice: 77.1, reason: "stop", exitTime: fromEastern(DATE, 9, 55) });
    expect(r.trades[0].pnlJpy).toBeCloseTo(-86.022, 6);
    expect(r.account.realizedTodayJpy).toBeCloseTo(-86.022, 6);
    expect(r.openPositions).toEqual([]);
  });

  it("AC-003-09、10: 足を1本ずつ足して何度作り直しても、最後は一度に処理した時と同じ記録になる", () => {
    const all = replayDay(input());
    for (let n = 1; n <= SOXL.length; n++) {
      const partial = replayDay(input({ bars: { SOXL: SOXL.slice(0, n) } }));
      if (n === SOXL.length) expect(partial).toEqual(all);
    }
    // 同じ入力で2回作り直しても同じ
    expect(replayDay(input())).toEqual(all);
  });

  it("途中までの足では、買った株を持ったまま(まだ売っていない)", () => {
    const r = replayDay(input({ bars: { SOXL: SOXL.slice(0, 5) } }));
    expect(r.trades).toEqual([]);
    expect(r.openPositions.map((p) => p.symbol)).toEqual(["SOXL"]);
  });

  it("AC-006-01: 自動売買を OFF にしたあとの足では新しく買わない", () => {
    const off = fromEastern(DATE, 9, 47);
    const r = replayDay(input({ buyingAllowedAt: (t) => t.getTime() < off.getTime() }));
    expect(r.buys).toEqual([]);
    expect(r.skips).toEqual([
      { symbol: "SOXL", signalBarStart: fromEastern(DATE, 9, 45), barStart: fromEastern(DATE, 9, 50), reason: "auto-trading-off" },
    ]);
  });

  it("AC-006-01: OFF にしても、持っている株の売りの判定は続ける", () => {
    const off = fromEastern(DATE, 9, 52);
    const r = replayDay(input({ buyingAllowedAt: (t) => t.getTime() < off.getTime() }));
    expect(r.buys).toHaveLength(1);
    expect(r.trades.map((t) => t.reason)).toEqual(["stop"]);
  });

  it("SPEC-003 定義 14: 締める時は、売っていない株を届いた最後の足の終値で売る", () => {
    const held = [...SOXL.slice(0, 5), bar("10:00", 78.5, 78.8, 78.4, 78.7)];
    const notYet = replayDay(input({ bars: { SOXL: held } }));
    expect(notYet.openPositions).toHaveLength(1);
    const closed = replayDay(input({ bars: { SOXL: held }, closeOut: true }));
    expect(closed.trades).toHaveLength(1);
    expect(closed.trades[0]).toMatchObject({ reason: "close", exitPrice: 78.7, exitTime: fromEastern(DATE, 10, 0) });
    expect(closed.openPositions).toEqual([]);
  });

  it("取引量の基準がない(過去の日がない)時は、買いサインが出ない", () => {
    expect(replayDay(input({ pastVolumes: () => [] })).buys).toEqual([]);
  });

  it("同じ時刻の足は監視リストの順に処理し、銘柄ごとに1日1回だけ買う", () => {
    const shifted = (b: Bar): Bar => ({ ...b });
    const r = replayDay(input({ bars: { TQQQ: SOXL.map(shifted), SOXL } }));
    expect(r.buys.map((b) => b.symbol)).toEqual(["SOXL", "TQQQ"]);
    // 2つ目は、1つ目を買ったあとの「買いに使える残り」で決まる(元手の50%ずつ)
    expect(r.buys[1].shares).toBe(0.4248);
  });

  it("その日の始めの状態が違う日なら、エラーにする", () => {
    expect(() => replayDay(input({ account: newAccount(10_000, 150, "2026-11-03") }))).toThrow();
  });
});
