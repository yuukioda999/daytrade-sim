import type { Bar } from "@/domain/market/bar";
import type { MarketSession } from "@/domain/market/market-calendar";

/** 1回の買いに使う予算の、元手に対する割合(SPEC-003 決めたこと 5) */
export const BUDGET_RATIO = 0.5;
/** 今日の損失の上限の、元手に対する割合 */
export const DAILY_LOSS_LIMIT_RATIO = 0.1;
/** 利益を守る売りの目安を有効にする、買値からの上昇率 */
export const TRAILING_ACTIVATION_RATIO = 1.05;
/** 利益を守る売りの目安 = 最高値 × この値 */
export const TRAILING_STOP_RATIO = 0.97;
/** 株数を何桁で切り捨てるか */
const SHARE_DECIMALS = 4;
/** 小数の計算の誤差の許容幅(SPEC-002 の比べ方と同じ) */
const EPSILON = 1e-9;

const BAR_MS = 5 * 60_000;

export type ExitReason = "stop" | "trailing" | "close";

/** 持っている株(1銘柄1日1回なので、1銘柄につき最大1つ) */
export type Position = {
  symbol: string;
  entryTime: Date;
  /** 買値(ドル) */
  entryPrice: number;
  shares: number;
  /** 損切りの価格(ドル) */
  stopPrice: number;
  /** 買ってからの最高値(ドル)。最初は買値 */
  peak: number;
  /** 最後に処理した足の開始時刻。同じ足を2回処理しないために使う */
  lastBarStart: Date;
};

/** 売り終わった練習売買 */
export type ClosedTrade = {
  symbol: string;
  entryTime: Date;
  entryPrice: number;
  shares: number;
  exitTime: Date;
  exitPrice: number;
  reason: ExitReason;
  /** 損益(円)。内部は小数のまま */
  pnlJpy: number;
};

export type Account = {
  /** 元手(円) */
  principal: number;
  /** 為替レート(円/ドル) */
  fxRate: number;
  /** これまでの損益の合計(円)。日をまたいで引き継ぐ */
  realizedTotalJpy: number;
  /** 今日(米国東部時間の暦日) */
  today: string;
  /** 今日の売り終わった分の損益の合計(円) */
  realizedTodayJpy: number;
  positions: readonly Position[];
};

export function newAccount(principal: number, fxRate: number, today: string): Account {
  return { principal, fxRate, realizedTotalJpy: 0, today, realizedTodayJpy: 0, positions: [] };
}

/** 残高 = 元手 + これまでの損益の合計(SPEC-003 定義 8) */
export function balanceJpy(a: Account): number {
  return a.principal + a.realizedTotalJpy;
}

/** 持っている株の買付額(円) */
export function costJpy(p: Pick<Position, "entryPrice" | "shares">, fxRate: number): number {
  return p.entryPrice * p.shares * fxRate;
}

/** 買いに使える残り = 残高 − 持っている株の買付額の合計(定義 3) */
export function buyingPowerJpy(a: Account): number {
  return balanceJpy(a) - a.positions.reduce((sum, p) => sum + costJpy(p, a.fxRate), 0);
}

/** 今日の損失の上限に達したか(定義 9)。売り終わった分だけで数える */
export function dailyLossLimitReached(a: Account): boolean {
  return a.realizedTodayJpy + a.principal * DAILY_LOSS_LIMIT_RATIO <= EPSILON;
}

/** 株数: 予算 / (買値 × 為替) を小数4桁で切り捨てる(定義 2) */
export function sharesFor(budgetJpy: number, priceUsd: number, fxRate: number): number {
  if (budgetJpy <= 0 || priceUsd <= 0 || fxRate <= 0) return 0;
  const scale = 10 ** SHARE_DECIMALS;
  // 割り切れる時に 0.99999... と出て1つ少なく切り捨てないよう、誤差の分だけ足してから切り捨てる
  return Math.floor((budgetJpy / (priceUsd * fxRate)) * scale + EPSILON) / scale;
}

/** 損益(円) = (売値 − 買値) × 株数 × 為替(定義 7) */
export function pnlJpy(entryPrice: number, exitPrice: number, shares: number, fxRate: number): number {
  return (exitPrice - entryPrice) * shares * fxRate;
}

export type EntryResult =
  | { kind: "entered"; account: Account; position: Position }
  | { kind: "skipped"; account: Account; reason: "daily-loss-limit" | "no-buying-power" | "already-holding" };

