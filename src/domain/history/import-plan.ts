import { toEastern } from "@/domain/market/eastern-time";
import { COVERED_YEARS } from "@/domain/market/calendar-data";
import { closedReason, sessionOn } from "@/domain/market/market-calendar";
import { WATCHLIST } from "@/domain/market/symbols";
import type { Bar } from "@/domain/market/bar";

/**
 * 過去データの取得の計画(SPEC-006 AC-006-09 から 11、ADR-0008)。
 * 期間は最大1年(SPEC-006 決めたこと 3)。今日の足はワーカー(T9)がためるので、昨日までにする。
 */

export type DateRange = { from: string; to: string };

/** 1回の取得の単位。1銘柄の、1か月の中の期間 */
export type ImportChunk = { symbol: string; from: string; to: string };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(date: string): boolean {
  if (!DATE_PATTERN.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** 1年前の同じ日(2/29 は 2/28 にする) */
function oneYearBefore(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const candidate = `${y - 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isValidDate(candidate) ? candidate : `${y - 1}-${String(m).padStart(2, "0")}-28`;
}

export type RangeErrors = { from?: string; to?: string };

/** 期間を確かめる。today は米国東部時間の今日 */
export function validateRange(range: DateRange, today: string): { ok: true } | { ok: false; errors: RangeErrors } {
  const errors: RangeErrors = {};
  if (!isValidDate(range.from)) errors.from = "始めの日を正しい日付で入れてください";
  if (!isValidDate(range.to)) errors.to = "終わりの日を正しい日付で入れてください";
  if (errors.from || errors.to) return { ok: false, errors };

  const firstCovered = `${Math.min(...COVERED_YEARS)}-01-01`;
  if (range.to >= today) errors.to = "終わりの日は昨日(米国東部時間)までにしてください。今日の分は自動売買のプロセスがためます";
  if (range.from > range.to) errors.from = "始めの日は終わりの日より前にしてください";
  else if (range.from < oneYearBefore(range.to)) errors.from = "期間は最大1年です";
  if (!errors.from && range.from < firstCovered) {
    errors.from = `${firstCovered.slice(0, 4)}年より前は休場日の表がないため取れません`;
  }
  return errors.from || errors.to ? { ok: false, errors } : { ok: true };
}

/** from から to(両端を含む)の取引日 */
export function tradingDays(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (closedReason(d) === null) days.push(d);
  }
  return days;
}

/**
 * 取得の計画。銘柄ごと、月ごとに分け、取り終えていない取引日が1日でもある範囲だけを残す。
 * 並びは月の古い順、同じ月の中は監視リストの順
 */
export function planImport(range: DateRange, fetched: (symbol: string) => ReadonlySet<string>): ImportChunk[] {
  const days = tradingDays(range.from, range.to);
  const months = new Map<string, string[]>();
  for (const d of days) {
    const key = d.slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), d]);
  }
  const chunks: ImportChunk[] = [];
  for (const monthDays of months.values()) {
    for (const symbol of WATCHLIST) {
      const done = fetched(symbol);
      if (monthDays.some((d) => !done.has(d))) {
        chunks.push({ symbol, from: monthDays[0], to: monthDays[monthDays.length - 1] });
      }
    }
  }
  return chunks;
}

/** 1回の取得として受け付ける範囲か(画面から送られた値を、サーバーで確かめ直す) */
export function validateChunk(chunk: ImportChunk, today: string): boolean {
  if (!(WATCHLIST as readonly string[]).includes(chunk.symbol)) return false;
  if (validateRange(chunk, today).ok !== true) return false;
  // 1回は1か月の中だけ
  return chunk.from.slice(0, 7) === chunk.to.slice(0, 7);
}

/** 通常の取引時間(取引開始から終了まで)に始まる足だけを残す。時間外の足は捨てる(ADR-0008) */
export function regularSessionBars<T extends Bar>(bars: readonly T[]): T[] {
  return bars.filter((b) => {
    const session = sessionOn(toEastern(b.start).date);
    if (!session) return false;
    const t = b.start.getTime();
    return session.open.getTime() <= t && t < session.close.getTime();
  });
}
