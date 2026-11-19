import type { Bar } from "@/domain/market/bar";
import { orbBarStarts, type MarketSession } from "@/domain/market/market-calendar";

/** 取引量の基準に使う過去の取引日の数(SPEC-002 決めたこと 2) */
export const VOLUME_LOOKBACK_DAYS = 20;
/** 取引量の増加とみなす倍率 */
export const VOLUME_SURGE_RATIO = 1.5;
/**
 * 価格と取引量の比べ方の許容幅。小数の計算の誤差で、等しいはずの値が
 * わずかに大きく出ることがあるため、この幅以内の差は「等しい」とみなす。
 */
export const EPSILON = 1e-9;

/** a が b より大きい(等しい時は false)。 */
const greaterThan = (a: number, b: number) => a - b > EPSILON;
/** a が b 以上。 */
const atLeast = (a: number, b: number) => a - b >= -EPSILON;

export type OpeningRange = { high: number; low: number };

export type SignalConditions = {
  /** 朝の高値超え(ORB) */
  orbBreakout: boolean;
  /** 今日の平均価格より上(VWAP) */
  aboveVwap: boolean;
  /** 取引量の増加 */
  volumeSurge: boolean;
};

export type SignalEvaluation = {
  conditions: SignalConditions;
  /** 満たした条件の数(0 から 3) */
  met: number;
  buySignal: boolean;
  /** 画面に出す値(SPEC-002 AC-002-07 で使う)。計算できない時は null */
  orbHigh: number | null;
  orbLow: number | null;
  vwap: number | null;
  /** 取引量 / 基準。基準がない時は null */
  volumeRatio: number | null;
};

/** 足の平均約定価格。ない時は (高値 + 安値 + 終値) / 3(AC-002-03)。 */
export function barPrice(bar: Bar): number {
  return bar.vwap ?? (bar.high + bar.low + bar.close) / 3;
}

/**
 * 朝の値幅(AC-002-01)。09:30、09:35、09:40 に始まる足が1本ずつそろわない時は null。
 * 足が欠けたまま高値と安値を決めると、判定の前提が変わるため。
 */
export function openingRange(session: MarketSession, bars: readonly Bar[]): OpeningRange | null {
  const orb = orbBarStarts(session).map((start) =>
    bars.filter((b) => b.start.getTime() === start.getTime()),
  );
  if (orb.some((found) => found.length !== 1)) return null;
  const orbBars = orb.map((found) => found[0]);
  return {
    high: Math.max(...orbBars.map((b) => b.high)),
    low: Math.min(...orbBars.map((b) => b.low)),
  };
}

/** 09:30 から足 t までの今日の平均価格(AC-002-02)。取引量の合計が0なら null。 */
export function sessionVwap(session: MarketSession, barsThroughT: readonly Bar[]): number | null {
  let pv = 0;
  let v = 0;
  for (const b of barsThroughT) {
    if (b.start.getTime() < session.open.getTime()) continue;
    pv += barPrice(b) * b.volume;
    v += b.volume;
  }
  return v > 0 ? pv / v : null;
}

/**
 * 取引量の基準: 過去の取引日の、米国東部時間で同じ時刻に始まる足の取引量の平均。
 * 古い順に並べて渡す。末尾(直近)の 20 日分だけを使う。0 日なら null。
 */
export function volumeBaseline(pastSameTimeVolumes: readonly number[]): number | null {
  const recent = pastSameTimeVolumes.slice(-VOLUME_LOOKBACK_DAYS);
  if (recent.length === 0) return null;
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

export type EvaluateInput = {
  session: MarketSession;
  /** 今日の足を古い順に、判定する足 t まで(t を含む) */
  barsThroughT: readonly Bar[];
  /** 足 t と同じ時刻に始まる、過去の取引日の取引量(古い順) */
  pastSameTimeVolumes: readonly number[];
  /** 今日すでにこの銘柄で買いサインが出たか(1日1回まで。決めたこと 3) */
  alreadySignaledToday: boolean;
};

/**
 * 入力の前提を確かめる。崩れている時は呼ぶ側の誤りなので、黙って判定せずに止める。
 * 前提: 足が1本以上ある、古い順に並ぶ、同じ時刻の足が重ならない、すべて今日の取引時間の中。
 */
function assertBarsOfSession(session: MarketSession, bars: readonly Bar[]): void {
  if (bars.length === 0) throw new Error("判定する足がありません");
  let prev = -Infinity;
  for (const b of bars) {
    const t = b.start.getTime();
    if (t <= prev) throw new Error(`足が古い順に並んでいないか、重なっています: ${b.start.toISOString()}`);
    if (t < session.open.getTime() || t >= session.close.getTime()) {
      throw new Error(`今日(${session.date})の取引時間の外の足です: ${b.start.toISOString()}`);
    }
    prev = t;
  }
}

/** 足 t が終わった時点で、3つの条件と買いサインを判定する(SPEC-002)。 */
export function evaluateBar(input: EvaluateInput): SignalEvaluation {
  const { session, barsThroughT, pastSameTimeVolumes, alreadySignaledToday } = input;
  assertBarsOfSession(session, barsThroughT);
  const t = barsThroughT[barsThroughT.length - 1];

  const range = openingRange(session, barsThroughT);
  const afterOrb = t.start.getTime() >= session.orbEnd.getTime();
  const vwap = sessionVwap(session, barsThroughT);
  const baseline = volumeBaseline(pastSameTimeVolumes);

  const conditions: SignalConditions = {
    // 朝の値幅の時間の足では、朝の高値がまだ決まっていない
    orbBreakout: afterOrb && range !== null && greaterThan(t.close, range.high),
    aboveVwap: vwap !== null && greaterThan(t.close, vwap),
    // 基準が0(過去の同じ時刻に取引がない)の時は、倍率に意味がないので満たさない
    volumeSurge: baseline !== null && baseline > 0 && atLeast(t.volume, baseline * VOLUME_SURGE_RATIO),
  };
  const met = Object.values(conditions).filter(Boolean).length;

  const inEntryWindow = afterOrb && t.start.getTime() < session.entryCutoff.getTime();
  const buySignal = met === 3 && inEntryWindow && !alreadySignaledToday;

  return {
    conditions,
    met,
    buySignal,
    orbHigh: range?.high ?? null,
    orbLow: range?.low ?? null,
    vwap,
    volumeRatio: baseline !== null && baseline > 0 ? t.volume / baseline : null,
  };
}
