import { describe, expect, it } from "vitest";
import { pnlAxis, roundAway } from "./results-model";

describe("日ごとの損益の棒グラフの軸(AC-004-06)", () => {
  it("端は 0 から遠い側の切りのよい値", () => {
    expect(roundAway(-86)).toBe(-90);
    expect(roundAway(1234)).toBe(2000);
    expect(roundAway(100)).toBe(100);
    expect(roundAway(-0.4)).toBe(-1);
    expect(roundAway(0)).toBe(0);
  });

  it("マイナスだけの日でも 0円を入れ、半分の位置にも目盛りを置く", () => {
    expect(pnlAxis([-86.022])).toEqual({ domain: [-90, 0], ticks: [-90, -45, 0] });
  });

  it("プラスとマイナスがある時は両側に目盛りを置く", () => {
    expect(pnlAxis([-310, 120, 0])).toEqual({ domain: [-400, 200], ticks: [-400, -200, 0, 100, 200] });
  });

  it("境界: 半分の値が整数にならない時は、半分の目盛りを置かない", () => {
    expect(pnlAxis([-3])).toEqual({ domain: [-3, 0], ticks: [-3, 0] });
    expect(pnlAxis([9])).toEqual({ domain: [0, 9], ticks: [0, 9] });
  });

  it("境界: 1円未満の損益だけの日は ±1円、全部 0円の日だけなら -1 から 1", () => {
    expect(pnlAxis([0.3])).toEqual({ domain: [0, 1], ticks: [0, 1] });
    expect(pnlAxis([0, 0])).toEqual({ domain: [-1, 1], ticks: [0] });
  });
});
