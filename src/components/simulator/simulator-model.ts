import { roundYen } from "@/domain/trading/round-yen";
import {
  DAYS_PER_MONTH,
  DAYS_PER_YEAR,
  DEFAULT_SIMULATOR_INPUT,
  type Comparison,
  type SimulatorInput,
} from "@/domain/simulator/simulator";

/**
 * スライダーの位置は、刻みの数(整数)で持つ。
 * 値は整数から割り算で作る(0.0005 を20回足すと 0.010000000000000005 になり、
 * 計算の範囲の確かめでエラーになるため。PR #5 のレビュー)。
 */
export type SimulatorSteps = {
  /** お試し期間(か月、0 から 12) */
  trialMonths: number;
  /** 1日あたりの想定利益率の刻みの数(1刻み = 0.05%、0 から 20) */
  rateSteps: number;
  /** 続ける年数(1 から 10) */
  years: number;
  /** 貯金へ回す割合の刻みの数(1刻み = 5%、0 から 20) */
  savingsSteps: number;
  taxOn: boolean;
};

export const TRIAL_MONTHS_MAX = 12;
export const RATE_STEPS_MAX = 20;
export const YEARS_MIN = 1;
export const YEARS_MAX = 10;
export const SAVINGS_STEPS_MAX = 20;

/** 1刻みが 0.05% なので、刻みの数 / 2000 が利益率 */
const RATE_STEPS_PER_UNIT = 2000;
/** 1刻みが 5% なので、刻みの数 / 20 が割合 */
const SAVINGS_STEPS_PER_UNIT = 20;

export function rateFromSteps(steps: number): number {
  return steps / RATE_STEPS_PER_UNIT;
}

export function savingsRatioFromSteps(steps: number): number {
  return steps / SAVINGS_STEPS_PER_UNIT;
}

function assertStep(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} は ${min} から ${max} の整数にしてください: ${value}`);
  }
}

/** 画面の既定値(SPEC-005 入力の表)を、刻みの数で表したもの */
export const DEFAULT_STEPS: SimulatorSteps = {
  trialMonths: DEFAULT_SIMULATOR_INPUT.trialMonths,
  rateSteps: Math.round(DEFAULT_SIMULATOR_INPUT.dailyRate * RATE_STEPS_PER_UNIT),
  years: DEFAULT_SIMULATOR_INPUT.years,
  savingsSteps: Math.round(DEFAULT_SIMULATOR_INPUT.savingsRatio * SAVINGS_STEPS_PER_UNIT),
  taxOn: DEFAULT_SIMULATOR_INPUT.taxOn,
};

export function toSimulatorInput(steps: SimulatorSteps, principalJpy: number): SimulatorInput {
  assertStep("お試し期間", steps.trialMonths, 0, TRIAL_MONTHS_MAX);
  assertStep("利益率の刻み", steps.rateSteps, 0, RATE_STEPS_MAX);
  assertStep("続ける年数", steps.years, YEARS_MIN, YEARS_MAX);
  assertStep("貯金へ回す割合の刻み", steps.savingsSteps, 0, SAVINGS_STEPS_MAX);
  return {
    principalJpy,
    trialMonths: steps.trialMonths,
    dailyRate: rateFromSteps(steps.rateSteps),
    years: steps.years,
    savingsRatio: savingsRatioFromSteps(steps.savingsSteps),
    taxOn: steps.taxOn,
  };
}

export function trialLabel(months: number): string {
  return months === 0 ? "なし" : `${months}か月(${months * DAYS_PER_MONTH}営業日)`;
}

export function rateLabel(steps: number): string {
  // 刻みの数 × 0.05 を、整数の割り算で作ってから小数2桁にする
  return `${((steps * 5) / 100).toFixed(2)}%`;
}

export function yearsLabel(years: number): string {
  return `${years}年`;
}

export function savingsLabel(steps: number): string {
  return `${steps * 5}%`;
}

const yenFormat = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 });

/** 円の金額を、1円未満を四捨五入して「12,345円」の形にする */
export function formatYen(value: number): string {
  return `${yenFormat.format(roundYen(value))}円`;
}

const shortFormat = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 });

/** グラフの目盛り用の短い表し方(1.5万円、2.3億円、4.1兆円) */
export function formatYenShort(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${shortFormat.format(value / 1e12)}兆円`;
  if (abs >= 1e8) return `${shortFormat.format(value / 1e8)}億円`;
  if (abs >= 1e4) return `${shortFormat.format(value / 1e4)}万円`;
  return formatYen(value);
}

export type ChartPoint = {
  day: number;
  withTrial: number;
  noTrial: number;
  fullCompound: number;
};

/** 3つの条件の推移を、グラフ用に営業日ごとに1行へまとめる */
export function chartData(comparison: Comparison): ChartPoint[] {
  const { withTrial, noTrial, fullCompound } = comparison;
  return withTrial.series.map((point, i) => {
    const b = noTrial.series[i];
    const c = fullCompound.series[i];
    if (b?.day !== point.day || c?.day !== point.day) {
      throw new Error(`3つの条件のグラフの点がそろっていません: ${i} 番目`);
    }
    return { day: point.day, withTrial: point.totalJpy, noTrial: b.totalJpy, fullCompound: c.totalJpy };
  });
}

/** 横軸の目盛り(開始と、各年の終わり) */
export function yearTicks(years: number): number[] {
  return Array.from({ length: years + 1 }, (_, i) => i * DAYS_PER_YEAR);
}

export function dayTickLabel(day: number): string {
  return day === 0 ? "開始" : `${day / DAYS_PER_YEAR}年`;
}
