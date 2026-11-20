import { describe, expect, it } from "vitest";
import type { Bar } from "@/domain/market/bar";
import { sessionOn } from "@/domain/market/market-calendar";
import {
  barPrice,
  evaluateBar,
  openingRange,
  orbBreakoutTime,
  sessionVwap,
  volumeBaseline,
  type EvaluateInput,
} from "./buy-signal";

// 2026-11-02(月、冬時間)。09:30 ET = 14:30Z
const session = sessionOn("2026-11-02")!;
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 10, 2, h + 5, m));
};
const bar = (hhmm: string, high: number, low: number, close: number, volume: number, vwap?: number): Bar => ({
  start: at(hhmm),
  open: close,
  high,
  low,
  close,
  volume,
  vwap,
});

// SPEC-002 例1
const ORB_BARS: Bar[] = [
  bar("09:30", 77.7, 77.1, 77.55, 100, 77.4),
  bar("09:35", 77.9, 77.4, 77.6, 70, 77.65),
  bar("09:40", 77.85, 77.35, 77.45, 55, 77.6),
];
const BAR_0945 = bar("09:45", 78.05, 77.7, 78.0, 120, 77.9);
const EXAMPLE: EvaluateInput = {
  session,
  barsThroughT: [...ORB_BARS, BAR_0945],
  pastSameTimeVolumes: [60],
  alreadySignaledToday: false,
};
const evalWith = (patch: Partial<EvaluateInput>, last?: Partial<Bar>) => {
  const input = { ...EXAMPLE, ...patch };
  if (last) {
    const bars = [...input.barsThroughT];
    bars[bars.length - 1] = { ...bars[bars.length - 1], ...last };
    input.barsThroughT = bars;
  }
  return evaluateBar(input);
};

