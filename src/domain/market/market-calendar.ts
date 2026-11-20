import { COVERED_YEARS, EARLY_CLOSES, HOLIDAYS } from "./calendar-data";
import { fromEastern, toEastern, weekdayOf } from "./eastern-time";

/** 休場日の表にない年を判定しようとした(SPEC-001 AC-001-12)。 */
export class CalendarOutOfRangeError extends Error {
  constructor(readonly year: number) {
    super(`休場日の表に ${year} 年がありません`);
    this.name = "CalendarOutOfRangeError";
  }
}

export type MarketSession = {
  /** 米国東部時間の暦日 YYYY-MM-DD */
  date: string;
  open: Date;
  /** この時刻を含まない */
  close: Date;
  earlyClose: boolean;
  /** 朝の値幅の時間の終わり(09:45、含まない) */
  orbEnd: Date;
  /** 新しい買いの締め切り。この時刻以降に始まる足では買わない */
  entryCutoff: Date;
};

export type ClosedReason = "weekend" | "holiday";

const OPEN = { hour: 9, minute: 30 } as const;
const ORB_END = { hour: 9, minute: 45 } as const;
const REGULAR_CLOSE = { hour: 16, minute: 0 } as const;
const EARLY_CLOSE = { hour: 13, minute: 0 } as const;
const ENTRY_CUTOFF_BEFORE_CLOSE_MS = 30 * 60_000;

function assertCovered(date: string): void {
  const year = Number(date.slice(0, 4));
  if (!COVERED_YEARS.includes(year)) throw new CalendarOutOfRangeError(year);
}

/** その日が休みならその理由、取引日なら null。 */
export function closedReason(date: string): ClosedReason | null {
  assertCovered(date);
  const weekday = weekdayOf(date);
  if (weekday === 0 || weekday === 6) return "weekend";
  if (date in HOLIDAYS) return "holiday";
  return null;
}

/** date より後の、最初の取引日(米国東部時間の暦日)。休みの日の表にない年に入るとエラー。 */
export function nextTradingDate(date: string): string {
  let d = addDays(date, 1);
  // 休みは長くても数日なので、14日先までに必ず見つかる
  for (let i = 0; i < 14; i++) {
    if (closedReason(d) === null) return d;
    d = addDays(d, 1);
  }
  throw new Error(`${date} の後14日に取引日がありません`);
}

function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** 米国東部時間の暦日の取引時間。休みの日は null。 */
export function sessionOn(date: string): MarketSession | null {
  if (closedReason(date) !== null) return null;
  const earlyClose = EARLY_CLOSES.includes(date);
  const closeAt = earlyClose ? EARLY_CLOSE : REGULAR_CLOSE;
  const close = fromEastern(date, closeAt.hour, closeAt.minute);
  return {
    date,
    open: fromEastern(date, OPEN.hour, OPEN.minute),
    close,
    earlyClose,
    orbEnd: fromEastern(date, ORB_END.hour, ORB_END.minute),
    entryCutoff: new Date(close.getTime() - ENTRY_CUTOFF_BEFORE_CLOSE_MS),
  };
}

/** その瞬間に市場が開いているか(取引開始を含み、終了を含まない)。 */
export function isMarketOpen(instant: Date): boolean {
  const session = sessionOn(toEastern(instant).date);
  if (!session) return false;
  const t = instant.getTime();
  return session.open.getTime() <= t && t < session.close.getTime();
}

const BAR_MS = 5 * 60_000;

/** 朝の値幅の時間に始まる5分足の開始時刻(09:30、09:35、09:40)。 */
export function orbBarStarts(session: MarketSession): Date[] {
  const starts: Date[] = [];
  for (let t = session.open.getTime(); t < session.orbEnd.getTime(); t += BAR_MS) {
    starts.push(new Date(t));
  }
  return starts;
}
