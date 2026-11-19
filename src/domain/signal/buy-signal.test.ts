import { describe, expect, it } from "vitest";
import type { Bar } from "@/domain/market/bar";
import { sessionOn } from "@/domain/market/market-calendar";
import {
  barPrice,
  evaluateBar,
  openingRange,
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
    const none = evalWith({ pastSameTimeVolumes: [1000] }, { close: 77.0 });
    expect(none.met).toBe(0);
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
  it("朝の値幅の時間の足が3本そろわない時は、計算できない(null)", () => {
    expect(openingRange(session, ORB_BARS.slice(0, 2))).toBeNull();
    const r = evalWith({ barsThroughT: [ORB_BARS[0], ORB_BARS[2], BAR_0945] });
    expect(r.orbHigh).toBeNull();
    expect(r.conditions.orbBreakout).toBe(false);
  });
});