describe("SPEC-002 買いサインの判定", () => {
  it("AC-002-01: 例1の3本から、朝の高値 77.90 と朝の安値 77.10", () => {
    expect(openingRange(session, ORB_BARS)).toEqual({ high: 77.9, low: 77.1 });
  });

  it("AC-002-02: 例1の4本で、09:45 の足の今日の平均価格は 77.6565", () => {
    // 手計算: 26,791.5 / 345 = 77.65652...
    expect(sessionVwap(session, EXAMPLE.barsThroughT)).toBeCloseTo(77.6565, 4);
  });

  it("AC-002-03: 平均約定価格がない足は (高値 + 安値 + 終値) / 3 を使う", () => {
    expect(barPrice(bar("09:30", 78, 76, 77, 100))).toBe(77);
    // 2本とも平均約定価格なし: (77×100 + 80×300) / 400 = 79.25
    const bars = [bar("09:30", 78, 76, 77, 100), bar("09:35", 81, 79, 80, 300)];
    expect(sessionVwap(session, bars)).toBeCloseTo(79.25, 10);
  });

  it("AC-002-04: 例1の 09:45 の足は3条件を満たし、買いサインが出る", () => {
    const r = evaluateBar(EXAMPLE);
    expect(r.conditions).toEqual({ orbBreakout: true, aboveVwap: true, volumeSurge: true });
    expect(r.met).toBe(3);
    expect(r.buySignal).toBe(true);
    expect(r.volumeRatio).toBeCloseTo(2, 10);
  });

  describe("AC-002-05: 境界の例", () => {
    it("終値が朝の高値と同じ(77.90)なら、朝の高値超えを満たさない", () => {
      const r = evalWith({}, { close: 77.9 });
      expect(r.conditions.orbBreakout).toBe(false);
      expect(r.buySignal).toBe(false);
    });

    it("取引量がちょうど 1.5 倍(90 / 60)なら、取引量の増加を満たす", () => {
      expect(evalWith({}, { volume: 90 }).conditions.volumeSurge).toBe(true);
      expect(evalWith({}, { volume: 89 }).conditions.volumeSurge).toBe(false);
    });

    it("過去の取引日が0日なら、取引量の増加を満たさない", () => {
      const r = evalWith({ pastSameTimeVolumes: [] });
      expect(r.conditions.volumeSurge).toBe(false);
      expect(r.volumeRatio).toBeNull();
    });

    it("今日の取引量の合計が0なら、今日の平均価格より上を満たさない", () => {
      const zero = [...ORB_BARS, BAR_0945].map((b) => ({ ...b, volume: 0 }));
      const r = evalWith({ barsThroughT: zero });
      expect(r.vwap).toBeNull();
      expect(r.conditions.aboveVwap).toBe(false);
    });

    // 09:40 の足は、自分自身が朝の高値に含まれるので、定義上は朝の高値超えを満たせない。
    // ここでは「朝の値幅の時間の足では買いサインが出ない」ことだけを確かめる
    it("朝の値幅の時間の足(09:40)は、3条件がそろっても買いサインは出ない", () => {
      const r = evaluateBar({
        ...EXAMPLE,
        barsThroughT: [bar("09:30", 77.7, 77.1, 77.55, 100, 77.4), bar("09:35", 77.9, 77.4, 77.6, 70, 77.65), bar("09:40", 79, 77.35, 79, 500, 77.6)],
      });
      expect(r.conditions.orbBreakout).toBe(false);
      expect(r.buySignal).toBe(false);
    });

    it("締め切り(15:30)以降に始まる足では、3条件がそろっても買いサインは出ない", () => {
      const late = bar("15:30", 78.05, 77.7, 78.0, 120, 77.9);
      const r = evalWith({ barsThroughT: [...ORB_BARS, late] });
      expect(r.met).toBe(3);
      expect(r.buySignal).toBe(false);
      // 締め切りの直前(15:25)なら出る
      const before = bar("15:25", 78.05, 77.7, 78.0, 120, 77.9);
      expect(evalWith({ barsThroughT: [...ORB_BARS, before] }).buySignal).toBe(true);
    });

    it("同じ日に同じ銘柄で2回目に3条件がそろっても、買いサインは出ない(1日1回)", () => {
      const r = evalWith({ alreadySignaledToday: true });
      expect(r.met).toBe(3);
      expect(r.buySignal).toBe(false);
    });
  });

  it("AC-002-06: 一部の条件だけ満たす時は、買いサインを出さず、満たした数を返す", () => {
    // 終値 77.70: 朝の高値(77.90)以下、平均価格(77.6565 付近)より上。取引量は 2 倍
    const r = evalWith({}, { close: 77.7 });
    expect(r.conditions).toEqual({ orbBreakout: false, aboveVwap: true, volumeSurge: true });
    expect(r.met).toBe(2);
    expect(r.buySignal).toBe(false);
    // 1/3: 取引量の増加だけ(終値 77.0 は朝の高値と平均価格の両方より下)
    const one = evalWith({}, { close: 77.0 });
    expect(one.conditions).toEqual({ orbBreakout: false, aboveVwap: false, volumeSurge: true });
    expect(one.met).toBe(1);
    expect(one.buySignal).toBe(false);
    const none = evalWith({ pastSameTimeVolumes: [1000] }, { close: 77.0 });
    expect(none.conditions).toEqual({ orbBreakout: false, aboveVwap: false, volumeSurge: false });
    expect(none.met).toBe(0);
    expect(none.buySignal).toBe(false);
  });

  describe("AC-002-05: 時刻の境界(短縮取引日と夏時間)", () => {
    const onDay = (date: string, utcOffsetHours: number) => {
      const s = sessionOn(date)!;
      const [y, mo, d] = date.split("-").map(Number);
      const mk = (hhmm: string, high: number, low: number, close: number, volume: number, vwap?: number): Bar => {
        const [h, m] = hhmm.split(":").map(Number);
        return { start: new Date(Date.UTC(y, mo - 1, d, h + utcOffsetHours, m)), open: close, high, low, close, volume, vwap };
      };
      const orb = [
        mk("09:30", 77.7, 77.1, 77.55, 100, 77.4),
        mk("09:35", 77.9, 77.4, 77.6, 70, 77.65),
        mk("09:40", 77.85, 77.35, 77.45, 55, 77.6),
      ];
      return { s, mk, orb };
    };

    it("短縮取引日(2026-11-27)は 12:25 の足なら出て、12:30 の足なら出ない", () => {
      const { s, mk, orb } = onDay("2026-11-27", 5);
      const run = (hhmm: string) =>
        evaluateBar({
          session: s,
          barsThroughT: [...orb, mk(hhmm, 78.05, 77.7, 78.0, 120, 77.9)],
          pastSameTimeVolumes: [60],
          alreadySignaledToday: false,
        });
      expect(run("12:25").buySignal).toBe(true);
      expect(run("12:30").met).toBe(3);
      expect(run("12:30").buySignal).toBe(false);
    });

    it("夏時間の日(2026-10-30)でも例1の 09:45 の足で買いサインが出る", () => {
      const { s, mk, orb } = onDay("2026-10-30", 4);
      const r = evaluateBar({
        session: s,
        barsThroughT: [...orb, mk("09:45", 78.05, 77.7, 78.0, 120, 77.9)],
        pastSameTimeVolumes: [60],
        alreadySignaledToday: false,
      });
      expect(r.orbHigh).toBe(77.9);
      expect(r.buySignal).toBe(true);
    });
  });

  it("AC-002-05: 終値と今日の平均価格が等しい時は、小数の誤差があっても満たさない", () => {
    // すべての足が同じ価格だと、平均価格は終値と等しいはず。
    // 取引量を各3にすると、45.67 は 45.669999999999995、12.34 は 12.339999999999998 と計算され、
    // 誤差で「上」と出てしまう(この値は実行して確かめた)
    for (const price of [45.67, 12.34]) {
      const flat = [...ORB_BARS, BAR_0945].map((b) => ({
        ...b, high: price, low: price, close: price, vwap: price, volume: 3,
      }));
      const r = evalWith({ barsThroughT: flat });
      expect(r.vwap).toBeCloseTo(price, 9);
      expect(r.conditions.aboveVwap, `価格 ${price}`).toBe(false);
    }
  });
});

