/**
 * 3つの条件の名前と、グラフでの見た目。
 * 色だけでなく線の種類(実線、破線、点線)でも区別する(AC-005-07)。
 */
export type Scenario = {
  key: "withTrial" | "noTrial" | "fullCompound";
  label: string;
  shortLabel: string;
  /** グラフの線の色(globals.css の色) */
  stroke: string;
  /** 線の種類。undefined は実線 */
  dash: string | undefined;
  strokeWidth: number;
  /** 年次の表の見出しの文字色 */
  headerClass: string;
};

export const SCENARIOS: readonly Scenario[] = [
  {
    key: "withTrial",
    label: "お試し期間あり・貯金あり",
    shortLabel: "お試しあり・貯金あり",
    stroke: "var(--color-accent)",
    dash: undefined,
    strokeWidth: 3,
    headerClass: "text-accent-soft",
  },
  {
    key: "noTrial",
    label: "お試し期間なし・貯金あり",
    shortLabel: "お試しなし",
    stroke: "var(--color-warn)",
    dash: "8 5",
    strokeWidth: 2,
    headerClass: "text-warn",
  },
  {
    key: "fullCompound",
    label: "全額を再投資(お試しなし・貯金なし)",
    shortLabel: "全額再投資",
    stroke: "var(--color-fg)",
    dash: "2 5",
    strokeWidth: 2,
    headerClass: "text-fg",
  },
];

/** 凡例の線の見本。グラフと同じ色と線の種類で描く */
export function LineSample({ scenario }: { scenario: Scenario }) {
  return (
    <svg aria-hidden="true" width="24" height="6" viewBox="0 0 24 6" className="shrink-0">
      <line
        x1="1"
        y1="3"
        x2="23"
        y2="3"
        stroke={scenario.stroke}
        strokeWidth={scenario.strokeWidth}
        strokeDasharray={scenario.dash}
        strokeLinecap="round"
      />
    </svg>
  );
}
