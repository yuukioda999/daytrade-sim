import type { DashboardView, SymbolView, TradeView } from "@/application/dashboard-service";
import { VOLUME_SURGE_RATIO } from "@/domain/signal/buy-signal";
import { roundYen } from "@/domain/trading/round-yen";

/** 上げ下げの向き。色だけでなく ▲▼ と符号でも示す(AC-007-06) */
export type Tone = "up" | "down" | "flat";
export type Signed = { text: string; tone: Tone };

const jpy = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 });

/** $78.45(ドルは小数2桁) */
export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** 株数は小数4桁(SPEC-003 定義 2) */
export function formatShares(value: number): string {
  return `${value.toFixed(4)}株`;
}

function signed(rounded: number, body: (abs: number) => string): Signed {
  if (rounded > 0) return { text: `▲ +${body(rounded)}`, tone: "up" };
  if (rounded < 0) return { text: `▼ -${body(-rounded)}`, tone: "down" };
  return { text: `± ${body(0)}`, tone: "flat" };
}

/** 0.0142 を「▲ +1.42%」にする。小数2桁に丸めて 0 なら「± 0.00%」 */
export function formatSignedRatio(ratio: number): Signed {
  const rounded = Math.round(ratio * 10_000) / 100;
  return signed(rounded, (abs) => `${abs.toFixed(2)}%`);
}

/** -86.022 を「▼ -86円」にする。1円未満は SPEC-003 定義 7 のとおり四捨五入する */
export function formatSignedJpy(value: number): Signed {
  return signed(roundYen(value), (abs) => `${jpy.format(abs)}円`);
}

const easternTime = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
});

/** 時刻を米国東部時間の「09:50」にする */
export function formatEasternTime(iso: string): string {
  return easternTime.format(new Date(iso));
}

/** 監視リストの状態(AC-007-11) */
export function statusLabel(s: Pick<SymbolView, "status" | "met">): { text: string; kind: "holding" | "sold" | "watching" } {
  if (s.status === "holding") return { text: "買いサイン・保有中", kind: "holding" };
  if (s.status === "sold") return { text: "売り終わり", kind: "sold" };
  return { text: `条件 ${s.met}/3 達成`, kind: "watching" };
}

export type ConditionRow = { label: string; term: string; detail: string; met: boolean };

/** 3つの条件の達成状況(SPEC-002 AC-002-07)。画面の言葉を主にして、専門用語を添える(AC-007-07) */
export function conditionRows(s: SymbolView): ConditionRow[] {
  const c = s.conditions;
  return [
    {
      label: "朝の高値超え",
      term: "ORB",
      detail: s.orbHigh === null ? "取引開始から15分たつと決まります" : `朝の高値 ${formatUsd(s.orbHigh)}`,
      met: c?.orbBreakout ?? false,
    },
    {
      label: "今日の平均価格より上",
      term: "VWAP",
      detail: s.vwap === null ? "まだ計算できません" : `平均 ${formatUsd(s.vwap)}`,
      met: c?.aboveVwap ?? false,
    },
    {
      label: `取引量が${VOLUME_SURGE_RATIO}倍以上`,
      term: "出来高急増",
      detail: s.volumeRatio === null ? "比べる過去の日がありません" : `今 ${s.volumeRatio.toFixed(1)}倍`,
      met: c?.volumeSurge ?? false,
    },
  ];
}

/** チャートの要点を文字で出す(AC-007-14) */
export function chartSummary(s: SymbolView): string {
  if (s.bars.length === 0) return `${s.symbol} の今日の値動きはまだ届いていません。`;
  const parts: string[] = [];
  parts.push(s.orbHigh === null ? "朝の高値は取引開始から15分たつと決まります" : `朝の高値は ${formatUsd(s.orbHigh)}`);
  if (s.vwap !== null) parts.push(`今日の平均価格は ${formatUsd(s.vwap)}`);
  const breakout =
    s.breakoutTime === null
      ? s.orbHigh === null
        ? ""
        : "まだ朝の高値を超えていません"
      : `米国東部 ${formatEasternTime(s.breakoutTime)} に朝の高値を超えました`;
  return `${s.symbol}: ${parts.join("、")}。${breakout ? `${breakout}。` : ""}`;
}

/** 売った理由(AC-007-19) */
export function exitReasonLabel(reason: "stop" | "trailing" | "close"): string {
  if (reason === "stop") return "損切りの価格に達した";
  if (reason === "trailing") return "利益を守る売りの目安に達した";
  return "取引終了で売った";
}

/** 一番新しい買い(AC-007-15 のカード)。同じ時刻に買った銘柄が複数あれば、まだ持っている銘柄を選ぶ。なければ null */
export function latestTrade(trades: readonly TradeView[]): TradeView | null {
  const newer = (t: TradeView, a: TradeView) =>
    t.entryTime > a.entryTime || (t.entryTime === a.entryTime && t.exit === null && a.exit !== null);
  return trades.reduce<TradeView | null>((a, t) => (a === null || newer(t, a) ? t : a), null);
}

export type WorkerNotice = { tone: "ok" | "warn" | "error"; title: string; detail: string | null };

/** 自動売買のプロセスの様子(AC-007-08、09、10) */
export function workerNotice(v: DashboardView, formatTime: (iso: string) => string): WorkerNotice {
  const w = v.worker;
  if (w.state === "never-started") return { tone: "error", title: w.message, detail: null };
  if (w.stopped) {
    return {
      tone: "error",
      title: "自動売買が止まっています",
      detail: w.heartbeatAt ? `最後に動いていた時刻: ${formatTime(w.heartbeatAt)}` : null,
    };
  }
  const received = w.lastBarReceivedAt
    ? `データは15分遅れです。最後にデータを受け取った時刻: ${formatTime(w.lastBarReceivedAt)}`
    : "データは15分遅れです。今日はまだデータを受け取っていません";
  if (w.state === "running") return { tone: "ok", title: "自動売買は動いています", detail: received };
  if (w.state === "data-error" || w.state === "calendar-outdated" || w.state === "no-credentials") {
    return { tone: "error", title: w.message, detail: received };
  }
  return { tone: "warn", title: w.message, detail: received };
}
