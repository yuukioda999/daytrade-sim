import { roundYen } from "@/domain/trading/round-yen";

const jpy = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 });

/** 12,345円。1円未満は SPEC-003 定義 7 のとおり四捨五入する */
export function formatJpy(value: number): string {
  return `${jpy.format(roundYen(value))}円`;
}

/** 為替レートは小数2桁で出す(150.00) */
export function formatFxRate(value: number): string {
  return value.toFixed(2);
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** "2026-11-23" を「11月23日(月)」にする。暦日なので時刻帯の変換はしない */
export function formatDateJa(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const weekday = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return `${Number(m[2])}月${Number(m[3])}日(${WEEKDAYS[weekday]})`;
}
