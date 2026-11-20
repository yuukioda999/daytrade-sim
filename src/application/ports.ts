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

export type Repositories = {
  settings: SettingsRepository;
  credentials: CredentialsRepository;
};
