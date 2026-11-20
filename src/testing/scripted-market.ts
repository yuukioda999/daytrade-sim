import type { MarketDataSource, SymbolBar } from "@/application/ports";
import { MarketDataError } from "@/application/ports";
import type { Bar } from "@/domain/market/bar";
import { fromEastern } from "@/domain/market/eastern-time";
import { sessionOn } from "@/domain/market/market-calendar";
import type { CredentialsInput } from "@/domain/settings/settings";

/**
 * テスト用の、決めた足を返す市場データ(単体テストと、画面のテストの DB を作る処理で使う)。通信しない
 */
export const CREDS = { keyId: "PKTESTKEY0000000ABCD", secret: "TestSecret000000000000000000000000000Zq9X" };
export const DATE = "2026-11-02"; // 月曜、冬時間
export const et = (hh: number, mm: number, date = DATE) => fromEastern(date, hh, mm);

export function bar(symbol: string, date: string, hh: number, mm: number, o: number, h: number, l: number, c: number, v = 100, vw?: number): SymbolBar {
  return { symbol, start: et(hh, mm, date), open: o, high: h, low: l, close: c, volume: v, vwap: vw };
}

// SPEC-002 例1 と SPEC-003 例1、例2: 09:45 に買いサイン、09:50 に 78.45 で買い、09:55 に 77.10 で損切り
export const SOXL_DAY: SymbolBar[] = [
  bar("SOXL", DATE, 9, 30, 77.5, 77.7, 77.1, 77.55, 100, 77.4),
  bar("SOXL", DATE, 9, 35, 77.55, 77.9, 77.4, 77.6, 70, 77.65),
  bar("SOXL", DATE, 9, 40, 77.6, 77.85, 77.35, 77.45, 55, 77.6),
  bar("SOXL", DATE, 9, 45, 77.45, 78.05, 77.7, 78.0, 120, 77.9),
  bar("SOXL", DATE, 9, 50, 78.45, 78.6, 78.2, 78.5, 100),
  bar("SOXL", DATE, 9, 55, 77.5, 77.6, 77.0, 77.2, 100),
];

/** 過去の取引日の足(どの時刻も取引量 60。取引量の基準が 60 になる) */
export function pastDayBars(symbol: string, date: string): SymbolBar[] {
  const s = sessionOn(date);
  if (!s) return [];
  const bars: SymbolBar[] = [];
  for (let t = s.open.getTime(); t < s.close.getTime(); t += 5 * 60_000) {
    bars.push({ symbol, start: new Date(t), open: 70, high: 70, low: 70, close: 70, volume: 60 });
  }
  return bars;
}

/** 決めた足を返すテスト用の取得元。頼まれた期間の足だけを返す。決めていない日は、過去の日の足(取引量 60)を返す */
export class ScriptedSource implements MarketDataSource {
  readonly isTestSource = true;
  fail: MarketDataError | null = null;
  readonly calls: { symbol: string; start: Date; end: Date }[] = [];
  constructor(
    private readonly today: Record<string, Bar[]>,
    private readonly day: string = DATE,
  ) {}
  async fetchBars(_c: CredentialsInput, symbol: string, start: Date, end: Date): Promise<SymbolBar[]> {
    this.calls.push({ symbol, start, end });
    if (this.fail) throw this.fail;
    const all: SymbolBar[] = [];
    for (let t = start.getTime(); t < end.getTime(); t += 86_400_000) {
      const date = new Date(t - 5 * 3_600_000).toISOString().slice(0, 10);
      if (date === this.day) all.push(...(this.today[symbol] ?? []).map((b) => ({ ...b, symbol })));
      else all.push(...pastDayBars(symbol, date));
    }
    return all.filter((b) => b.start >= start && b.start < end);
  }
  async latestBar(): Promise<SymbolBar | null> {
    return null;
  }
}

