import type { Bar } from "@/domain/market/bar";
import type { MarketSession } from "@/domain/market/market-calendar";
import { WATCHLIST } from "@/domain/market/symbols";
import { evaluateBar } from "@/domain/signal/buy-signal";
import {
  enter,
  isLastBarOfSession,
  processBar,
  settleSessionEnd,
  type Account,
  type ClosedTrade,
  type Position,
  type SkipReason,
} from "./paper-trading";

/**
 * その日の足を最初から順に処理して、その日の練習売買の記録を作る(ADR-0009)。
 * 同じ入力なら必ず同じ結果になるので、ワーカーは毎回作り直して置き換えればよい(SPEC-003 定義 10、11)。
 * 過去データで試す(T11)も同じ関数を使う。
 */
export type ReplayInput = {
  session: MarketSession;
  /** その日の始めの状態(today は session.date、今日の損益は 0、持っている株なし) */
  account: Account;
  /** 銘柄ごとのその日の足(通常の取引時間の中だけ。古い順で、同じ時刻は1本) */
  bars: Readonly<Record<string, readonly Bar[]>>;
  /** 足と同じ時刻に始まる、過去の取引日の取引量(古い順。SPEC-002 定義 4) */
  pastVolumes: (symbol: string, barStart: Date) => readonly number[];
  /**
   * その銘柄のその足で新しく買ってよいか(自動売買の ON / OFF。SPEC-006 AC-006-01)。
   * ワーカーは、その足を受け取った時刻の ON / OFF で決める(ADR-0009)
   */
  buyingAllowed: (symbol: string, barStart: Date) => boolean;
  /**
   * その日を締めるか。true なら、売っていない株を届いた最後の足で売る(SPEC-003 定義 14)。
   * 取引終了から30分たったあとに true にするのは呼ぶ側
   */
  closeOut: boolean;
};

export type BuyRecord = {
  symbol: string;
  /** 買いサインが出た足の開始時刻 */
  signalBarStart: Date;
  /** 買った足の開始時刻 */
  entryTime: Date;
  entryPrice: number;
  shares: number;
  stopPrice: number;
};

export type SkipRecord = {
  symbol: string;
  signalBarStart: Date;
  /** 買わなかった足の開始時刻 */
  barStart: Date;
  reason: SkipReason | "auto-trading-off";
};

export type ReplayResult = {
  account: Account;
  buys: BuyRecord[];
  skips: SkipRecord[];
  trades: ClosedTrade[];
  /** その日の終わり(または今)に持っている株 */
  openPositions: readonly Position[];
};

type PendingBuy = { signalBarStart: Date; stopPrice: number };

export function replayDay(input: ReplayInput): ReplayResult {
  const { session } = input;
  if (input.account.today !== session.date) {
    throw new Error(`その日の始めの状態(${input.account.today})と、処理する日(${session.date})が違います`);
  }
  if (input.account.positions.length > 0 || input.account.realizedTodayJpy !== 0) {
    throw new Error("その日の始めの状態に、持っている株か今日の損益があります");
  }

  // 銘柄ごとの足を時刻で引けるようにし、すべての時刻を古い順に並べる
  const symbols = WATCHLIST.filter((s) => (input.bars[s]?.length ?? 0) > 0);
  const times = [...new Set(symbols.flatMap((s) => input.bars[s].map((b) => b.start.getTime())))].sort((a, b) => a - b);

  let account = input.account;
  const buys: BuyRecord[] = [];
  const skips: SkipRecord[] = [];
  const trades: ClosedTrade[] = [];
  const pending = new Map<string, PendingBuy>();
  const signaled = new Set<string>();
  const seen = new Map<string, Bar[]>();

  for (const t of times) {
    // 同じ時刻の足は、全銘柄の買い、全銘柄の売る判定、全銘柄の買いサインの判定、の順に処理する(SPEC-003 定義 15)。
    // 足の始値で買う時点では、同じ足の途中で売って空くお金はまだ使えないため。買う順は監視リストの順
    const atT = symbols.flatMap((symbol) => {
      const bar = input.bars[symbol].find((b) => b.start.getTime() === t);
      return bar ? [{ symbol, bar }] : [];
    });

    // 1. 前の足で買いサインが出ていれば、この足の始値で買う(SPEC-003 定義 1)
    for (const { symbol, bar } of atT) {
      const p = pending.get(symbol);
      if (!p) continue;
      pending.delete(symbol);
      if (!input.buyingAllowed(symbol, bar.start)) {
        skips.push({ symbol, signalBarStart: p.signalBarStart, barStart: bar.start, reason: "auto-trading-off" });
        continue;
      }
      const r = enter(account, { session, symbol, nextBar: bar, stopPrice: p.stopPrice });
      account = r.account;
      if (r.kind === "entered") {
        buys.push({
          symbol,
          signalBarStart: p.signalBarStart,
          entryTime: r.position.entryTime,
          entryPrice: r.position.entryPrice,
          shares: r.position.shares,
          stopPrice: r.position.stopPrice,
        });
      } else {
        skips.push({ symbol, signalBarStart: p.signalBarStart, barStart: bar.start, reason: r.reason });
      }
    }

    // 2. 持っている株の売る判定(買った足を含む。定義 6)
    for (const { symbol, bar } of atT) {
      const sold = processBar(account, { symbol, bar, isLastBar: isLastBarOfSession(session, bar) });
      account = sold.account;
      if (sold.closed) trades.push(sold.closed);
    }

    // 3. この足で買いサインを判定する(SPEC-002)
    for (const { symbol, bar } of atT) {
      const through = [...(seen.get(symbol) ?? []), bar];
      seen.set(symbol, through);
      const evaluation = evaluateBar({
        session,
        barsThroughT: through,
        pastSameTimeVolumes: input.pastVolumes(symbol, bar.start),
        alreadySignaledToday: signaled.has(symbol),
      });
      if (evaluation.buySignal && evaluation.orbLow !== null) {
        signaled.add(symbol);
        pending.set(symbol, { signalBarStart: bar.start, stopPrice: evaluation.orbLow });
      }
    }
  }

  // 4. その日を締める時は、売っていない株を届いた最後の足で売る(定義 14)
  if (input.closeOut) {
    for (const position of [...account.positions]) {
      const received = input.bars[position.symbol];
      const last = received[received.length - 1];
      const r = settleSessionEnd(account, { symbol: position.symbol, lastReceivedBar: last });
      account = r.account;
      if (r.closed) trades.push(r.closed);
    }
  }

  return { account, buys, skips, trades, openPositions: account.positions };
}