describe("取引量の基準", () => {
  it("末尾(直近)の 20 日分だけで平均する", () => {
    const volumes = [1000, ...Array.from({ length: 20 }, () => 50)];
    expect(volumeBaseline(volumes)).toBe(50);
  });

  it("20 日に満たない時は、ある日数で平均する", () => {
    expect(volumeBaseline([40, 60, 80])).toBe(60);
  });

  it("基準が0(過去の同じ時刻に取引がない)なら、取引量の増加を満たさない", () => {
    const r = evalWith({ pastSameTimeVolumes: [0, 0] });
    expect(r.conditions.volumeSurge).toBe(false);
    expect(r.volumeRatio).toBeNull();
  });
});

describe("朝の値幅", () => {
  it("09:30 の足が2本あって 09:35 の足がない時は、3本あっても計算しない(null)", () => {
    expect(openingRange(session, [ORB_BARS[0], { ...ORB_BARS[0] }, ORB_BARS[2]])).toBeNull();
  });

  it("朝の値幅の時間の足が3本そろわない時は、計算できない(null)", () => {
    expect(openingRange(session, ORB_BARS.slice(0, 2))).toBeNull();
    const r = evalWith({ barsThroughT: [ORB_BARS[0], ORB_BARS[2], BAR_0945] });
    expect(r.orbHigh).toBeNull();
    expect(r.conditions.orbBreakout).toBe(false);
  });
});

describe("入力の前提", () => {
  it("足が古い順に並んでいない時はエラーにする", () => {
    expect(() => evalWith({ barsThroughT: [ORB_BARS[1], ORB_BARS[0], ORB_BARS[2], BAR_0945] })).toThrow(/古い順/);
  });

  it("同じ時刻の足が重なっている時はエラーにする(平均価格に二重に数えないため)", () => {
    expect(() => evalWith({ barsThroughT: [...ORB_BARS, BAR_0945, { ...BAR_0945 }] })).toThrow(/重なって/);
  });

  it("別の日の足が混ざっている時はエラーにする", () => {
    const nextDay = { ...BAR_0945, start: new Date(BAR_0945.start.getTime() + 24 * 3600_000) };
    expect(() => evalWith({ barsThroughT: [...ORB_BARS, nextDay] })).toThrow(/取引時間の外/);
  });

  it("足が0本の時はエラーにする", () => {
    expect(() => evalWith({ barsThroughT: [] })).toThrow(/足がありません/);
  });
});

describe("朝の高値を初めて超えた足(ダッシュボードの AC-007-14)", () => {
  it("SPEC-002 例1: 09:45 の足で初めて超える", () => {
    expect(orbBreakoutTime(session, [...ORB_BARS, BAR_0945, bar("09:50", 78.6, 78.2, 78.5, 100)])).toEqual(at("09:45"));
  });

  it("境界: 終値が朝の高値と誤差の範囲で等しい足は、超えていない(条件1と同じ比べ方)", () => {
    const equal = { ...BAR_0945, close: 77.9 + 1e-12 };
    expect(orbBreakoutTime(session, [...ORB_BARS, equal])).toBeNull();
    expect(evaluateBar({ ...EXAMPLE, barsThroughT: [...ORB_BARS, equal] }).conditions.orbBreakout).toBe(false);
  });

  it("朝の値幅の時間の足は、高値より上で終わっても数えない。朝の値幅が決まっていなければ null", () => {
    expect(orbBreakoutTime(session, ORB_BARS)).toBeNull();
    expect(orbBreakoutTime(session, ORB_BARS.slice(0, 2))).toBeNull();
  });
});
