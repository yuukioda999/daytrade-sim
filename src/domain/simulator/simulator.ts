/** 1年の営業日の数(SPEC-005) */
export const DAYS_PER_YEAR = 240;
/** 1か月の営業日の数(お試し期間の単位) */
export const DAYS_PER_MONTH = 20;
/** 税率(20.315%) */
export const TAX_RATE = 0.20315;

export type SimulatorInput = {
  /** 最初の元手(円) */
  principalJpy: number;
  /** お試し期間(か月、0 から 12) */
  trialMonths: number;
  /** 1日あたりの想定利益率(0.003 は 0.30%。0 から 0.01) */
  dailyRate: number;
  /** 続ける年数(1 から 10) */
  years: number;
  /** 年末に利益から貯金へ回す割合(0.3 は 30%。0 から 1) */
  savingsRatio: number;
  /** 税金を引くか */
  taxOn: boolean;
};

export type YearRow = {
  year: number;
  taxJpy: number;
  /** 年末の処理のあとの、運用中のお金 */
  balanceJpy: number;
  /** 年末の処理のあとの、貯金 */
  savingsJpy: number;
  totalJpy: number;
};

/** グラフの1点。day はその時点までの通算の営業日(0 は開始) */
export type SeriesPoint = { day: number; totalJpy: number };

export type ScenarioResult = { rows: YearRow[]; series: SeriesPoint[] };

export type Comparison = {
  /** お試し期間あり・貯金あり */
  withTrial: ScenarioResult;
  /** お試し期間なし・貯金あり */
  noTrial: ScenarioResult;
  /** 全額を再投資(お試しなし・貯金なし) */
  fullCompound: ScenarioResult;
};

function assertInRange(name: string, value: number, min: number, max: number): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} は ${min} から ${max} の範囲にしてください: ${value}`);
  }
}

function validate(input: SimulatorInput): void {
  if (!(input.principalJpy > 0) || !Number.isFinite(input.principalJpy)) {
    throw new Error(`元手は0より大きくしてください: ${input.principalJpy}`);
  }
  assertInRange("お試し期間", input.trialMonths, 0, 12);
  assertInRange("1日あたりの想定利益率", input.dailyRate, 0, 0.01);
  assertInRange("続ける年数", input.years, 1, 10);
  assertInRange("貯金へ回す割合", input.savingsRatio, 0, 1);
  if (!Number.isInteger(input.trialMonths) || !Number.isInteger(input.years)) {
    throw new Error("お試し期間と年数は整数にしてください");
  }
}

/** 年末の処理(SPEC-005 計算の定義 3 から 7)。例1を手計算で確かめられるように分けている */
export function settleYear(
  startBalance: number,
  endBalance: number,
  savingsRatio: number,
  taxOn: boolean,
): { taxJpy: number; afterTaxJpy: number; toSavingsJpy: number; balanceJpy: number } {
  const gain = endBalance - startBalance;
  const tax = taxOn && gain > 0 ? gain * TAX_RATE : 0;
  const afterTax = gain - tax;
  const toSavings = afterTax > 0 ? afterTax * savingsRatio : 0;
  return { taxJpy: tax, afterTaxJpy: afterTax, toSavingsJpy: toSavings, balanceJpy: startBalance + afterTax - toSavings };
}

/** 1つの条件で計算する(SPEC-005 計算の定義)。グラフの点は、毎月末(20営業日ごと)と年末の処理のあと */
export function simulateScenario(input: SimulatorInput): ScenarioResult {
  validate(input);
  const trialDays = input.trialMonths * DAYS_PER_MONTH;
  let balance = input.principalJpy;
  let savings = 0;
  const rows: YearRow[] = [];
  const series: SeriesPoint[] = [{ day: 0, totalJpy: balance }];

  for (let y = 1; y <= input.years; y += 1) {
    const start = balance;
    for (let d = 1; d <= DAYS_PER_YEAR; d += 1) {
      const g = (y - 1) * DAYS_PER_YEAR + d;
      if (g > trialDays) balance *= 1 + input.dailyRate;
      // 年の最後の日は、年末の処理のあとの値を点にする
      if (d % DAYS_PER_MONTH === 0 && d < DAYS_PER_YEAR) series.push({ day: g, totalJpy: balance + savings });
    }
    const settled = settleYear(start, balance, input.savingsRatio, input.taxOn);
    balance = settled.balanceJpy;
    savings += settled.toSavingsJpy;
    rows.push({ year: y, taxJpy: settled.taxJpy, balanceJpy: balance, savingsJpy: savings, totalJpy: balance + savings });
    series.push({ day: y * DAYS_PER_YEAR, totalJpy: balance + savings });
  }
  return { rows, series };
}

/** 3つの条件を比べる(SPEC-005「3つの条件」) */
export function compareScenarios(input: SimulatorInput): Comparison {
  return {
    withTrial: simulateScenario(input),
    noTrial: simulateScenario({ ...input, trialMonths: 0 }),
    fullCompound: simulateScenario({ ...input, trialMonths: 0, savingsRatio: 0 }),
  };
}

/** 画面の既定値(SPEC-005 入力の表) */
export const DEFAULT_SIMULATOR_INPUT: SimulatorInput = {
  principalJpy: 10_000,
  trialMonths: 3,
  dailyRate: 0.003,
  years: 3,
  savingsRatio: 0.3,
  taxOn: true,
};
