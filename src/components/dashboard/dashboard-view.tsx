"use client";

import Link from "next/link";
import { useId, useState, useSyncExternalStore } from "react";
import type { DashboardView as View, PositionView, SymbolView, TradeView } from "@/application/dashboard-service";
import { cn } from "@/components/ui/cn";
import { formatDateJa, formatEasternDateTime, formatJpy } from "@/components/settings/format";
import {
  chartSummary,
  conditionRows,
  formatEasternTime,
  formatShares,
  formatSignedJpy,
  formatSignedRatio,
  formatUsd,
  latestTrade,
  lossLimitPercent,
  statusLabel,
  workerNotice,
  type Signed,
} from "./dashboard-model";
import { PriceChart } from "./price-chart";
import { useDashboard } from "./use-dashboard";

const card = "rounded-xl border border-border bg-surface p-4";
const subhead = "text-[13px] font-semibold text-fg-muted";

/** 上げ下げの数値。色に加えて ▲▼ と符号で示す(AC-007-06) */
export function SignedText({ value, className }: { value: Signed; className?: string }) {
  return (
    <span className={cn("whitespace-nowrap", value.tone === "up" && "text-up", value.tone === "down" && "text-down", className)}>
      {value.text}
    </span>
  );
}

/** URL の ?backtest=YYYY-MM-DD(成績の画面の日付のリンクから来る。AC-007-18) */
function backtestDateOf(search: string): string | null {
  const d = new URLSearchParams(search).get("backtest");
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

const subscribeNothing = () => () => {};

export function DashboardView() {
  // サーバーでの描画では URL の検索の部分が分からないので null。ブラウザで読んでから中身を出す
  const search = useSyncExternalStore(
    subscribeNothing,
    () => window.location.search,
    () => null,
  );
  // 切り替えたあとの日(undefined なら URL のとおり)
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const backtestDate = chosen !== undefined ? chosen : search === null ? null : backtestDateOf(search);
  const setBacktestDate = (date: string | null) => {
    setChosen(date);
    // 読み込み直しても同じ日を出せるように、URL に残す
    const url = new URL(window.location.href);
    if (date === null) url.searchParams.delete("backtest");
    else url.searchParams.set("backtest", date);
    window.history.replaceState(null, "", url);
  };
  return (
    <>
      {/* 見出しは読み込みの前から出す(画面の名前は読み上げで分かるようにし、見た目はワイヤーフレームどおり出さない) */}
      <h1 className="sr-only">ダッシュボード</h1>
      {search !== null && <DashboardBody backtestDate={backtestDate} onBacktestDate={setBacktestDate} />}
    </>
  );
}

function DashboardBody({ backtestDate, onBacktestDate }: { backtestDate: string | null; onBacktestDate: (d: string | null) => void }) {
  const state = useDashboard(backtestDate);
  const [selected, setSelected] = useState<string | null>(null);
  // 読み込みの前は、試した日があるか分からない(null)
  const knownDates = state.lastView?.backtestDates ?? null;

  const toggle = (
    <DataModeToggle
      backtestDate={backtestDate}
      dates={knownDates}
      onLive={() => onBacktestDate(null)}
      onBacktest={(d) => onBacktestDate(d)}
    />
  );
  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-4">
        {toggle}
        <p className="text-fg-sub">読み込んでいます</p>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex flex-col gap-4">
        {toggle}
        <p role="alert" className="text-down">
          {backtestDate !== null && state.notFound
            ? "その日は過去データで試していません。設定の画面で過去データで試してから、日を選んでください"
            : "ダッシュボードを読み込めませんでした。画面を読み込み直してください"}
        </p>
      </div>
    );
  }
  const view = state.view;
  const symbol = view.symbols.find((s) => s.symbol === selected) ?? defaultSymbol(view);
  const backtest = view.mode === "backtest";

  return (
    <div className="flex flex-col gap-4">
      {toggle}
      {state.refreshFailed && <RefreshFailed />}
      {backtest ? <BacktestBanner view={view} onSelect={(d) => onBacktestDate(d)} /> : <DayNotice view={view} />}
      {view.money?.limitReached && <LimitWarning view={view} />}
      <div className="flex flex-wrap items-start gap-4">
        <Watchlist view={view} selected={symbol.symbol} onSelect={setSelected} />
        <section aria-label="選んだ銘柄" className="flex min-w-0 flex-[999_1_520px] flex-col gap-4">
          <ChartCard view={symbol} />
          <BuyCard trade={latestTrade(view.trades)} showTradesLink={!backtest} />
        </section>
        <section aria-label={`${dayLabelOf(view)}のお金の状況`} className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
          {!backtest && <WorkerCard view={view} />}
          <MoneyCard view={view} />
          <PositionsCard positions={view.positions} />
        </section>
      </div>
    </div>
  );
}

