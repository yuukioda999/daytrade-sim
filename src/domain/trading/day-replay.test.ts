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
    buyingAllowed: () => true,
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

  it("AC-003-09、10: 足を1本ずつ足して何度作り直しても、前の記録は変わらず、最後は一度に処理した時と同じ記録になる", () => {
    const all = replayDay(input());
    let prev = replayDay(input({ bars: { SOXL: SOXL.slice(0, 1) } }));
    for (let n = 2; n <= SOXL.length; n++) {
      const partial = replayDay(input({ bars: { SOXL: SOXL.slice(0, n) } }));
      // 足が増えても、それまでの買いと売りは同じまま(あとから過去が変わらない)
      expect(partial.buys.slice(0, prev.buys.length)).toEqual(prev.buys);
      expect(partial.trades.slice(0, prev.trades.length)).toEqual(prev.trades);
      prev = partial;
    }
    expect(prev).toEqual(all);
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
    const r = replayDay(input({ buyingAllowed: (_s, t) => t.getTime() < off.getTime() }));
    expect(r.buys).toEqual([]);
    expect(r.skips).toEqual([
      { symbol: "SOXL", signalBarStart: fromEastern(DATE, 9, 45), barStart: fromEastern(DATE, 9, 50), reason: "auto-trading-off" },
    ]);
  });

  it("AC-006-01: OFF にしても、持っている株の売りの判定は続ける", () => {
    const off = fromEastern(DATE, 9, 52);
    const r = replayDay(input({ buyingAllowed: (_s, t) => t.getTime() < off.getTime() }));
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

  it("同じ時刻の買いは監視リストの順で、2つ目は1つ目を買ったあとの「買いに使える残り」で決まる", () => {
    const r = replayDay(input({ account: newAccount(8_000, 150, DATE), bars: { TQQQ: SOXL.map((b) => ({ ...b })), SOXL } }));
    expect(r.buys.map((b) => b.symbol)).toEqual(["SOXL", "TQQQ"]);
    // 予算は 4,000円ずつ。1つ目の買付額 0.3399株 × 78.45 × 150 = 3,999.7...円 のあと、残り 4,000.2...円
    expect(r.buys[0].shares).toBe(0.3399);
    expect(r.buys[1].shares).toBe(0.3399);
  });

  it("SPEC-003 定義 15: 同じ足で、先の銘柄が売って空くお金を、その足の始値で買う銘柄は使えない", () => {
    // SOXL と TQQQ が 09:50 に買い(使えるお金はほぼ残らない)、09:55 に SOXL が損切り。
    // NVDL は1本遅れて 09:50 に買いサインが出て、09:55 の始値で買う。この時点では SOXL の売りのお金はまだ使えない
    const nvdl: Bar[] = [
      ...SOXL.slice(0, 3),
      bar("09:45", 77.45, 77.8, 77.4, 77.5, 50, 77.6),
      bar("09:50", 77.5, 78.05, 77.7, 78.0, 120, 77.9),
      bar("09:55", 78.45, 78.6, 78.3, 78.5, 100),
    ];
    const r = replayDay(input({ bars: { SOXL, TQQQ: SOXL.map((b) => ({ ...b })), NVDL: nvdl } }));
    const nvdlBuy = r.buys.find((b) => b.symbol === "NVDL");
    // 残りは 10,000 − 4,998.83 × 2 = 2.33円 → 0.0001株(定義 2 で、0 でなければ買う)
    expect(nvdlBuy?.shares).toBe(0.0001);
  });

  it("AC-003-08: 今日の損失が上限に達したあとの買いサインでは買わない。持っている株の売りは続ける", () => {
    // SOXL は 09:55 に始値 60 で大きく下がって売る(損失 1,175円 > 上限 1,000円)
    const crash = [...SOXL.slice(0, 5), bar("09:55", 60, 60.5, 59, 60)];
    const late = (b: Bar): Bar => ({ ...b, start: new Date(b.start.getTime() + 15 * 60_000) });
    // TQQQ は 15分遅れで同じ形(10:00 に買いサイン、10:05 に買う足)
    const tqqq = [...SOXL.slice(0, 3), ...[bar("09:45", 77.45, 77.8, 77.4, 77.5, 10), bar("09:50", 77.5, 77.8, 77.4, 77.5, 10), bar("09:55", 77.5, 77.8, 77.4, 77.5, 10)], ...SOXL.slice(3).map(late)];
    const r = replayDay(input({ bars: { SOXL: crash, TQQQ: tqqq } }));
    expect(r.trades[0].pnlJpy).toBeLessThan(-1_000);
    expect(r.buys.map((b) => b.symbol)).toEqual(["SOXL"]);
    expect(r.skips).toContainEqual(expect.objectContaining({ symbol: "TQQQ", reason: "daily-loss-limit" }));
  });

  it("その日の始めの状態が違う日なら、エラーにする", () => {
    expect(() => replayDay(input({ account: newAccount(10_000, 150, "2026-11-03") }))).toThrow();
  });
});
