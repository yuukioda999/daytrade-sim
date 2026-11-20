import { nextTradingDate } from "@/domain/market/market-calendar";
import { BUDGET_RATIO, DAILY_LOSS_LIMIT_RATIO } from "@/domain/trading/paper-trading";

/** 元手の範囲(SPEC-006 AC-006-13) */
export const PRINCIPAL_MIN_JPY = 1_000;
export const PRINCIPAL_MAX_JPY = 10_000_000;
/** 為替レートの範囲(SPEC-006 AC-006-14)。保存は 100 倍した整数で行う(小数の誤差を持ち込まないため) */
export const FX_RATE_MIN = 50;
export const FX_RATE_MAX = 300;

/** 設定がまだない時に使う値(ワイヤーフレームと SPEC-003 の例の値) */
export const DEFAULT_PRINCIPAL_JPY = 10_000;
export const DEFAULT_FX_RATE_X100 = 15_000;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** 全角の数字やカンマを半角にそろえ、前後の空白を取る */
function normalizeNumberText(text: string): string {
  return text.normalize("NFKC").trim();
}

/** 元手の入力を読む。1,000 から 10,000,000 の整数だけ(AC-006-13)。桁区切りのカンマは許す */
export function parsePrincipal(text: string): ParseResult<number> {
  const s = normalizeNumberText(text);
  if (s === "") return { ok: false, error: "元手を入れてください" };
  // 桁区切りは3桁ごとのカンマだけを許す(1,0000 のような書き間違いは受け付けない)
  if (!/^(\d{1,3}(,\d{3})+|\d+)$/.test(s)) {
    return { ok: false, error: "元手は整数(円)で入れてください" };
  }
  const value = Number(s.replaceAll(",", ""));
  if (value < PRINCIPAL_MIN_JPY || value > PRINCIPAL_MAX_JPY) {
    return { ok: false, error: "元手は 1,000円 から 10,000,000円 の範囲にしてください" };
  }
  return { ok: true, value };
}

/**
 * 為替レートの入力を読む。50 から 300 までの、小数2桁までの数(AC-006-14)。
 * 値は 100 倍した整数で返す(150.25 は 15025)。
 */
export function parseFxRate(text: string): ParseResult<number> {
  const s = normalizeNumberText(text);
  if (s === "") return { ok: false, error: "為替レートを入れてください" };
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return { ok: false, error: "為替レートは小数2桁までの数で入れてください" };
  const x100 = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (x100 < FX_RATE_MIN * 100 || x100 > FX_RATE_MAX * 100) {
    return { ok: false, error: "為替レートは 50 から 300 の範囲にしてください" };
  }
  return { ok: true, value: x100 };
}

export function fxRateFromX100(x100: number): number {
  return x100 / 100;
}

/** 元手と為替レートの組。effectiveDate(米国東部時間の暦日)から使う */
export type MoneySettings = {
  effectiveDate: string;
  principalJpy: number;
  fxRateX100: number;
};

/** その日に使う元手と為替レート。変更の履歴から、その日以前で最も新しいものを選ぶ */
export function moneySettingsOn(history: readonly MoneySettings[], date: string): MoneySettings | null {
  let found: MoneySettings | null = null;
  for (const h of history) {
    if (h.effectiveDate <= date && (found === null || h.effectiveDate > found.effectiveDate)) found = h;
  }
  return found;
}

/**
 * その日に使う元手と為替レート。まだ一度も保存していなければ既定の値(effectiveDate は null)。
 * 画面と自動売買(T9)の両方がこれを使い、既定の値を1か所で決める(T7 のレビュー 4)
 */
export function effectiveMoneyOn(
  history: readonly MoneySettings[],
  date: string,
): { effectiveDate: string | null; principalJpy: number; fxRateX100: number } {
  return (
    moneySettingsOn(history, date) ?? {
      effectiveDate: null,
      principalJpy: DEFAULT_PRINCIPAL_JPY,
      fxRateX100: DEFAULT_FX_RATE_X100,
    }
  );
}

/**
 * 元手と為替レートの変更を、いつから使うかを決める(AC-006-15、SPEC-003 定義 12)。
 * まだ一度も設定していない時は、記録がないのですぐ使う(today から)。
 * 設定がある時は、日の途中で計算の前提が変わらないように、次の取引日から使う。
 * 過去の日の値は変えないので、過去の記録は計算し直されない。
 */
export function scheduleMoneyChange(
  history: readonly MoneySettings[],
  change: { principalJpy: number; fxRateX100: number },
  today: string,
): MoneySettings {
  const effectiveDate = history.length === 0 ? today : nextTradingDate(today);
  return { effectiveDate, ...change };
}

/** 1回の買いの予算と、今日の損失の上限(設定では変えられない。AC-006-02) */
export function fixedLimitsJpy(principalJpy: number): { budgetJpy: number; dailyLossLimitJpy: number } {
  return {
    budgetJpy: principalJpy * BUDGET_RATIO,
    dailyLossLimitJpy: principalJpy * DAILY_LOSS_LIMIT_RATIO,
  };
}

/**
 * 接続用キーの形式(AC-006-08。2026-11-20 に人間が「ゆるく確かめる」を選んだ)。
 * 前後の空白を取り、英字と数字だけで 16 から 64 文字。正しいキーかどうかは「接続を確かめる」で分かる。
 * エラー文には入力の値を入れない(ADR-0006)。
 */
const CREDENTIAL_PATTERN = /^[A-Za-z0-9]{16,64}$/;

export type CredentialsInput = { keyId: string; secret: string };
export type CredentialsErrors = { keyId?: string; secret?: string };

export function validateCredentials(
  input: CredentialsInput,
): { ok: true; value: CredentialsInput } | { ok: false; errors: CredentialsErrors } {
  const keyId = input.keyId.trim();
  const secret = input.secret.trim();
  const errors: CredentialsErrors = {};
  const check = (value: string, name: string): string | undefined => {
    if (value === "") return `${name}を入れてください`;
    if (!CREDENTIAL_PATTERN.test(value)) {
      return `${name}は英字と数字だけの 16 から 64 文字です。空白や記号が入っていないか確かめてください`;
    }
    return undefined;
  };
  const keyIdError = check(keyId, "キー ID ");
  const secretError = check(secret, "シークレット");
  if (keyIdError) errors.keyId = keyIdError;
  if (secretError) errors.secret = secretError;
  if (keyIdError || secretError) return { ok: false, errors };
  return { ok: true, value: { keyId, secret } };
}

/** 画面に出す、キー ID の末尾4文字(AC-006-03)。シークレットは1文字も出さない */
export function keyIdLast4(keyId: string): string {
  return keyId.slice(-4);
}
