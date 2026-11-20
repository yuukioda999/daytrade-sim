import { toEastern } from "@/domain/market/eastern-time";
import {
  DEFAULT_FX_RATE_X100,
  DEFAULT_PRINCIPAL_JPY,
  fixedLimitsJpy,
  fxRateFromX100,
  keyIdLast4,
  moneySettingsOn,
  parseFxRate,
  parsePrincipal,
  scheduleMoneyChange,
  validateCredentials,
  type CredentialsErrors,
  type CredentialsInput,
} from "@/domain/settings/settings";
import type { Repositories } from "./ports";

/** 自動売買の ON / OFF を、まだ保存していない時の値(ワイヤーフレームのとおり ON) */
const DEFAULT_AUTO_TRADING_ENABLED = true;

export type MoneyView = {
  principalJpy: number;
  fxRate: number;
  /** この値を使い始めた日。まだ一度も保存していない(既定の値)なら null */
  effectiveDate: string | null;
};

/**
 * 設定の画面と API に返す値。接続用キーは、設定済みかどうかとキー ID の末尾4文字だけ(AC-006-03、04)。
 * シークレットとキー ID の全文は、この型に入れない。
 */
export type SettingsView = {
  autoTrading: {
    enabled: boolean;
    /** 自動売買ができない理由。できる状態なら null(AC-006-06) */
    blockedReason: string | null;
  };
  money: {
    current: MoneyView;
    /** 次の取引日から使う予定の値(AC-006-15)。なければ null */
    scheduled: MoneyView | null;
  };
  /** 今の元手から決まる、変えられない値(AC-006-02) */
  limits: { budgetJpy: number; dailyLossLimitJpy: number };
  credentials: { configured: boolean; keyIdLast4: string | null };
};

export const BLOCKED_NO_CREDENTIALS =
  "市場データの接続用キーが未設定のため、データを取れません。自動売買は止まっています";
export const BLOCKED_TURNED_OFF = "自動売買は OFF です。新しい買いはしません";

function todayEastern(now: Date): string {
  return toEastern(now).date;
}

export function getSettingsView(repos: Repositories, now: Date): SettingsView {
  const today = todayEastern(now);
  const history = repos.settings.listMoneySettings();
  const current = moneySettingsOn(history, today);
  const upcoming = history.filter((h) => h.effectiveDate > today);
  const scheduled = upcoming.length > 0 ? upcoming[upcoming.length - 1] : null;

  const currentView: MoneyView = current
    ? { principalJpy: current.principalJpy, fxRate: fxRateFromX100(current.fxRateX100), effectiveDate: current.effectiveDate }
    : { principalJpy: DEFAULT_PRINCIPAL_JPY, fxRate: fxRateFromX100(DEFAULT_FX_RATE_X100), effectiveDate: null };

  const enabled = repos.settings.getAutoTradingEnabled() ?? DEFAULT_AUTO_TRADING_ENABLED;
  const creds = repos.credentials.get();
  const blockedReason = !enabled ? BLOCKED_TURNED_OFF : creds === null ? BLOCKED_NO_CREDENTIALS : null;

  return {
    autoTrading: { enabled, blockedReason },
    money: {
      current: currentView,
      scheduled: scheduled
        ? {
            principalJpy: scheduled.principalJpy,
            fxRate: fxRateFromX100(scheduled.fxRateX100),
            effectiveDate: scheduled.effectiveDate,
          }
        : null,
    },
    limits: fixedLimitsJpy(currentView.principalJpy),
    credentials: { configured: creds !== null, keyIdLast4: creds ? keyIdLast4(creds.keyId) : null },
  };
}

export type MoneyErrors = { principal?: string; fxRate?: string };

/** 元手と為替レートを保存する(AC-006-13、14、15)。どちらかが違えば、どちらも保存しない */
export function updateMoney(
  repos: Repositories,
  input: { principal: string; fxRate: string },
  now: Date,
): { ok: true; view: SettingsView } | { ok: false; errors: MoneyErrors } {
  const principal = parsePrincipal(input.principal);
  const fxRate = parseFxRate(input.fxRate);
  if (!principal.ok || !fxRate.ok) {
    const errors: MoneyErrors = {};
    if (!principal.ok) errors.principal = principal.error;
    if (!fxRate.ok) errors.fxRate = fxRate.error;
    return { ok: false, errors };
  }
  const change = scheduleMoneyChange(
    repos.settings.listMoneySettings(),
    { principalJpy: principal.value, fxRateX100: fxRate.value },
    todayEastern(now),
  );
  repos.settings.putMoneySettings(change);
  return { ok: true, view: getSettingsView(repos, now) };
}

/** 自動売買の ON / OFF を保存する。OFF の時に新しく買わないふるまいは、自動売買のプロセス(T9)で行う(AC-006-01) */
export function setAutoTrading(repos: Repositories, enabled: boolean, now: Date): SettingsView {
  repos.settings.setAutoTradingEnabled(enabled);
  return getSettingsView(repos, now);
}

/** 接続用キーを保存する(AC-006-03、08)。形式が違えば保存しない */
export function saveCredentials(
  repos: Repositories,
  input: CredentialsInput,
  now: Date,
): { ok: true; view: SettingsView } | { ok: false; errors: CredentialsErrors } {
  const result = validateCredentials(input);
  if (!result.ok) return { ok: false, errors: result.errors };
  repos.credentials.save(result.value);
  return { ok: true, view: getSettingsView(repos, now) };
}

/** 接続用キーを消す(AC-006-06) */
export function deleteCredentials(repos: Repositories, now: Date): SettingsView {
  repos.credentials.delete();
  return getSettingsView(repos, now);
}
