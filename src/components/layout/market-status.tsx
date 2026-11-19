"use client";

import { useEffect, useState } from "react";
import { isDaylightSaving, toEastern } from "@/domain/market/eastern-time";
import { CalendarOutOfRangeError, isMarketOpen } from "@/domain/market/market-calendar";

type Status =
  | { kind: "open" | "closed"; time: string; dst: boolean }
  | { kind: "stale"; time: string; dst: boolean };

function describe(now: Date): Status {
  const e = toEastern(now);
  const time = `${String(e.hour).padStart(2, "0")}:${String(e.minute).padStart(2, "0")}`;
  const dst = isDaylightSaving(now);
  try {
    return { kind: isMarketOpen(now) ? "open" : "closed", time, dst };
  } catch (error) {
    if (error instanceof CalendarOutOfRangeError) return { kind: "stale", time, dst };
    throw error;
  }
}

const LABEL = {
  open: "市場は開いています",
  closed: "市場は閉まっています",
  stale: "休場日の表が古いため、開いているか判定できません",
} as const;

const CHIP = {
  open: "bg-up/15 text-up",
  closed: "bg-muted text-fg-sub",
  stale: "bg-warn/15 text-warn",
} as const;

/** ヘッダーの、米国東部時間と市場が開いているか(SPEC-001 AC-001-12、AC-001-13)。 */
export function MarketStatus() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);

  // サーバーで描く時は時刻を持たないので、ブラウザで時刻が決まってから出す
  if (!now) return <div className="min-h-7" aria-hidden="true" />;

  const s = describe(now);
  return (
    <div className="flex flex-wrap items-center gap-3 text-[13px]" data-testid="market-status">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${CHIP[s.kind]}`}
      >
        <span aria-hidden="true" className="size-2 rounded-full bg-current" />
        {LABEL[s.kind]}
      </span>
      <span className="text-fg-muted">
        米国東部 {s.time}({s.dst ? "夏時間" : "冬時間"})
      </span>
    </div>
  );
}
