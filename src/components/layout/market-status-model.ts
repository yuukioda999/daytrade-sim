import { isDaylightSaving, toEastern } from "@/domain/market/eastern-time";
import { CalendarOutOfRangeError, isMarketOpen } from "@/domain/market/market-calendar";

export type MarketStatusView =
  | { kind: "open" | "closed" | "stale"; time: string; dst: boolean }
  | { kind: "error" };

/** ヘッダーに出す市場の状態を決める(SPEC-001 AC-001-12、AC-001-13)。 */
export function describeMarketStatus(now: Date): MarketStatusView {
  try {
    const e = toEastern(now);
    const time = `${String(e.hour).padStart(2, "0")}:${String(e.minute).padStart(2, "0")}`;
    const dst = isDaylightSaving(now);
    try {
      return { kind: isMarketOpen(now) ? "open" : "closed", time, dst };
    } catch (error) {
      if (error instanceof CalendarOutOfRangeError) return { kind: "stale", time, dst };
      throw error;
    }
  } catch {
    // タイムゾーンの機能がないブラウザなど。ヘッダーごと落とさず、表示できないことを出す
    return { kind: "error" };
  }
}

export const STATUS_LABEL = {
  open: "市場は開いています",
  closed: "市場は閉まっています",
  stale: "休場日の表が古いため、開いているか判定できません",
  error: "このブラウザでは米国の時刻を表示できません",
} as const;
