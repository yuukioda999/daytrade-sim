import { describe, expect, it } from "vitest";
import { EARLY_CLOSES, HOLIDAYS } from "./calendar-data";
import { isDaylightSaving, toEastern, weekdayOf } from "./eastern-time";
import {
  CalendarOutOfRangeError,
  closedReason,
  isMarketOpen,
  orbBarStarts,
  sessionOn,
} from "./market-calendar";

const at = (iso: string) => new Date(iso);
const iso = (d: Date) => d.toISOString();

describe("SPEC-001 市場の時間", () => {
  it("AC-001-01: 冬時間の平日 09:30(2026-11-02T14:30:00Z)は開いている", () => {
    expect(isMarketOpen(at("2026-11-02T14:30:00Z"))).toBe(true);
    expect(toEastern(at("2026-11-02T14:30:00Z"))).toMatchObject({ hour: 9, minute: 30 });
    expect(isDaylightSaving(at("2026-11-02T14:30:00Z"))).toBe(false);
  });

  it("AC-001-02: 冬時間の平日 09:29:59(2026-11-02T14:29:59Z)は閉まっている", () => {
    expect(isMarketOpen(at("2026-11-02T14:29:59Z"))).toBe(false);
  });

  it("AC-001-03: 夏時間の平日 09:30(2026-10-30T13:30:00Z)は開いている", () => {
    expect(isMarketOpen(at("2026-10-30T13:30:00Z"))).toBe(true);
    expect(toEastern(at("2026-10-30T13:30:00Z"))).toMatchObject({ hour: 9, minute: 30 });
    expect(isDaylightSaving(at("2026-10-30T13:30:00Z"))).toBe(true);
  });

  it("AC-001-04: 夏時間の平日 09:29:59(2026-10-30T13:29:59Z)は閉まっている", () => {
    expect(isMarketOpen(at("2026-10-30T13:29:59Z"))).toBe(false);
  });

  it("AC-001-05: 夏時間が始まった次の平日(2026-03-09)の 13:30:00Z は開いている", () => {
    expect(isMarketOpen(at("2026-03-09T13:30:00Z"))).toBe(true);
    // 切り替わる前の金曜は冬時間なので、同じ UTC の時刻ではまだ開いていない
    expect(isMarketOpen(at("2026-03-06T13:30:00Z"))).toBe(false);
    expect(isMarketOpen(at("2026-03-06T14:30:00Z"))).toBe(true);
  });

  it("AC-001-06: 16:00 は含まない(20:59:59Z は開いている、21:00:00Z は閉まっている)", () => {
    expect(isMarketOpen(at("2026-11-02T20:59:59Z"))).toBe(true);
    expect(isMarketOpen(at("2026-11-02T21:00:00Z"))).toBe(false);
  });

  it("AC-001-07: 土曜日(2026-11-07)は閉まっている", () => {
    expect(isMarketOpen(at("2026-11-07T15:00:00Z"))).toBe(false);
    expect(closedReason("2026-11-07")).toBe("weekend");
    expect(closedReason("2026-11-08")).toBe("weekend");
  });

  it("AC-001-08: 休場日(2026-11-26 感謝祭)は閉まっている", () => {
    expect(isMarketOpen(at("2026-11-26T15:00:00Z"))).toBe(false);
    expect(closedReason("2026-11-26")).toBe("holiday");
  });

  it("AC-001-09: 短縮取引日(2026-11-27)は 13:00 で終わる", () => {
    expect(isMarketOpen(at("2026-11-27T17:59:59Z"))).toBe(true);
    expect(isMarketOpen(at("2026-11-27T18:00:00Z"))).toBe(false);
    expect(sessionOn("2026-11-27")?.earlyClose).toBe(true);
  });

  it.each([
    ["2026-12-24", "2026-12-24T18:00:00.000Z", "2026-12-24T17:30:00.000Z"],
    ["2027-11-26", "2027-11-26T18:00:00.000Z", "2027-11-26T17:30:00.000Z"],
  ])("AC-001-09、AC-001-11: 短縮取引日 %s は 13:00 終了、12:30 締め切り", (date, close, cutoff) => {
    const s = sessionOn(date)!;
    expect(s.earlyClose).toBe(true);
    expect(iso(s.close)).toBe(close);
    expect(iso(s.entryCutoff)).toBe(cutoff);
  });

  it("AC-001-03: 2027 年の夏時間の平日(2027-07-06)も 09:30 = 13:30Z に開く", () => {
    expect(isMarketOpen(at("2027-07-06T13:29:59Z"))).toBe(false);
    expect(isMarketOpen(at("2027-07-06T13:30:00Z"))).toBe(true);
    expect(isDaylightSaving(at("2027-07-06T13:30:00Z"))).toBe(true);
  });

  it("AC-001-10: 朝の値幅の時間は 09:30、09:35、09:40 に始まる3本", () => {
    const winter = sessionOn("2026-11-02")!;
    expect(orbBarStarts(winter).map(iso)).toEqual([
      "2026-11-02T14:30:00.000Z",
      "2026-11-02T14:35:00.000Z",
      "2026-11-02T14:40:00.000Z",
    ]);
    const summer = sessionOn("2026-10-30")!;
    expect(orbBarStarts(summer).map(iso)).toEqual([
      "2026-10-30T13:30:00.000Z",
      "2026-10-30T13:35:00.000Z",
      "2026-10-30T13:40:00.000Z",
    ]);
  });

  it("AC-001-11: 新しい買いの締め切りは通常 15:30、短縮取引日 12:30", () => {
    expect(iso(sessionOn("2026-11-02")!.entryCutoff)).toBe("2026-11-02T20:30:00.000Z");
    expect(iso(sessionOn("2026-11-27")!.entryCutoff)).toBe("2026-11-27T17:30:00.000Z");
    expect(iso(sessionOn("2026-10-30")!.entryCutoff)).toBe("2026-10-30T19:30:00.000Z");
  });

  it("AC-001-12: 休場日の表にない年(2030 年)はエラーにする", () => {
    expect(() => isMarketOpen(at("2030-01-07T15:00:00Z"))).toThrow(CalendarOutOfRangeError);
    expect(() => sessionOn("2025-12-31")).toThrow(CalendarOutOfRangeError);
  });
});

