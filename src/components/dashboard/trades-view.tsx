"use client";

import Link from "next/link";
import type { DashboardView as View, TradeView } from "@/application/dashboard-service";
import { formatJpy } from "@/components/settings/format";
import { cn } from "@/components/ui/cn";
import { BUDGET_RATIO, DAILY_LOSS_LIMIT_RATIO, TRAILING_ACTIVATION_RATIO, TRAILING_STOP_RATIO } from "@/domain/trading/paper-trading";
import { exitReasonLabel, formatEasternTime, formatSignedJpy, formatUsd } from "./dashboard-model";
import { dayLabelOf, PositionsCard, RefreshFailed, SignedText } from "./dashboard-view";
import { useDashboard } from "./use-dashboard";

const card = "rounded-xl border border-border bg-surface p-5";
const percent = (r: number) => `${Math.round(r * 100)}%`;

/** 自動売買の記録の画面(SPEC-007 AC-007-19、20) */
export function TradesView() {
  const state = useDashboard();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">自動売買の記録</h1>
      {state.status === "loading" && <p className="text-fg-sub">読み込んでいます</p>}
      {state.status === "error" && (
        <p role="alert" className="text-down">
          記録を読み込めませんでした。画面を読み込み直してください
        </p>
      )}
      {state.status === "ready" && (
        <>
          {state.refreshFailed && <RefreshFailed />}
          <div className="flex flex-wrap items-start gap-4">
            <Rules view={state.view} />
            <div className="min-w-0 flex-[1_1_380px]">
              <PositionsCard positions={state.view.positions} />
            </div>
          </div>
          <TradesTable view={state.view} />
        </>
      )}
    </div>
  );
}

function Rules({ view }: { view: View }) {
  const principal = view.money?.principalJpy ?? null;
  return (
    <section aria-labelledby="rules-title" className={cn(card, "min-w-0 flex-[1_1_380px]")}>
      <div className="flex items-center justify-between gap-2">
        <h2 id="rules-title" className="text-[15px] font-semibold">
          自動売買のルール
        </h2>
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-[11px] font-bold",
            view.autoTradingEnabled ? "bg-accent/15 text-accent-soft" : "bg-warn/15 text-fg",
          )}
        >
          {view.autoTradingEnabled ? "ON" : "OFF(新しく買いません)"}
        </span>
      </div>
      <ol className="mt-3 flex list-decimal flex-col gap-1.5 pl-5 text-fg-sub">
        <li>3つの条件(朝の高値超え、今日の平均価格より上、取引量の増加)がそろったら、次の5分足の始値で練習買いする</li>
        <li>損切りの価格(逆指値)まで下がったら売る</li>
        <li>
          利益が{percent(TRAILING_ACTIVATION_RATIO - 1)}を超えたら、買ってからの最高値から{percent(1 - TRAILING_STOP_RATIO)}
          下がった時に売る(利益を守る売りの目安、トレーリングストップ)
        </li>
        <li>残った株は、その日の取引終了時に売る</li>
        <li>今日の損失が上限(元手の{percent(DAILY_LOSS_LIMIT_RATIO)})に達したら、その日は新しく買わない</li>
        <li>1つの銘柄は1日1回まで買う</li>
      </ol>
      <div className="mt-3.5 flex justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2.5">
        <span className="text-fg-muted">1回の買いに使う金額</span>
        <span className="font-semibold">
          元手の{percent(BUDGET_RATIO)}まで{principal === null ? "" : `(${formatJpy(principal * BUDGET_RATIO)})`}
        </span>
      </div>
      <p className="mt-2.5 text-xs text-fg-muted">実際の注文は出しません。練習の売買として記録だけを残します。</p>
      <Link href="/settings" className="inline-flex min-h-11 items-center text-accent-soft">
        設定で変える
      </Link>
    </section>
  );
}

