"use client";

import { useId, useMemo, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { compareScenarios, DEFAULT_SIMULATOR_INPUT, TAX_RATE } from "@/domain/simulator/simulator";
import { SimulatorChart } from "./simulator-chart";
import { SCENARIOS, LineSample } from "./scenarios";
import {
  chartData,
  DEFAULT_STEPS,
  formatYen,
  RATE_STEPS_MAX,
  rateLabel,
  SAVINGS_STEPS_MAX,
  savingsLabel,
  toSimulatorInput,
  TRIAL_MONTHS_MAX,
  trialLabel,
  YEARS_MAX,
  YEARS_MIN,
  yearsLabel,
  type SimulatorSteps,
} from "./simulator-model";

/** 設定の画面(T7)ができるまでは、SPEC-005 の既定の元手を使う */
const PRINCIPAL_JPY = DEFAULT_SIMULATOR_INPUT.principalJpy;

const TAX_PERCENT_LABEL = `${(TAX_RATE * 100).toFixed(3)}%`;

export function SimulatorView() {
  const [steps, setSteps] = useState<SimulatorSteps>(DEFAULT_STEPS);
  const comparison = useMemo(() => compareScenarios(toSimulatorInput(steps, PRINCIPAL_JPY)), [steps]);
  const data = useMemo(() => chartData(comparison), [comparison]);

  const set = <K extends keyof SimulatorSteps>(key: K, value: SimulatorSteps[K]) =>
    setSteps((prev) => ({ ...prev, [key]: value }));

  const lastRow = (key: (typeof SCENARIOS)[number]["key"]) => comparison[key].rows[comparison[key].rows.length - 1];
  const taxId = useId();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">資産シミュレーター</h1>
      <div className="flex flex-wrap items-start gap-4">
        <section
          aria-labelledby="sim-conditions"
          className="flex min-w-0 flex-[1_1_320px] flex-col gap-4 rounded-xl border bg-card p-5"
        >
          <h2 id="sim-conditions" className="text-base font-semibold">
            条件
          </h2>
          <div className="flex items-baseline justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2.5">
            <span className="text-fg-muted">
              最初の元手 <span className="text-xs">(元本)</span>
            </span>
            <span className="font-semibold tabular-nums">{formatYen(PRINCIPAL_JPY)}</span>
          </div>

          <StepSlider
            label="お試し期間(利益0で計算)"
            value={steps.trialMonths}
            min={0}
            max={TRIAL_MONTHS_MAX}
            valueText={trialLabel(steps.trialMonths)}
            onChange={(v) => set("trialMonths", v)}
            testId="slider-trial"
          />
          <StepSlider
            label="1日あたりの想定利益率"
            value={steps.rateSteps}
            min={0}
            max={RATE_STEPS_MAX}
            valueText={rateLabel(steps.rateSteps)}
            onChange={(v) => set("rateSteps", v)}
            testId="slider-rate"
          />
          <StepSlider
            label="続ける年数(1年 = 240営業日)"
            value={steps.years}
            min={YEARS_MIN}
            max={YEARS_MAX}
            valueText={yearsLabel(steps.years)}
            onChange={(v) => set("years", v)}
            testId="slider-years"
          />
          <StepSlider
            label="年末に利益から貯金へ回す割合"
            value={steps.savingsSteps}
            min={0}
            max={SAVINGS_STEPS_MAX}
            valueText={savingsLabel(steps.savingsSteps)}
            onChange={(v) => set("savingsSteps", v)}
            testId="slider-savings"
          />

          <div className="flex min-h-11 items-center justify-between gap-3">
            <label htmlFor={taxId} className="cursor-pointer">
              税金({TAX_PERCENT_LABEL})を引く
            </label>
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="w-8 text-right text-sm font-semibold text-fg-sub">
                {steps.taxOn ? "ON" : "OFF"}
              </span>
              <Switch id={taxId} checked={steps.taxOn} onCheckedChange={(v) => set("taxOn", v)} />
            </div>
          </div>

          <p className="border-t pt-3 text-xs text-fg-muted" data-testid="simulator-disclaimer">
            一定の利益率が毎日続くと仮定した計算で、将来の利益を示すものではありません。税金は年末にその年の利益へかかるものとして簡単にしています。
          </p>
        </section>

        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
          <section aria-labelledby="sim-compare" className="flex flex-col gap-3">
            <h2 id="sim-compare" className="sr-only">
              {yearsLabel(steps.years)}後の比較
            </h2>
            <ul className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
              {SCENARIOS.map((s) => {
                const row = lastRow(s.key);
                return (
                  <li key={s.key} className="min-w-0 rounded-xl border bg-card p-4" data-testid={`total-${s.key}`}>
                    <div className="flex items-center gap-2 text-sm text-fg-sub">
                      <LineSample scenario={s} />
                      {s.label}
                    </div>
                    <p className="mt-1.5 text-2xl font-bold tabular-nums [overflow-wrap:anywhere]">
                      {formatYen(row.totalJpy)}
                    </p>
                    <p className="text-xs text-fg-muted tabular-nums [overflow-wrap:anywhere]">
                      運用中 {formatYen(row.balanceJpy)} / 貯金 {formatYen(row.savingsJpy)}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="sim-chart" className="min-w-0 rounded-xl border bg-card p-5">
            <h2 id="sim-chart" className="text-base font-semibold">
              資産の推移(運用中のお金 + 貯金)
            </h2>
            <SimulatorChart data={data} years={steps.years} />
            {steps.taxOn && (
              <p className="mt-2 text-xs text-fg-muted">年末に線が少し下がるのは、その年の利益から税金を引いているためです。</p>
            )}
          </section>

          <section aria-labelledby="sim-table" className="min-w-0 rounded-xl border bg-card p-5">
            <h2 id="sim-table" className="text-base font-semibold">
              年次の表(年末時点)
            </h2>
            <p className="mt-1 text-xs text-fg-muted">
              税金、運用中、貯金は「{SCENARIOS[0].label}」の値です。
              <span className="sm:hidden">表は横に動かせます。</span>
            </p>
            {/* 幅が狭い時は枠の中で横に動かす(AC-007-04)。キーボードでも動かせるようにフォーカスできる */}
            <div
              className="mt-3 overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-labelledby="sim-table"
              data-testid="year-table-scroll"
            >
              <table className="w-full min-w-[820px] text-right text-sm tabular-nums">
                <thead>
                  <tr className="border-b text-xs text-fg-muted">
                    <th scope="col" className="p-2 text-left font-medium">
                      年
                    </th>
                    <th scope="col" className="p-2 font-medium">
                      税金
                    </th>
                    <th scope="col" className="p-2 font-medium">
                      運用中
                    </th>
                    <th scope="col" className="p-2 font-medium">
                      貯金
                    </th>
                    {SCENARIOS.map((s) => (
                      <th key={s.key} scope="col" className={`p-2 font-semibold ${s.headerClass}`}>
                        合計({s.shortLabel})
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {comparison.withTrial.rows.map((row, i) => (
                    <tr key={row.year} className="border-b border-muted">
                      <th scope="row" className="p-2 text-left font-semibold">
                        {row.year}年目
                      </th>
                      <td className="p-2 text-fg-muted">{formatYen(row.taxJpy)}</td>
                      <td className="p-2">{formatYen(row.balanceJpy)}</td>
                      <td className="p-2">{formatYen(row.savingsJpy)}</td>
                      {SCENARIOS.map((s) => (
                        <td key={s.key} className={`p-2 ${s.key === "withTrial" ? "font-semibold" : ""}`}>
                          {formatYen(comparison[s.key].rows[i].totalJpy)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function StepSlider({
  label,
  value,
  min,
  max,
  valueText,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  valueText: string;
  onChange: (value: number) => void;
  testId: string;
}) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span id={labelId}>{label}</span>
        <span className="shrink-0 font-semibold whitespace-nowrap tabular-nums" data-testid={`${testId}-value`}>
          {valueText}
        </span>
      </div>
      <Slider
        className="min-h-11"
        value={[value]}
        min={min}
        max={max}
        step={1}
        onValueChange={([v]) => onChange(v)}
        thumbProps={{ "aria-labelledby": labelId, "aria-valuetext": valueText }}
      />
    </div>
  );
}
