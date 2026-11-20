import { toEastern } from "@/domain/market/eastern-time";
import {
  planImport,
  regularSessionBars,
  tradingDays,
  validateChunk,
  validateRange,
  type DateRange,
  type ImportChunk,
  type RangeErrors,
} from "@/domain/history/import-plan";
import { sessionOn } from "@/domain/market/market-calendar";
import { MarketDataError, type MarketDataErrorKind, type MarketDataSource, type Repositories } from "./ports";

/** 接続の確かめに使う銘柄(SPEC-006 AC-006-05) */
const CHECK_SYMBOL = "SOXL";

export const NO_CREDENTIALS_MESSAGE = "接続用キーが未設定です。先にキーを保存してください";

/** 取得に失敗した時に画面に出す言葉。キーや応答の本文は入れない(AC-006-05) */
export function marketDataErrorMessage(kind: MarketDataErrorKind): string {
  switch (kind) {
    case "unauthorized":
      return "接続できませんでした。キー ID かシークレットが違うか、このキーではデータを取れません";
    case "rate-limited":
      return "Alpaca の回数の上限に達しました。1分ほど待ってから、もう一度試してください";
    case "network":
      return "Alpaca に接続できませんでした。インターネットの接続を確かめてください";
    case "server":
      return "Alpaca 側でエラーが起きました。時間をおいて、もう一度試してください";
    case "bad-response":
      return "Alpaca の応答を読めませんでした";
  }
}

function logFailure(kind: MarketDataErrorKind): void {
  // 種類だけを残す。キー、URL、応答の本文はログに出さない(ADR-0006)
  console.warn(`市場データの取得に失敗しました(${kind})`);
}

export type ConnectionCheckResult =
  | { ok: true; symbol: string; barStart: string; close: number }
  | { ok: false; message: string };

/** 接続を確かめる。SOXL の最新の5分足を1本取る(AC-006-05) */
export async function checkConnection(
  repos: Repositories,
  source: MarketDataSource,
  now: Date,
): Promise<ConnectionCheckResult> {
  const credentials = repos.credentials.get();
  if (!credentials) return { ok: false, message: NO_CREDENTIALS_MESSAGE };
  try {
    const bar = await source.latestBar(credentials, CHECK_SYMBOL, now);
    if (!bar) return { ok: false, message: "接続できましたが、SOXL の足を受け取れませんでした" };
    return { ok: true, symbol: CHECK_SYMBOL, barStart: bar.start.toISOString(), close: bar.close };
  } catch (e) {
    if (e instanceof MarketDataError) {
      logFailure(e.kind);
      return { ok: false, message: marketDataErrorMessage(e.kind) };
    }
    throw e;
  }
}

export type ImportPlanResult = { ok: true; chunks: ImportChunk[] } | { ok: false; errors: RangeErrors };

/** 期間から、まだ取っていない範囲の一覧を作る(AC-006-09、11) */
export function planHistoricalImport(repos: Repositories, range: DateRange, now: Date): ImportPlanResult {
  const today = toEastern(now).date;
  const valid = validateRange(range, today);
  if (!valid.ok) return valid;
  const chunks = planImport(range, (symbol) => new Set(repos.bars.fetchedDates(symbol, range.from, range.to)));
  return { ok: true, chunks };
}

export type ImportChunkResult =
  | { ok: true; received: number; saved: number }
  | { ok: false; reason: "invalid" | "no-credentials" | "failed"; message: string };

const INVALID_CHUNK = { ok: false, reason: "invalid", message: "取得する範囲が正しくありません" } as const;

/**
 * 1回分(1銘柄の1か月の中)を取って保存する(AC-006-09、10、11)。
 * 失敗した時は何も記録しないので、それまでの分は残り、同じ範囲をもう一度取れる
 */
export async function importChunk(
  repos: Repositories,
  source: MarketDataSource,
  chunk: ImportChunk,
  now: Date,
): Promise<ImportChunkResult> {
  if (!validateChunk(chunk, toEastern(now).date)) return INVALID_CHUNK;
  const credentials = repos.credentials.get();
  if (!credentials) return { ok: false, reason: "no-credentials", message: NO_CREDENTIALS_MESSAGE };
  const days = tradingDays(chunk.from, chunk.to);
  if (days.length === 0) return { ok: true, received: 0, saved: 0 };
  const first = sessionOn(days[0]);
  const last = sessionOn(days[days.length - 1]);
  if (!first || !last) return INVALID_CHUNK;
  try {
    const bars = await source.fetchBars(credentials, chunk.symbol, first.open, last.close);
    const regular = regularSessionBars(bars.filter((b) => b.symbol === chunk.symbol));
    const saved = repos.bars.saveBars(regular);
    // 足を保存してから、取り終えた日として記録する(途中で止まっても、次は取り直す側に倒れる)
    repos.bars.markFetched(chunk.symbol, days);
    return { ok: true, received: regular.length, saved };
  } catch (e) {
    if (e instanceof MarketDataError) {
      logFailure(e.kind);
      return { ok: false, reason: "failed", message: marketDataErrorMessage(e.kind) };
    }
    throw e;
  }
}

/** 保存している過去データの様子(銘柄ごと) */
export function historicalSummary(repos: Repositories) {
  return repos.bars.summary();
}
