import { toEastern } from "@/domain/market/eastern-time";
import type { ClosedTrade } from "@/domain/trading/paper-trading";

/** 小数の計算の誤差の許容幅(SPEC-002 の比べ方と同じ) */
const EPSILON = 1e-9;

/** 1日分の成績 */
export type DayResult = {
  /** 米国東部時間の暦日 YYYY-MM-DD */
  date: string;
  /** その日に売った分の損益の合計(円) */
  pnlJpy: number;
  /** その日に今日の損失の上限に達したか */
  limitReached: boolean;
};

export type ResultsSummary = {
  recordedDays: number;
  totalPnlJpy: number;
  /** 合計の損益 / 元手。-0.05 は -5% */
  totalPnlRatio: number;
  plusDays: number;
  minusDays: number;
  zeroDays: number;
  /** 一番損した日。記録がない時は null */
  worstDay: { date: string; pnlJpy: number } | null;
  limitReachedDays: number;
};

export type DayRow = DayResult & {
  /** その日の終わりの残高(円) = 元手 + その日までの損益の合計 */
  endingBalanceJpy: number;
};

/**
 * 売った記録を、売った日(米国東部時間の暦日)ごとに合計する(SPEC-004「その日の損益」)。
 * 損失の上限に達した日は、呼ぶ側が日付の一覧で渡す。上限は売り終わった分で決まるので(SPEC-003)、
 * 上限に達した日には必ず売りの記録がある。売買がなかった日は含まれない。
 */
export function groupByDay(
  trades: readonly ClosedTrade[],
  limitReachedDates: ReadonlySet<string> = new Set(),
): DayResult[] {
  const byDate = new Map<string, number>();
  for (const t of trades) {
    const date = toEastern(t.exitTime).date;
    byDate.set(date, (byDate.get(date) ?? 0) + t.pnlJpy);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, pnlJpy]) => ({ date, pnlJpy, limitReached: limitReachedDates.has(date) }));
}

function sign(x: number): -1 | 0 | 1 {
  if (x > EPSILON) return 1;
  if (x < -EPSILON) return -1;
  return 0;
}

/** 成績のまとめ(SPEC-004 計算の定義)。days は古い順でなくてもよい。 */
export function summarize(days: readonly DayResult[], principalJpy: number): ResultsSummary {
  if (!(principalJpy > 0)) throw new Error(`元手は0より大きくしてください: ${principalJpy}`);
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].date === sorted[i - 1].date) throw new Error(`同じ日の成績が重なっています: ${sorted[i].date}`);
  }

  let total = 0;
  let worst: { date: string; pnlJpy: number } | null = null;
  const counts = { plus: 0, minus: 0, zero: 0, limit: 0 };
  for (const d of sorted) {
    total += d.pnlJpy;
    const s = sign(d.pnlJpy);
    if (s > 0) counts.plus += 1;
    else if (s < 0) counts.minus += 1;
    else counts.zero += 1;
    if (d.limitReached) counts.limit += 1;
    // 同じ値なら古い日を残す(古い順に見て、より小さい時だけ入れ替える)
    if (worst === null || d.pnlJpy < worst.pnlJpy - EPSILON) worst = { date: d.date, pnlJpy: d.pnlJpy };
  }

  return {
    recordedDays: sorted.length,
    totalPnlJpy: total,
    totalPnlRatio: total / principalJpy,
    plusDays: counts.plus,
    minusDays: counts.minus,
    zeroDays: counts.zero,
    worstDay: worst,
    limitReachedDays: counts.limit,
  };
}

/** 日ごとの表の行(SPEC-004「日ごとの表」)。古い順に、その日の終わりの残高を付ける。 */
export function dayRows(days: readonly DayResult[], principalJpy: number): DayRow[] {
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let balance = principalJpy;
  return sorted.map((d) => {
    balance += d.pnlJpy;
    return { ...d, endingBalanceJpy: balance };
  });
}