describe("休場日の表", () => {
  it("休場日と短縮取引日はすべて平日にある(写し間違いの検出)", () => {
    for (const date of [...Object.keys(HOLIDAYS), ...EARLY_CLOSES]) {
      const w = weekdayOf(date);
      expect(w, `${date} が週末になっている`).toBeGreaterThanOrEqual(1);
      expect(w, `${date} が週末になっている`).toBeLessThanOrEqual(5);
    }
  });

  it("NYSE の表の件数どおり(各年 休場日10日、短縮取引日は 2026 年 2日、2027 年 1日)", () => {
    const count = (year: string) => Object.keys(HOLIDAYS).filter((d) => d.startsWith(year)).length;
    expect(count("2026")).toBe(10);
    expect(count("2027")).toBe(10);
    expect(EARLY_CLOSES.filter((d) => d.startsWith("2026"))).toHaveLength(2);
    expect(EARLY_CLOSES.filter((d) => d.startsWith("2027"))).toHaveLength(1);
  });

  it("米国東部時間の夜は、UTC では翌日でも東部の暦日で判定する", () => {
    // 2026-11-02 22:00 ET = 2026-11-03T03:00Z
    expect(toEastern(at("2026-11-03T03:00:00Z")).date).toBe("2026-11-02");
    // 年の境目: 2027-12-31 23:30 ET は UTC では 2028-01-01。
    // UTC の日付で判定すると、表にない 2028 年としてエラーになる
    expect(() => isMarketOpen(at("2028-01-01T04:30:00Z"))).not.toThrow();
    expect(isMarketOpen(at("2028-01-01T04:30:00Z"))).toBe(false);
  });
});
