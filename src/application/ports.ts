import type { Bar } from "@/domain/market/bar";
import type { CredentialsInput, MoneySettings } from "@/domain/settings/settings";

/**
 * 保存先の入口(ADR-0003)。本番は SQLite、テストはメモリの実装に差し替える。
 */
export interface SettingsRepository {
  /** 自動売買の ON / OFF。まだ保存していなければ null */
  getAutoTradingEnabled(): boolean | null;
  setAutoTradingEnabled(enabled: boolean): void;
  /** 元手と為替レートの変更の履歴(使い始める日の古い順) */
  listMoneySettings(): MoneySettings[];
  /** 同じ使い始める日の設定があれば置き換える */
  putMoneySettings(settings: MoneySettings): void;
  /** 自動売買の ON / OFF を変えた時刻の履歴(古い順。ADR-0009) */
  listAutoTradingChanges(): { at: Date; enabled: boolean }[];
}

/**
 * Alpaca の接続用キー(ADR-0006)。get はデータを取る処理(T8 以降)だけが使う。
 * 画面へ返す値は、application の settings-service で末尾4文字に絞る。
 */
export interface CredentialsRepository {
  get(): CredentialsInput | null;
  save(credentials: CredentialsInput): void;
  delete(): void;
}

/** 銘柄つきの5分足。receivedAt は自動売買のプロセスが受け取った時刻(過去データの取得では undefined) */
export type SymbolBar = Bar & { symbol: string; receivedAt?: Date };

/** 5分足の保存先(ADR-0008) */
export interface BarRepository {
  /** 足を保存する。同じ銘柄の同じ時刻の足がすでにあれば保存しない(AC-006-10)。新しく保存した本数を返す */
  saveBars(bars: readonly SymbolBar[]): number;
  /** 過去データを取り終えた日として記録する */
  markFetched(symbol: string, dates: readonly string[]): void;
  /** from から to(両端を含む)のうち、取り終えた日 */
  fetchedDates(symbol: string, from: string, to: string): string[];
  /** start から end(end を含まない)に始まる足(古い順) */
  barsBetween(symbol: string, start: Date, end: Date): SymbolBar[];
  /** date より前の、取り終えた日のうち新しい方から limit 日(古い順で返す) */
  fetchedDatesBefore(symbol: string, date: string, limit: number): string[];
  /** 銘柄ごとの、保存している足の本数と、取り終えた日の数、最初と最後 */
  summary(): { symbol: string; barCount: number; dayCount: number; firstDate: string | null; lastDate: string | null }[];
}

/** 自動売買のプロセスが動いた取引日(SPEC-004 の「記録のある日」) */
export type DayRun = {
  date: string;
  principalJpy: number;
  fxRateX100: number;
  /** その日より前の損益の合計(円) */
  startingRealizedJpy: number;
  /** その日を締めたか */
  closed: boolean;
  startedAt: Date;
};

/** 練習売買の記録。売っていない株は exit が null */
export type TradeRecord = {
  date: string;
  symbol: string;
  signalBarStart: Date;
  entryTime: Date;
  entryPrice: number;
  shares: number;
  stopPrice: number;
  exit: { time: Date; price: number; reason: "stop" | "trailing" | "close"; pnlJpy: number } | null;
  /** あとから処理した記録(SPEC-003 定義 11) */
  late: boolean;
};

export type WorkerState = "running" | "idle" | "no-credentials" | "data-error" | "calendar-outdated";

export type WorkerStatus = {
  heartbeatAt: Date;
  lastBarReceivedAt: Date | null;
  state: WorkerState;
  /** 画面に出す言葉 */
  message: string;
};

/** 練習売買の記録と、自動売買のプロセスの様子の保存先(ADR-0009) */
export interface TradingRepository {
  getDayRun(date: string): DayRun | null;
  putDayRun(run: DayRun): void;
  listDayRuns(): DayRun[];
  /** その日の記録を、まとめて置き換える */
  replaceDayTrades(date: string, records: readonly TradeRecord[]): void;
  listTrades(date: string): TradeRecord[];
  /** date より前の日の、売り終わった記録の損益の合計(円) */
  realizedBefore(date: string): number;
  getWorkerStatus(): WorkerStatus | null;
  putWorkerStatus(status: WorkerStatus): void;
}

export type Repositories = {
  settings: SettingsRepository;
  credentials: CredentialsRepository;
  bars: BarRepository;
  trading: TradingRepository;
};

/** 市場データの取得元のエラーの種類。画面に出す言葉は application で決める */
export type MarketDataErrorKind = "unauthorized" | "rate-limited" | "network" | "server" | "bad-response";

export class MarketDataError extends Error {
  constructor(
    readonly kind: MarketDataErrorKind,
    /** 調べるための短い説明。キーや応答の本文は入れない */
    detail: string,
  ) {
    super(`市場データを取得できませんでした(${kind}): ${detail}`);
    this.name = "MarketDataError";
  }
}

/** 市場データの取得元(ADR-0005)。本番は Alpaca、テストは差し替える */
export interface MarketDataSource {
  /** 通信しないテスト用の取得元なら true。画面に「本物のデータではない」と出すため */
  readonly isTestSource: boolean;
  /** start から end(end を含まない)の5分足。時間外の足も含めて返す */
  fetchBars(credentials: CredentialsInput, symbol: string, start: Date, end: Date): Promise<SymbolBar[]>;
  /** now の15分以上前の、最も新しい5分足。なければ null */
  latestBar(credentials: CredentialsInput, symbol: string, now: Date): Promise<SymbolBar | null>;
}
