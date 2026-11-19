"use client";

import { useEffect, useState } from "react";
import { describeMarketStatus, STATUS_LABEL } from "./market-status-model";

const CHIP = {
  open: "bg-up/15 text-up",
  closed: "bg-muted text-fg-sub",
  stale: "bg-warn/15 text-warn",
  error: "bg-warn/15 text-warn",
} as const;

/** 次の分の境目までの時間(ミリ秒)。09:30 や 16:00 をまたいだらすぐ表示を変えるため。 */
function msToNextMinute(now: Date): number {
  return 60_000 - (now.getTime() % 60_000);
}

/** ヘッダーの、米国東部時間と市場が開いているか(SPEC-001 AC-001-12、AC-001-13)。 */
export function MarketStatus() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const t = new Date();
      setNow(t);
      timer = setTimeout(tick, msToNextMinute(t));
    };
    tick();
    return () => clearTimeout(timer);
  }, []);

  // サーバーで描く時は時刻を持たないので、ブラウザで時刻が決まってから出す
  if (!now) return <div className="min-h-7" aria-hidden="true" />;

  const s = describeMarketStatus(now);
  return (
    <div className="flex flex-wrap items-center gap-3 text-[13px]" data-testid="market-status">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${CHIP[s.kind]}`}
      >
        <span aria-hidden="true" className="size-2 rounded-full bg-current" />
        {STATUS_LABEL[s.kind]}
      </span>
      {s.kind !== "error" && (
        <span className="text-fg-muted">
          米国東部 {s.time}({s.dst ? "夏時間" : "冬時間"})
        </span>
      )}
    </div>
  );
}
