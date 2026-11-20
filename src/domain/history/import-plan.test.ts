import { describe, expect, it } from "vitest";
import { planImport, regularSessionBars, tradingDays, validateChunk, validateRange } from "./import-plan";

const TODAY = "2026-11-20";
const none = () => new Set<string>();

describe("AC-006-09: 過去データの期間", () => {
  it("昨日までの1年以内なら受け付ける", () => {
    expect(validateRange({ from: "2025-11-19", to: "2026-11-19" }, TODAY)).toEqual({ ok: true });
  });

  it.each([
    [{ from: "2025-11-18", to: "2026-11-19" }, "from", "最大1年"],
    [{ from: "2026-11-01", to: "2026-11-20" }, "to", "昨日"],
    [{ from: "2026-11-10", to: "2026-11-01" }, "from", "前に"],
    [{ from: "2024-12-31", to: "2025-01-10" }, "from", "2025年より前"],
    [{ from: "2026-02-30", to: "2026-03-10" }, "from", "正しい日付"],
    [{ from: "2026/03/01", to: "2026-03-10" }, "from", "正しい日付"],
  ])("%o は %s が違う(%s)", (range, field, word) => {
    const r = validateRange(range, TODAY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[field as "from" | "to"]).toContain(word);
  });
});

describe("取引日と取得の計画", () => {
  it("取引日は週末と休場日を除く(2025-01-09 の臨時の休場も)", () => {
    expect(tradingDays("2025-01-08", "2025-01-13")).toEqual(["2025-01-08", "2025-01-10", "2025-01-13"]);
  });

  it("銘柄ごと、月ごとに分ける。並びは月の古い順、同じ月は監視リストの順", () => {
    const chunks = planImport({ from: "2026-10-29", to: "2026-11-03" }, none);
    expect(chunks).toEqual([
      { symbol: "SOXL", from: "2026-10-29", to: "2026-10-30" },
      { symbol: "TQQQ", from: "2026-10-29", to: "2026-10-30" },
      { symbol: "TSLL", from: "2026-10-29", to: "2026-10-30" },
      { symbol: "NVDL", from: "2026-10-29", to: "2026-10-30" },
      { symbol: "SOXL", from: "2026-11-02", to: "2026-11-03" },
      { symbol: "TQQQ", from: "2026-11-02", to: "2026-11-03" },
      { symbol: "TSLL", from: "2026-11-02", to: "2026-11-03" },
      { symbol: "NVDL", from: "2026-11-02", to: "2026-11-03" },
    ]);
  });

  it("AC-006-11: 取り終えた範囲は飛ばし、残りがある範囲だけをもう一度取る", () => {
    const fetched = (symbol: string) =>
      new Set(symbol === "SOXL" ? ["2026-10-29", "2026-10-30", "2026-11-02"] : ["2026-10-29", "2026-10-30"]);
    expect(planImport({ from: "2026-10-29", to: "2026-11-03" }, fetched)).toEqual([
      { symbol: "SOXL", from: "2026-11-02", to: "2026-11-03" },
      { symbol: "TQQQ", from: "2026-11-02", to: "2026-11-03" },
      { symbol: "TSLL", from: "2026-11-02", to: "2026-11-03" },
      { symbol: "NVDL", from: "2026-11-02", to: "2026-11-03" },
    ]);
  });

  it("1年分は、4銘柄 × 13か月(始めと終わりが月の途中)以下の回数になる", () => {
    expect(planImport({ from: "2025-11-19", to: "2026-11-19" }, none)).toHaveLength(4 * 13);
  });

  it("画面から送られた1回分を確かめ直す(銘柄、期間、1か月の中)", () => {
    expect(validateChunk({ symbol: "SOXL", from: "2026-10-01", to: "2026-10-30" }, TODAY)).toBe(true);
    expect(validateChunk({ symbol: "AAPL", from: "2026-10-01", to: "2026-10-30" }, TODAY)).toBe(false);
    expect(validateChunk({ symbol: "SOXL", from: "2026-10-01", to: "2026-11-02" }, TODAY)).toBe(false);
    expect(validateChunk({ symbol: "SOXL", from: "2026-11-02", to: "2026-11-20" }, TODAY)).toBe(false);
  });
});

describe("通常の取引時間の足だけを残す", () => {
  const bar = (iso: string) => ({ start: new Date(iso), open: 1, high: 1, low: 1, close: 1, volume: 1 });
  it("冬時間: 9:30 から 15:55 の足を残し、時間外と休場日の足を捨てる", () => {
    const kept = regularSessionBars([
      bar("2026-11-02T14:25:00Z"), // 9:25 ET 時間外
      bar("2026-11-02T14:30:00Z"), // 9:30 ET
      bar("2026-11-02T20:55:00Z"), // 15:55 ET
      bar("2026-11-02T21:00:00Z"), // 16:00 ET 時間外
      bar("2026-11-26T15:00:00Z"), // 感謝祭
    ]);
    expect(kept.map((b) => b.start.toISOString())).toEqual(["2026-11-02T14:30:00.000Z", "2026-11-02T20:55:00.000Z"]);
  });
  it("夏時間と短縮取引日(13:00 終了)", () => {
    const kept = regularSessionBars([
      bar("2026-07-01T13:30:00Z"), // 9:30 EDT
      bar("2026-07-01T13:25:00Z"), // 9:25 EDT 時間外
      bar("2026-11-27T17:55:00Z"), // 12:55 EST 短縮取引日
      bar("2026-11-27T18:00:00Z"), // 13:00 EST 短縮取引日の終了後
    ]);
    expect(kept.map((b) => b.start.toISOString())).toEqual(["2026-07-01T13:30:00.000Z", "2026-11-27T17:55:00.000Z"]);
  });
});
