import { describe, expect, it } from "vitest";
import {
  compareScenarios,
  DEFAULT_SIMULATOR_INPUT,
  settleYear,
  simulateScenario,
  type SimulatorInput,
} from "./simulator";

const base: SimulatorInput = { ...DEFAULT_SIMULATOR_INPUT };

describe("SPEC-005 資産シミュレーター", () => {
  it("AC-005-01: 例1 年末の処理(B0 10,000、年の終わり 20,000、税金 ON、30%)", () => {
    const r = settleYear(10_000, 20_000, 0.3, true);
    expect(r.taxJpy).toBeCloseTo(2031.5, 9);
    expect(r.afterTaxJpy).toBeCloseTo(7968.5, 9);
    expect(r.toSavingsJpy).toBeCloseTo(2390.55, 9);
    expect(r.balanceJpy).toBeCloseTo(15_577.95, 9);
    expect(r.balanceJpy + r.toSavingsJpy).toBeCloseTo(17_968.5, 9);
  });

  it("AC-005-02: 例2 1年分(10,000 × 1.003^240)が、高精度の計算の値 20,522.20 と小数2桁まで一致", () => {
    // 参照の値は Python の Decimal(有効桁 50)で求めた 20522.2004333...
    const r = simulateScenario({ ...base, trialMonths: 0, years: 1, savingsRatio: 0, taxOn: false });
    expect(r.rows[0].balanceJpy).toBeCloseTo(20_522.2, 2);
  });

  describe("AC-005-03: 境界の例", () => {
    it("利益率 0% なら、毎年 B = P、税金 0、S = 0", () => {
      const r = simulateScenario({ ...base, dailyRate: 0, years: 3 });
      for (const row of r.rows) {
        expect(row).toEqual({ year: row.year, taxJpy: 0, balanceJpy: 10_000, savingsJpy: 0, totalJpy: 10_000 });
      }
    });

    it("貯金へ回す割合 0% なら、例1で B = 17,968.5、S = 0", () => {
      const r = settleYear(10_000, 20_000, 0, true);
      expect(r.balanceJpy).toBeCloseTo(17_968.5, 9);
      expect(r.toSavingsJpy).toBe(0);
    });

    it("貯金へ回す割合 100% なら、例1で B = 10,000、S = 7,968.5", () => {
      const r = settleYear(10_000, 20_000, 1, true);
      expect(r.balanceJpy).toBeCloseTo(10_000, 9);
      expect(r.toSavingsJpy).toBeCloseTo(7968.5, 9);
    });

    it("年の利益がマイナスなら、税金も貯金も 0(年末の処理を単独で使う時)", () => {
      expect(settleYear(10_000, 9_000, 0.3, true)).toEqual({
        taxJpy: 0, afterTaxJpy: -1000, toSavingsJpy: 0, balanceJpy: 9_000,
      });
    });

    it("税金 OFF なら、例1で A = 10,000、M = 3,000、B = 17,000、S = 3,000", () => {
      const r = settleYear(10_000, 20_000, 0.3, false);
      expect(r).toEqual({ taxJpy: 0, afterTaxJpy: 10_000, toSavingsJpy: 3000, balanceJpy: 17_000 });
    });

    it("お試し期間が運用期間以上(12か月、1年)なら、1年目の利益は 0", () => {
      const r = simulateScenario({ ...base, trialMonths: 12, years: 1 });
      expect(r.rows[0]).toMatchObject({ taxJpy: 0, balanceJpy: 10_000, savingsJpy: 0, totalJpy: 10_000 });
    });

    it("お試し期間は、その日数のあとから増え始める(3か月 = 60営業日)", () => {
      const r = simulateScenario({ ...base, trialMonths: 3, years: 1, savingsRatio: 0, taxOn: false });
      expect(r.rows[0].balanceJpy).toBeCloseTo(10_000 * 1.003 ** 180, 6);
    });

    it("上限(1%、10年)でも、無限大や非数にならない", () => {
      const c = compareScenarios({ ...base, dailyRate: 0.01, years: 10 });
      for (const s of [c.withTrial, c.noTrial, c.fullCompound]) {
        for (const row of s.rows) {
          for (const v of [row.taxJpy, row.balanceJpy, row.savingsJpy, row.totalJpy]) {
            expect(Number.isFinite(v)).toBe(true);
          }
        }
        for (const p of s.series) expect(Number.isFinite(p.totalJpy)).toBe(true);
      }
    });
  });

  it("AC-005-04 の前提: 既定値で3つの条件の年次の値が、高精度の計算の値と小数2桁まで一致", () => {
    // 参照の値は Python の Decimal で同じ定義を計算したもの
    const c = compareScenarios(base);
    const expected = {
      withTrial: [
        [1451.750999, 13_986.115917, 1708.335393, 15_694.45131],
        [2989.651184, 22_194.890135, 5226.381486, 27_421.271621],
        [4744.346463, 35_221.583392, 10_809.250025, 46_030.833418],
      ],
      noTrial: [
        [2137.585018, 15_869.230791, 2515.384625, 18_384.615415],
        [3392.182999, 25_183.248589, 6507.106538, 31_690.355127],
        [5383.133489, 39_963.878392, 12_841.662168, 52_805.540559],
      ],
      fullCompound: [
        [2137.585018, 18_384.615415, 0, 18_384.615415],
        [3929.867847, 33_799.408397, 0, 33_799.408397],
        [7224.910901, 62_138.912464, 0, 62_138.912464],
      ],
    } as const;
    for (const key of ["withTrial", "noTrial", "fullCompound"] as const) {
      c[key].rows.forEach((row, i) => {
        const [tax, balance, savings, total] = expected[key][i];
        expect(row.taxJpy, `${key} ${row.year}年目 税金`).toBeCloseTo(tax, 2);
        expect(row.balanceJpy, `${key} ${row.year}年目 運用中`).toBeCloseTo(balance, 2);
        expect(row.savingsJpy, `${key} ${row.year}年目 貯金`).toBeCloseTo(savings, 2);
        expect(row.totalJpy, `${key} ${row.year}年目 合計`).toBeCloseTo(total, 2);
      });
    }
  });

  it("グラフの点は、開始、毎月末(20営業日ごと)、年末の処理のあと", () => {
    const r = simulateScenario({ ...base, years: 2 });
    expect(r.series.map((p) => p.day)).toEqual(Array.from({ length: 25 }, (_, i) => i * 20));
    expect(r.series[12].totalJpy).toBeCloseTo(r.rows[0].totalJpy, 9);
    expect(r.series[24].totalJpy).toBeCloseTo(r.rows[1].totalJpy, 9);
  });

  it("範囲の外の入力はエラーにする", () => {
    expect(() => simulateScenario({ ...base, dailyRate: 0.011 })).toThrow(/想定利益率/);
    expect(() => simulateScenario({ ...base, years: 0 })).toThrow(/年数/);
    expect(() => simulateScenario({ ...base, years: 11 })).toThrow(/年数/);
    expect(() => simulateScenario({ ...base, trialMonths: 13 })).toThrow(/お試し期間/);
    expect(() => simulateScenario({ ...base, savingsRatio: 1.1 })).toThrow(/貯金/);
    expect(() => simulateScenario({ ...base, principalJpy: 0 })).toThrow(/元手/);
    expect(() => simulateScenario({ ...base, years: 1.5 })).toThrow(/整数/);
  });
});