/** 「今日の市場」と「過去データで試す」の切り替え(ワイヤーフレームのヘッダーの切り替え。AC-007-18) */
function DataModeToggle({
  backtestDate,
  dates,
  onLive,
  onBacktest,
}: {
  backtestDate: string | null;
  dates: string[] | null;
  onLive: () => void;
  onBacktest: (date: string) => void;
}) {
  const [noData, setNoData] = useState(false);
  const button = "min-h-11 px-3 text-[13px]";
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div role="group" aria-label="使うデータ" className="flex overflow-hidden rounded-lg border border-border">
        <button
          type="button"
          aria-pressed={backtestDate === null}
          onClick={() => {
            setNoData(false);
            onLive();
          }}
          className={cn(button, backtestDate === null ? "bg-muted font-semibold text-fg" : "text-fg-muted hover:text-fg")}
        >
          今日の市場
        </button>
        <button
          type="button"
          aria-pressed={backtestDate !== null}
          disabled={dates === null && backtestDate === null}
          onClick={() => {
            const last = dates?.at(-1);
            if (last) onBacktest(backtestDate ?? last);
            else setNoData(true);
          }}
          className={cn(
            button,
            "disabled:opacity-50",
            backtestDate !== null ? "bg-muted font-semibold text-fg" : "text-fg-muted hover:text-fg",
          )}
        >
          過去データで試す
        </button>
      </div>
      <p role="status" className="text-[13px] text-fg-sub">
        {noData && (
          <>
            まだ過去データで試していません。
            <Link href="/settings#sec-backtest" className="text-accent-soft underline">
              設定の画面で試せます
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

/** 過去データで試した日を見ている時の表示。日付を大きく出し、今日の市場と取り違えないようにする(AC-007-18) */
function BacktestBanner({ view, onSelect }: { view: View; onSelect: (date: string) => void }) {
  const id = useId();
  if (view.date === null) return null;
  return (
    <section aria-labelledby={`${id}-title`} className="rounded-xl border-2 border-warn bg-warn/15 px-5 py-4" data-testid="backtest-banner">
      <p className="text-[13px] font-semibold text-fg">過去データで試した結果を見ています。今日の市場ではありません</p>
      <h2 id={`${id}-title`} className="mt-1 text-3xl font-bold text-fg">
        {formatDateJa(view.date, { withYear: true })}
      </h2>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-date`} className="text-[13px] text-fg">
          試した日を選ぶ
        </label>
        <select
          id={`${id}-date`}
          value={view.date}
          onChange={(e) => onSelect(e.target.value)}
          className="min-h-11 rounded-lg border border-input bg-surface-2 px-3 text-fg"
        >
          {[...view.backtestDates].reverse().map((d) => (
            <option key={d} value={d}>
              {formatDateJa(d, { withYear: true })}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-2 text-xs text-fg">保存している過去の値動きで、毎日の自動売買と同じルールを試した結果です。実際の注文は出していません。</p>
    </section>
  );
}

/** 初めに選ぶ銘柄: 持っている株、なければ条件が多くそろった銘柄 */
function defaultSymbol(view: View): SymbolView {
  const holding = view.symbols.find((s) => s.status === "holding");
  if (holding) return holding;
  return view.symbols.reduce((a, s) => (s.met > a.met ? s : a), view.symbols[0]);
}

export function RefreshFailed() {
  return (
    <p role="status" className="rounded-xl border border-warn bg-warn/15 px-4 py-3 text-fg">
      最新の値を読み直せませんでした。前に読んだ値を出しています。1分後にもう一度読み直します
    </p>
  );
}

function DayNotice({ view }: { view: View }) {
  if (view.date === null) {
    return (
      <p className={cn(card, "text-fg-sub")}>
        まだ練習売買の記録がありません。取引時間になり、自動売買のプロセスがデータを受け取ると、ここに出ます。
      </p>
    );
  }
  if (view.isToday) return null;
  return (
    <p className={cn(card, "text-fg-sub")}>
      今日(米国東部)の記録はまだありません。<strong className="text-fg">{formatDateJa(view.date)}</strong>
      の記録を出しています。
    </p>
  );
}

/** 「今日」か、表示している日の日付(AC-007-21) */
export function dayLabelOf(view: Pick<View, "date" | "isToday">): string {
  return view.date === null || view.isToday ? "今日" : formatDateJa(view.date);
}

function LimitWarning({ view }: { view: View }) {
  const day = dayLabelOf(view);
  return (
    <div role="alert" className="rounded-xl border border-down bg-down/15 px-4 py-3">
      <p className="font-bold text-fg">{day}の損失が上限に達しました</p>
      <p className="text-[13px] text-fg">
        {view.isToday
          ? "今日はこれ以上、自動で買いません(新しい買いを止めています)。持っている株の売りは続けています。次の取引日の始めに再開します。"
          : "その日は、上限に達したあと新しい買いを止め、持っている株の売りは続けました。"}
      </p>
    </div>
  );
}

function Watchlist({ view, selected, onSelect }: { view: View; selected: string; onSelect: (s: string) => void }) {
  return (
    <section aria-labelledby="watchlist-title" className="flex min-w-0 flex-[1_1_300px] flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="watchlist-title" className={subhead}>
          監視リスト
        </h2>
        <span className="text-xs text-fg-muted">3つの条件がそろうと「買いサイン」</span>
      </div>
      <ul className="flex flex-col gap-3">
        {view.symbols.map((s) => (
          <li key={s.symbol}>
            <WatchItem view={s} selected={s.symbol === selected} onSelect={() => onSelect(s.symbol)} />
          </li>
        ))}
      </ul>
      <details className={cn(card, "py-1")}>
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">3つの条件の意味</summary>
        <dl className="mb-3 flex flex-col gap-2 text-xs text-fg-sub">
          <div>
            <dt className="font-bold text-fg">朝の高値超え(ORB)</dt>
            <dd>取引開始から15分間の一番高い値段を、その後の5分ごとの終わりの値段が上回っていること。</dd>
          </div>
          <div>
            <dt className="font-bold text-fg">今日の平均価格より上(VWAP)</dt>
            <dd>今日売買された値段の平均(取引量で重みをつけた平均)より、今の値段が高いこと。</dd>
          </div>
          <div>
            <dt className="font-bold text-fg">取引量の増加(出来高急増)</dt>
            <dd>同じ時刻の過去20取引日の平均と比べて、売買された株の数が1.5倍以上あること。</dd>
          </div>
        </dl>
      </details>
    </section>
  );
}

function WatchItem({ view, selected, onSelect }: { view: SymbolView; selected: boolean; onSelect: () => void }) {
  const label = statusLabel(view);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      data-testid={`watch-${view.symbol}`}
      className={cn(
        "block w-full rounded-xl border bg-surface p-3.5 text-left",
        selected ? "border-accent" : "border-border hover:border-input",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-base font-bold">{view.symbol}</span>
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-[11px] font-bold",
            label.kind === "holding" && "bg-up/15 text-up",
            label.kind === "sold" && "bg-accent/15 text-accent-soft",
            label.kind === "watching" && "bg-muted text-fg-sub",
          )}
        >
          {label.text}
        </span>
      </span>
      <span className="mt-1 flex items-baseline justify-between gap-2">
        {view.lastPrice === null ? (
          <span className="text-fg-sub">今日の値動きはまだ届いていません</span>
        ) : (
          <span className="text-xl font-semibold">{formatUsd(view.lastPrice)}</span>
        )}
        {view.changeRatio !== null && (
          <span className="text-[13px]">
            <span className="sr-only">前の取引日の終値から</span>
            <SignedText value={formatSignedRatio(view.changeRatio)} />
          </span>
        )}
      </span>
      <span className="mt-2.5 flex flex-col gap-1 text-xs">
        {conditionRows(view).map((r) => (
          <span key={r.term} className="flex justify-between gap-2">
            <span className="text-fg-muted">
              {r.label}
              <span className="text-[11px]">({r.term})</span> {r.detail}
            </span>
            <span className={cn("shrink-0 whitespace-nowrap", r.met ? "font-semibold text-up" : "text-fg-muted")}>
              {r.met ? "達成" : "未達"}
            </span>
          </span>
        ))}
      </span>
    </button>
  );
}

function ChartCard({ view }: { view: SymbolView }) {
  return (
    <figure className={cn(card, "m-0")}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-xl font-bold">{view.symbol}</h2>
          {view.lastPrice !== null && <span className="text-xl font-semibold">{formatUsd(view.lastPrice)}</span>}
          {view.changeRatio !== null && <SignedText value={formatSignedRatio(view.changeRatio)} />}
          <span className="text-xs text-fg-muted">5分足</span>
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-fg-muted">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-0 w-3.5 border-t border-dashed border-accent-soft" />
            朝の高値と安値(取引開始から15分)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-0.5 w-3.5 bg-warn" />
            今日の平均価格(VWAP)
          </span>
        </div>
      </div>
      <div className="mt-4">
        <PriceChart key={view.symbol} view={view} />
      </div>
      <figcaption className="mt-3 text-[13px] text-fg-sub" data-testid="chart-summary">
        {chartSummary(view)}
      </figcaption>
      {/* 制作者の表示(AC-007-13)。リンクはチャートの左下の TradingView のロゴ(部品が出す)。ここには URL を書かない(通信先を Alpaca だけにする決まり) */}
      <p className="mt-1 text-xs text-fg-muted">チャートの部品: TradingView Lightweight Charts(左下のロゴ)</p>
    </figure>
  );
}

function BuyCard({ trade, showTradesLink }: { trade: TradeView | null; showTradesLink: boolean }) {
  if (!trade) return null;
  return (
    <section aria-labelledby="buy-card-title" className={cn(card, "border-up")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="rounded-md bg-up/15 px-2.5 py-1 text-[13px] font-bold text-up">
          買いサイン<span className="text-[11px]">(BUY SIGNAL)</span>
        </span>
        <h2 id="buy-card-title" className="text-[15px] font-semibold">
          {trade.symbol} は3つの条件がそろいました
        </h2>
        <span className="text-xs text-fg-muted">
          米国東部 {formatEasternTime(trade.signalTime)} の足で成立し、{formatEasternTime(trade.entryTime)} に自動で練習買いしました
        </span>
      </div>
      <dl className="mt-3.5 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
        <BuyFact label="自動で練習買い(ペーパートレード)した価格" value={formatUsd(trade.entryPrice)} />
        <BuyFact label="損切りの価格(逆指値。ここまで下がったら売る)" value={formatUsd(trade.stopPrice)} />
        <BuyFact label={`買った量(${formatJpy(trade.costJpy)}分)`} value={formatShares(trade.shares)} />
      </dl>
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-fg-sub">
          実際の注文は出していません。買いサインは条件がそろったことを示す表示で、買うことを勧めるものではありません。
        </p>
        {/* 自動売買の記録の画面は毎日の記録だけを出すので、過去データで試した日を見ている時は出さない */}
        {showTradesLink && (
          <Link href="/trades" className="inline-flex min-h-11 items-center rounded-lg bg-accent px-4 font-bold text-accent-fg">
            自動売買の記録を見る
          </Link>
        )}
      </div>
    </section>
  );
}

function BuyFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2 p-3">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="text-xl font-semibold">{value}</dd>
    </div>
  );
}

function WorkerCard({ view }: { view: View }) {
  const notice = workerNotice(view, (iso) => `米国東部 ${formatEasternDateTime(iso)}`);
  const buys = view.trades.length;
  const sells = view.trades.filter((t) => t.exit !== null).length;
  return (
    <section aria-labelledby="worker-title" className={card} data-testid="worker-card">
      <div className="flex items-center justify-between gap-2">
        <h2 id="worker-title" className={subhead}>
          自動売買
        </h2>
        {!view.autoTradingEnabled && <span className="rounded-md bg-warn/15 px-2 py-0.5 text-[11px] font-bold text-fg">OFF</span>}
      </div>
      <p
        role={notice.tone === "ok" ? undefined : "status"}
        className={cn("mt-2 font-semibold", notice.tone === "error" ? "text-down" : notice.tone === "warn" ? "text-fg" : "text-up")}
      >
        {notice.title}
      </p>
      {notice.detail && <p className="mt-1 text-xs text-fg-sub">{notice.detail}</p>}
      {view.date !== null && (
        <p className="mt-2 text-[15px] font-semibold">
          {dayLabelOf(view)}の買い {buys}回 / 売り {sells}回
        </p>
      )}
      <p className="mt-1 text-xs text-fg-muted">条件がそろうと自動で練習買いします。実際の注文は出ません。</p>
    </section>
  );
}

function MoneyCard({ view }: { view: View }) {
  const m = view.money;
  if (!m) return null;
  const usedPercent = lossLimitPercent(m.lossLimitUsedRatio, m.limitReached);
  const day = dayLabelOf(view);
  const remaining = Math.max(0, m.dailyLossLimitJpy + Math.min(0, m.todayRealizedJpy));
  return (
    <section aria-labelledby="money-title" className={card} data-testid="money-card">
      <div className="flex items-baseline justify-between">
        <h2 id="money-title" className={subhead}>
          {day}のお金の状況
        </h2>
        {view.mode === "live" && (
          <Link href="/trades" className="inline-flex min-h-11 items-center text-xs text-accent-soft">
            詳細
          </Link>
        )}
      </div>
      <p className="text-xs text-fg-muted">
        残高。元手<span className="text-[11px]">(元本)</span>は {formatJpy(m.principalJpy)}
      </p>
      <p className="text-[28px] font-bold">{formatJpy(m.balanceJpy)}</p>
      <dl className="mt-2 flex flex-col gap-1">
        <div className="flex justify-between gap-2">
          <dt className="text-fg-muted">{day}の損益(売買が済んだ分)</dt>
          <dd className="shrink-0 font-semibold">
            <SignedText value={formatSignedJpy(m.todayRealizedJpy)} />
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-fg-muted">持っている株の損益(未確定)</dt>
          <dd className="shrink-0 font-semibold">
            <SignedText value={formatSignedJpy(m.unrealizedJpy)} />
          </dd>
        </div>
      </dl>
      <div className="mt-3.5 flex justify-between gap-2 text-xs text-fg-muted">
        <span>
          {day}の損失の上限<span className="text-[11px]">(デイリー損失リミット)</span>: 元手の10% = {formatJpy(m.dailyLossLimitJpy)}
        </span>
        <span className={cn("shrink-0 whitespace-nowrap", m.limitReached && "font-semibold text-down")}>{usedPercent}% 使用</span>
      </div>
      <div
        role="img"
        aria-label={`${day}の損失の上限の ${usedPercent}% を使用`}
        className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-muted"
      >
        <div className={cn("h-full", m.limitReached ? "bg-down" : "bg-warn")} style={{ width: `${usedPercent}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-fg-muted">
        {!view.isToday
          ? m.limitReached
            ? "上限に達したので、その日は新しい買いを止めました"
            : "その日は上限に達しませんでした"
          : m.limitReached
            ? "上限に達したので、今日の新しい買いを止めています"
            : `あと ${formatJpy(remaining)}の損失で、今日の新しい買いを止めます`}
      </p>
    </section>
  );
}

export function PositionsCard({ positions }: { positions: PositionView[] }) {
  return (
    <section aria-labelledby="positions-title" className={card} data-testid="positions-card">
      <h2 id="positions-title" className={subhead}>
        今持っている株
      </h2>
      {positions.length === 0 ? (
        <p className="mt-2 text-fg-sub">今は持っている株はありません</p>
      ) : (
        <ul className="flex flex-col">
          {positions.map((p) => (
            <li key={p.symbol} className="border-border pt-3 not-first:mt-3 not-first:border-t">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-base font-bold">{p.symbol}</span>
                <span className="font-semibold">
                  <SignedText value={formatSignedRatio(p.changeRatio)} />(
                  <SignedText value={formatSignedJpy(p.unrealizedJpy)} />)
                </span>
              </div>
              <p className="mt-0.5 text-xs text-fg-muted">
                {formatShares(p.shares)} / 買値 {formatUsd(p.entryPrice)} / 今 {formatUsd(p.lastPrice)}
                {p.exitKind === "trailing" && ` / 買ってからの最高値 ${formatUsd(p.peak)}`}
              </p>
              <div className="mt-2.5 rounded-lg bg-surface-2 p-3">
                <p className="text-xs text-fg-muted">
                  {p.exitKind === "trailing" ? "利益を守る売りの目安(トレーリングストップ)" : "損切りの価格(逆指値)"}
                </p>
                <p className="text-[22px] font-semibold">{formatUsd(p.exitPrice)}</p>
                <p className="text-xs text-fg-muted">
                  {p.exitKind === "trailing" ? "買ってからの最高値から3%下。ここまで下がったら自動で売ります" : "ここまで下がったら自動で売ります"}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
