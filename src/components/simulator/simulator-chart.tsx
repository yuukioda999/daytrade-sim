"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DAYS_PER_YEAR } from "@/domain/simulator/simulator";
import { LineSample, SCENARIOS } from "./scenarios";
import { dayTickLabel, formatYen, formatYenShort, yearTicks, type ChartPoint } from "./simulator-model";

const AXIS_TICK = { fill: "var(--color-fg-muted)", fontSize: 11 };

function dayLabel(day: number): string {
  if (day === 0) return "開始";
  const year = Math.floor(day / DAYS_PER_YEAR);
  const rest = day % DAYS_PER_YEAR;
  return rest === 0 ? `${year}年目の年末(年末の処理の後)` : `${year + 1}年目 ${rest}営業日目`;
}

export function SimulatorChart({ data, years }: { data: ChartPoint[]; years: number }) {
  const last = data[data.length - 1];
  // グラフを見られない人向けに、要点を文字で伝える。数字の全体は年次の表にある
  const summary = `3つの条件の資産の推移を比べる折れ線グラフ。${years}年後の合計は、${SCENARIOS.map(
    (s) => `${s.label} ${formatYen(last[s.key])}`,
  ).join("、")}。`;

  return (
    <div className="mt-3 flex flex-col gap-3">
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-fg-sub" aria-label="グラフの線の見方">
        {SCENARIOS.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <LineSample scenario={s} />
            {s.label}
          </li>
        ))}
      </ul>
      <div role="img" aria-label={summary} className="h-80 w-full min-w-0" data-testid="simulator-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }} accessibilityLayer={false}>
            <CartesianGrid stroke="var(--color-muted)" vertical={false} />
            <XAxis
              dataKey="day"
              type="number"
              domain={[0, years * DAYS_PER_YEAR]}
              ticks={yearTicks(years)}
              tickFormatter={dayTickLabel}
              tick={AXIS_TICK}
              stroke="var(--color-border)"
            />
            <YAxis
              width={72}
              tickFormatter={formatYenShort}
              tick={AXIS_TICK}
              stroke="var(--color-border)"
              domain={[0, "auto"]}
            />
            <Tooltip
              labelFormatter={(day) => dayLabel(Number(day))}
              formatter={(value) => formatYen(Number(value))}
              contentStyle={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                color: "var(--color-fg)",
                fontSize: 12,
              }}
              labelStyle={{ color: "var(--color-fg-sub)" }}
            />
            {SCENARIOS.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                name={s.label}
                type="linear"
                stroke={s.stroke}
                strokeWidth={s.strokeWidth}
                strokeDasharray={s.dash}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
