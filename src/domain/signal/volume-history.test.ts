import { describe, expect, it } from "vitest";
import { fromEastern } from "@/domain/market/eastern-time";
import { sameTimeVolumes } from "./volume-history";

const bar = (date: string, hh: number, mm: number, volume: number) => ({
  start: fromEastern(date, hh, mm),
  open: 1,
  high: 1,
  low: 1,
  close: 1,
  volume,
});

describe("過去の同じ時刻の取引量(SPEC-002 定義 4)", () => {
  it("米国東部時間の同じ時刻の足を、古い順に並べる(夏時間と冬時間をまたいでも同じ時刻)", () => {
    const days = [
      { date: "2026-11-02", bars: [bar("2026-11-02", 10, 0, 300)] }, // 冬時間
      { date: "2026-10-30", bars: [bar("2026-10-30", 10, 0, 200)] }, // 夏時間
    ];
    expect(sameTimeVolumes(days, fromEastern("2026-11-03", 10, 0))).toEqual([200, 300]);
  });

  it("市場は開いていたが、その時刻の足がない日は 0 として数える", () => {
    const days = [{ date: "2026-11-02", bars: [bar("2026-11-02", 10, 5, 300)] }];
    expect(sameTimeVolumes(days, fromEastern("2026-11-03", 10, 0))).toEqual([0]);
  });

  it("短縮取引日で、その時刻に市場が閉まっていた日は数えない", () => {
    const days = [
      { date: "2026-11-27", bars: [bar("2026-11-27", 12, 55, 50)] }, // 13:00 に終わる
      { date: "2026-11-30", bars: [bar("2026-11-30", 14, 0, 400)] },
    ];
    expect(sameTimeVolumes(days, fromEastern("2026-12-01", 14, 0))).toEqual([400]);
    expect(sameTimeVolumes(days, fromEastern("2026-12-01", 12, 55))).toEqual([50, 0]);
  });
});
