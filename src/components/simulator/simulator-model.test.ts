import { describe, expect, it } from "vitest";
import { compareScenarios, DEFAULT_SIMULATOR_INPUT } from "@/domain/simulator/simulator";
import {
  chartData,
  dayTickLabel,
  DEFAULT_STEPS,
  formatYen,
  formatYenShort,
  rateFromSteps,
  rateLabel,
  RATE_STEPS_MAX,
  SAVINGS_STEPS_MAX,
  savingsLabel,
  savingsRatioFromSteps,
  toSimulatorInput,
  trialLabel,
  yearTicks,
} from "./simulator-model";

describe("刻みの数から値を作る(AC-005-08 の前提、PR #5 のレビュー)", () => {
  it("利益率の上限の刻み(20)は、ちょうど 0.01 になる", () => {
    expect(rateFromSteps(RATE_STEPS_MAX)).toBe(0.01);
  });

  it("利益率のすべての刻みで、範囲の確かめを通り、計算できる", () => {
    for (let s = 0; s <= RATE_STEPS_MAX; s++) {
      const input = toSimulatorInput({ ...DEFAULT_STEPS, rateSteps: s }, 10_000);
      expect(() => compareScenarios(input)).not.toThrow();
    }
  });

  it("貯金へ回す割合の上限の刻み(20)は、ちょうど 1 になる", () => {
    expect(savingsRatioFromSteps(SAVINGS_STEPS_MAX)).toBe(1);
  });

  it("既定の刻みは、SPEC-005 の既定値と同じ入力になる", () => {
    expect(toSimulatorInput(DEFAULT_STEPS, 10_000)).toEqual(DEFAULT_SIMULATOR_INPUT);
  });

  it.each([
    ["rateSteps", 21],
    ["rateSteps", -1],
    ["rateSteps", 1.5],
    ["savingsSteps", 21],
    ["trialMonths", 13],
    ["years", 0],
    ["years", 11],
  ] as const)("範囲の外や整数でない刻み(%s = %s)はエラーにする", (key, value) => {
    expect(() => toSimulatorInput({ ...DEFAULT_STEPS, [key]: value }, 10_000)).toThrow();
  });
});

describe("画面に出す言葉", () => {
  it("お試し期間は、0 なら「なし」、それ以外は営業日を添える", () => {
    expect(trialLabel(0)).toBe("なし");
    expect(trialLabel(3)).toBe("3か月(60営業日)");
    expect(trialLabel(12)).toBe("12か月(240営業日)");
  });

  it("利益率は小数2桁の % で出す", () => {
    expect(rateLabel(0)).toBe("0.00%");
    expect(rateLabel(6)).toBe("0.30%");
    expect(rateLabel(20)).toBe("1.00%");
  });

  it("貯金へ回す割合は 5% 刻みで出す", () => {
    expect(savingsLabel(0)).toBe("0%");
    expect(savingsLabel(6)).toBe("30%");
    expect(savingsLabel(20)).toBe("100%");
  });

  it("円は1円未満を四捨五入して桁区切りで出す", () => {
    expect(formatYen(46_030.833418)).toBe("46,031円");
    expect(formatYen(0.4)).toBe("0円");
    expect(formatYen(1_234.5)).toBe("1,235円");
  });

  it("目盛りの短い表し方は、万円、億円、兆円に切り替える", () => {
    expect(formatYenShort(9_999)).toBe("9,999円");
    expect(formatYenShort(15_000)).toBe("1.5万円");
    expect(formatYenShort(230_000_000)).toBe("2.3億円");
    expect(formatYenShort(4_100_000_000_000)).toBe("4.1兆円");
  });

  it("横軸の目盛りは、開始と各年の終わり", () => {
    expect(yearTicks(3)).toEqual([0, 240, 480, 720]);
    expect(yearTicks(3).map(dayTickLabel)).toEqual(["開始", "1年", "2年", "3年"]);
  });
});

describe("グラフのデータ", () => {
  it("既定値では、3つの条件の点が同じ営業日にそろい、最後の点は年次の表の最後の合計と同じ", () => {
    const comparison = compareScenarios(DEFAULT_SIMULATOR_INPUT);
    const data = chartData(comparison);
    // 開始 + 1年に 11 点(20営業日ごと、240日目を除く) + 年末の処理の後 1 点
    expect(data).toHaveLength(1 + 3 * 12);
    const last = data[data.length - 1];
    expect(last.day).toBe(720);
    expect(last.withTrial).toBeCloseTo(46_030.833418, 4);
    expect(last.noTrial).toBeCloseTo(52_805.540559, 4);
    expect(last.fullCompound).toBeCloseTo(62_138.912464, 4);
  });

  it("点の営業日がそろっていなければエラーにする", () => {
    const comparison = compareScenarios(DEFAULT_SIMULATOR_INPUT);
    const broken = {
      ...comparison,
      noTrial: { ...comparison.noTrial, series: comparison.noTrial.series.slice(1) },
    };
    expect(() => chartData(broken)).toThrow();
  });
});
