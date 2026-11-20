"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { ResultRow, ResultsSection, ResultsView as View } from "@/application/results-service";
import { SignedText } from "@/components/dashboard/dashboard-view";
import { formatSignedJpy, formatSignedRatio } from "@/components/dashboard/dashboard-model";
import { formatDateJa, formatEasternDateTime, formatJpy } from "@/components/settings/format";
import { cn } from "@/components/ui/cn";
import { useRemoveChartLayersFromTabOrder } from "@/components/ui/use-chart-tab-order";

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; view: View };

const card = "rounded-xl border border-border bg-surface p-5";
const AXIS_TICK = { fill: "var(--color-fg-muted)", fontSize: 11 };
/** 0円の判定(SPEC-004。誤差 1e-9 以内は 0) */
const EPSILON = 1e-9;

/** 成績の画面(SPEC-004) */
export function ResultsView() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/results", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<View>) : Promise.reject(new Error(String(res.status)))))
      .then((view) => !cancelled && setState({ status: "ready", view }))
      .catch(() => !cancelled && setState({ status: "error" }));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">成績</h1>
      {/* AC-004-05 */}
      <p className="rounded-xl bg-accent/15 px-4 py-3 text-[13px] text-fg">
        ここに出るのは練習売買<span className="text-[11px]">(ペーパートレード)</span>
        の過去の結果で、これからの利益を示すものではありません。手数料と税金は含みません。
      </p>
      {state.status === "loading" && <p className="text-fg-sub">読み込んでいます</p>}
      {state.status === "error" && (
        <p role="alert" className="text-down">
          成績を読み込めませんでした。画面を読み込み直してください
        </p>
      )}
      {state.status === "ready" && (
        <>
          <section aria-labelledby="live-title" className="flex flex-col gap-4">
            <h2 id="live-title" className="text-lg font-semibold">
              毎日の自動売買の成績
            </h2>
            {state.view.live ? (
              <SectionBody section={state.view.live} idPrefix="live" />
            ) : (
              <p className={cn(card, "text-fg-sub")}>まだ記録がありません。自動売買のプロセスが取引時間に動くと、日ごとの成績がここに出ます。</p>
            )}
          </section>
          <section aria-labelledby="backtest-title" className="flex flex-col gap-4 border-t border-border pt-4">
            <h2 id="backtest-title" className="text-lg font-semibold">
              過去データで試した結果
            </h2>
            {state.view.backtest ? (
              <>
                <p className="text-[13px] text-fg-sub">
                  米国東部 {formatEasternDateTime(state.view.backtest.ranAt)} に試した結果です(元手 {formatJpy(state.view.backtest.principalJpy)}、1ドル{" "}
                  {(state.view.backtest.fxRateX100 / 100).toFixed(2)}円)。毎日の自動売買の記録とは別に保存しています。日付を押すと、ダッシュボードでその日を見られます。
                </p>
                <SectionBody section={state.view.backtest} idPrefix="backtest" linkToDashboard />
              </>
            ) : (
              <div className={card}>
                <p className="text-fg-sub">まだ試していません。過去データを取って試すと、同じルールで自動売買を試した結果がここに出ます。</p>
                <Link href="/settings#sec-backtest" className="inline-flex min-h-11 items-center text-accent-soft">
                  設定の画面で過去データを取って試す
                </Link>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function SectionBody({ section, idPrefix, linkToDashboard = false }: { section: ResultsSection; idPrefix: string; linkToDashboard?: boolean }) {
  const s = section.summary;
  const firstDate = section.rows[0]?.date;
  const lastDate = section.rows.at(-1)?.date;
  return (
    <>
      <p className="text-xs text-fg-muted">
        {firstDate && lastDate
          ? `${formatDateJa(firstDate, { withYear: true })}から${formatDateJa(lastDate, { withYear: true })}まで、${s.recordedDays}日分`
          : ""}
      </p>
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3" data-testid={`${idPrefix}-summary`}>
        <Fact label="合計の損益">
          <SignedText value={formatSignedJpy(s.totalPnlJpy)} />
          <span className="block text-xs font-normal text-fg-muted">
            元手 {formatJpy(section.principalJpy)}に対して <SignedText value={formatSignedRatio(s.totalPnlRatio)} />
          </span>
        </Fact>
        <Fact label="プラスの日 / マイナスの日">
          {s.plusDays}日 / {s.minusDays}日
          <span className="block text-xs font-normal text-fg-muted">
            0円の日 {s.zeroDays}日。記録した日数 {s.recordedDays}日
          </span>
        </Fact>
        <Fact label="一番損した日">
          {s.worstDay ? <SignedText value={formatSignedJpy(s.worstDay.pnlJpy)} /> : "なし"}
          <span className="block text-xs font-normal text-fg-muted">{s.worstDay ? formatDateJa(s.worstDay.date, { withYear: true }) : ""}</span>
        </Fact>
        <Fact label="損失の上限で止まった日">
          {s.limitReachedDays}日
          <span className="block text-xs font-normal text-fg-muted">上限は1日あたり元手の10%(デイリー損失リミット)</span>
        </Fact>
      </dl>
      <DailyChart rows={section.rows} idPrefix={idPrefix} />
      <DailyTable rows={section.rows} idPrefix={idPrefix} linkToDashboard={linkToDashboard} />
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={cn(card, "p-4")}>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="text-2xl font-bold">{children}</dd>
    </div>
  );
}

const tone = (v: number) => (v > EPSILON ? "up" : v < -EPSILON ? "down" : "flat");
const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/** 日ごとの損益の棒グラフ。プラスは上向きの緑、マイナスは下向きの赤(色と向きの両方。AC-004-06)。同じ内容は下の表にある */
function DailyChart({ rows, idPrefix }: { rows: ResultRow[]; idPrefix: string }) {
  const ref = useRemoveChartLayersFromTabOrder();
  const plus = rows.filter((r) => tone(r.pnlJpy) === "up").length;
  const minus = rows.filter((r) => tone(r.pnlJpy) === "down").length;
  const data = rows.map((r) => ({ date: shortDate(r.date), pnl: r.pnlJpy }));
  return (
    <figure className={cn(card, "m-0")}>
      <h3 className="text-[15px] font-semibold">日ごとの損益</h3>
      <div ref={ref} className="mt-3 h-[220px]" data-testid={`${idPrefix}-chart`} aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid stroke="var(--color-muted)" vertical={false} />
            <XAxis dataKey="date" tick={AXIS_TICK} stroke="var(--color-border)" interval="preserveStartEnd" minTickGap={16} />
            <YAxis tick={AXIS_TICK} stroke="var(--color-border)" width={56} tickFormatter={(v: number) => `${Math.round(v)}円`} />
            <ReferenceLine y={0} stroke="var(--color-input)" />
            <Bar dataKey="pnl" isAnimationActive={false}>
              {data.map((d, i) => (
                <Cell key={i} fill={tone(d.pnl) === "down" ? "var(--color-down)" : "var(--color-up)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 text-xs text-fg-sub">
        {rows.length}日分の日ごとの損益。プラスの日(上向きの緑)が{plus}日、マイナスの日(下向きの赤)が{minus}日。数字は下の表にあります。
      </figcaption>
    </figure>
  );
}

function DailyTable({ rows, idPrefix, linkToDashboard }: { rows: ResultRow[]; idPrefix: string; linkToDashboard: boolean }) {
  const titleId = `${idPrefix}-table-title`;
  return (
    <section aria-labelledby={titleId} className={card}>
      <h3 id={titleId} className="text-[15px] font-semibold">
        日ごとの表
      </h3>
      <div className="mt-3 max-h-[480px] overflow-auto" tabIndex={0} role="region" aria-labelledby={titleId} data-testid={`${idPrefix}-table`}>
        <table className="w-full min-w-[520px] border-collapse text-right">
          <thead className="sticky top-0 bg-surface">
            <tr className="text-xs text-fg-muted">
              <th scope="col" className="border-b border-border p-2 text-left font-medium">
                日付
              </th>
              <th scope="col" className="border-b border-border p-2 font-medium">
                その日の損益
              </th>
              <th scope="col" className="border-b border-border p-2 font-medium">
                その日の終わりの残高
              </th>
              <th scope="col" className="border-b border-border p-2 text-left font-medium">
                印
              </th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr key={r.date}>
                <th scope="row" className="border-b border-muted px-2 py-2.5 text-left font-semibold">
                  {linkToDashboard ? (
                    <Link href={`/?backtest=${r.date}`} className="text-accent-soft underline">
                      {formatDateJa(r.date, { withYear: true })}
                    </Link>
                  ) : (
                    formatDateJa(r.date, { withYear: true })
                  )}
                </th>
                <td className="border-b border-muted px-2 py-2.5 font-semibold">
                  <SignedText value={formatSignedJpy(r.pnlJpy)} />
                </td>
                <td className="border-b border-muted px-2 py-2.5">{formatJpy(r.endingBalanceJpy)}</td>
                <td className="border-b border-muted px-2 py-2.5 text-left text-xs">
                  <Marks row={r} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.some((r) => r.late) && (
        <p className="mt-2 text-xs text-fg-sub">
          「あとから処理」: 自動売買のプロセスが止まっていたなどで、足が届いてから30分より後に処理した記録を含む日です
        </p>
      )}
    </section>
  );
}

function Marks({ row }: { row: ResultRow }) {
  const marks: { text: string; className: string }[] = [];
  if (row.inProgress) marks.push({ text: "途中", className: "bg-accent/15 text-accent-soft" });
  if (row.late) marks.push({ text: "あとから処理", className: "bg-warn/15 text-fg" });
  if (row.limitReached) marks.push({ text: "損失の上限で停止", className: "bg-down/15 text-fg" });
  return (
    <span className="flex flex-wrap gap-1">
      {marks.map((m) => (
        <span key={m.text} className={cn("whitespace-nowrap rounded px-1.5 py-0.5 font-bold", m.className)}>
          {m.text}
        </span>
      ))}
    </span>
  );
}