function TradesTable({ view }: { view: View }) {
  const dayLabel = dayLabelOf(view);
  const realized = view.trades.reduce((a, t) => a + (t.exit?.pnlJpy ?? 0), 0);
  const anyLate = view.trades.some((t) => t.late);
  return (
    <section aria-labelledby="trades-title" className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="trades-title" className="text-[15px] font-semibold">
          {dayLabel}の自動売買の記録
        </h2>
        <span className="text-xs text-fg-muted">時刻は米国東部時間</span>
      </div>
      {view.date !== null && !view.isToday && (
        <p className="mt-1 text-xs text-fg-sub">今日(米国東部)の記録はまだないので、最後に記録した日を出しています</p>
      )}
      {view.trades.length === 0 ? (
        <p className="mt-3 text-fg-sub">{view.isToday || view.date === null ? "今日はまだ売買していません" : `${dayLabel}は売買していません`}</p>
      ) : (
        <>
          {/* 幅が狭い時は、表をこの枠の中で横に動かす(AC-007-04)。キーボードでも動かせるように枠にフォーカスできるようにする */}
          <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-labelledby="trades-title" data-testid="trades-scroll">
            <table className="w-full min-w-[820px] border-collapse text-right">
              <thead>
                <tr className="text-xs text-fg-muted">
                  <th scope="col" className="border-b border-border p-2 text-left font-medium">
                    銘柄
                  </th>
                  <th scope="col" className="border-b border-border p-2 font-medium">
                    買った時刻
                  </th>
                  <th scope="col" className="border-b border-border p-2 font-medium">
                    売った時刻
                  </th>
                  <th scope="col" className="border-b border-border p-2 font-medium">
                    株数
                  </th>
                  <th scope="col" className="border-b border-border p-2 font-medium">
                    買値
                  </th>
                  <th scope="col" className="border-b border-border p-2 font-medium">
                    売値
                  </th>
                  <th scope="col" className="border-b border-border p-2 text-left font-medium">
                    売った理由
                  </th>
                  <th scope="col" className="border-b border-border p-2 font-medium">
                    損益
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.trades.map((t) => (
                  <TradeRow key={`${t.symbol}-${t.entryTime}`} trade={t} view={view} />
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={7} className="p-2 text-left font-semibold">
                    売買が済んだ分の合計
                  </th>
                  <td className="p-2 font-bold">
                    <SignedText value={formatSignedJpy(realized)} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          {anyLate && (
            <p className="mt-2 text-xs text-fg-sub">
              「あとから処理」: 自動売買のプロセスが止まっていたなどで、足が届いてから30分より後に処理した記録です。同じルールで計算していますが、その時に画面で見ていた値とは違うことがあります
            </p>
          )}
        </>
      )}
    </section>
  );
}

function TradeRow({ trade: t, view }: { trade: TradeView; view: View }) {
  const position = view.positions.find((p) => p.symbol === t.symbol);
  const cell = "border-b border-muted px-2 py-2.5";
  return (
    <tr>
      <th scope="row" className={cn(cell, "text-left font-semibold")}>
        {t.symbol}
        {t.late && <span className="ml-2 rounded bg-warn/15 px-1.5 py-0.5 text-[11px] font-bold text-fg">あとから処理</span>}
      </th>
      <td className={cell}>{formatEasternTime(t.entryTime)}</td>
      <td className={cn(cell, !t.exit && "text-accent-soft")}>{t.exit ? formatEasternTime(t.exit.time) : "保有中"}</td>
      <td className={cell}>{t.shares.toFixed(4)}</td>
      <td className={cell}>{formatUsd(t.entryPrice)}</td>
      <td className={cell}>{t.exit ? formatUsd(t.exit.price) : "まだ売っていない"}</td>
      <td className={cn(cell, "text-left")}>{t.exit ? exitReasonLabel(t.exit.reason) : ""}</td>
      <td className={cn(cell, "font-semibold")}>
        {t.exit ? (
          <SignedText value={formatSignedJpy(t.exit.pnlJpy)} />
        ) : position ? (
          <span className="font-normal text-fg-muted">
            未確定 <SignedText value={formatSignedJpy(position.unrealizedJpy)} />
          </span>
        ) : (
          ""
        )}
      </td>
    </tr>
  );
}