/**
 * 買いサインの次の足の始値で練習買いする(定義 1、2、4)。
 * 買った足でも売る判定をするので、呼ぶ側は続けて processBar にその足を渡す。
 */
export function enter(
  account: Account,
  input: { symbol: string; nextBar: Bar; stopPrice: number },
): EntryResult {
  const { symbol, nextBar, stopPrice } = input;
  if (account.positions.some((p) => p.symbol === symbol)) {
    return { kind: "skipped", account, reason: "already-holding" };
  }
  if (dailyLossLimitReached(account)) {
    return { kind: "skipped", account, reason: "daily-loss-limit" };
  }
  const budget = Math.min(account.principal * BUDGET_RATIO, buyingPowerJpy(account));
  const shares = sharesFor(budget, nextBar.open, account.fxRate);
  if (shares <= 0) return { kind: "skipped", account, reason: "no-buying-power" };

  const position: Position = {
    symbol,
    entryTime: nextBar.start,
    entryPrice: nextBar.open,
    shares,
    stopPrice,
    peak: nextBar.open,
    // 買った足はまだ売る判定をしていないので、その1本前を最後に処理した足とする
    lastBarStart: new Date(nextBar.start.getTime() - BAR_MS),
  };
  return { kind: "entered", account: { ...account, positions: [...account.positions, position] }, position };
}

/** その時点の売りの基準(定義 6)。目安が有効なら max(損切り, 目安) */
export function exitThreshold(p: Position): { price: number; reason: "stop" | "trailing" } {
  const trailingActive = p.peak - p.entryPrice * TRAILING_ACTIVATION_RATIO >= -EPSILON;
  if (trailingActive) {
    const trailing = p.peak * TRAILING_STOP_RATIO;
    if (trailing > p.stopPrice) return { price: trailing, reason: "trailing" };
  }
  return { price: p.stopPrice, reason: "stop" };
}

/** その日の最後の足か(通常 15:55、短縮取引日 12:55 に始まる足) */
export function isLastBarOfSession(session: MarketSession, bar: Bar): boolean {
  return bar.start.getTime() === session.close.getTime() - BAR_MS;
}

export type BarResult = { account: Account; closed: ClosedTrade | null };

/**
 * 持っている株について、足1本ぶん売る判定をする(定義 6、10)。
 * 同じ足か、それより前の足を渡した時は何もしない。
 */
export function processBar(
  account: Account,
  input: { symbol: string; bar: Bar; isLastBar: boolean },
): BarResult {
  const { symbol, bar, isLastBar } = input;
  const p = account.positions.find((x) => x.symbol === symbol);
  if (!p || bar.start.getTime() <= p.lastBarStart.getTime()) return { account, closed: null };

  const threshold = exitThreshold(p);
  let exit: { price: number; reason: ExitReason } | null = null;
  if (bar.low - threshold.price <= EPSILON) {
    exit = { price: Math.min(threshold.price, bar.open), reason: threshold.reason };
  } else if (isLastBar) {
    exit = { price: bar.close, reason: "close" };
  }

  if (!exit) {
    // 売る判定のあとで、この足の高値で最高値を更新する(不利な側に倒す)
    const updated: Position = { ...p, peak: Math.max(p.peak, bar.high), lastBarStart: bar.start };
    return {
      account: { ...account, positions: account.positions.map((x) => (x === p ? updated : x)) },
      closed: null,
    };
  }

  const pnl = pnlJpy(p.entryPrice, exit.price, p.shares, account.fxRate);
  const closed: ClosedTrade = {
    symbol,
    entryTime: p.entryTime,
    entryPrice: p.entryPrice,
    shares: p.shares,
    exitTime: bar.start,
    exitPrice: exit.price,
    reason: exit.reason,
    pnlJpy: pnl,
  };
  return {
    account: {
      ...account,
      realizedTotalJpy: account.realizedTotalJpy + pnl,
      realizedTodayJpy: account.realizedTodayJpy + pnl,
      positions: account.positions.filter((x) => x !== p),
    },
    closed,
  };
}

/** 次の取引日に切り替える(AC-003-12)。今日の損益は0から始め、残高は引き継ぐ */
export function startDay(account: Account, date: string): Account {
  if (account.positions.length > 0) {
    throw new Error("取引終了で売っていない株があります。日を切り替える前に売る判定を終えてください");
  }
  return { ...account, today: date, realizedTodayJpy: 0 };
}
