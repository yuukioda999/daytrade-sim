/**
 * 米国東部時間(America/New_York)と UTC の変換。
 * 夏時間の切り替えは実行環境のタイムゾーンのデータに任せ、自前で計算しない(SPEC-001)。
 */
export const MARKET_TIME_ZONE = "America/New_York";

const offsetFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: MARKET_TIME_ZONE,
  timeZoneName: "longOffset",
});

const partsFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: MARKET_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

/** その瞬間の、UTC からのずれ(分)。冬時間は -300、夏時間は -240。 */
export function easternOffsetMinutes(instant: Date): number {
  const name = offsetFormat.formatToParts(instant).find((p) => p.type === "timeZoneName")?.value;
  const m = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name ?? "");
  if (!m) throw new Error(`タイムゾーンのずれを読み取れない: ${name}`);
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -minutes : minutes;
}

export function isDaylightSaving(instant: Date): boolean {
  return easternOffsetMinutes(instant) === -240;
}

export type EasternParts = {
  /** YYYY-MM-DD */
  date: string;
  hour: number;
  minute: number;
  second: number;
  /** 0 = 日曜 から 6 = 土曜 */
  weekday: number;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function toEastern(instant: Date): EasternParts {
  const p = Object.fromEntries(partsFormat.formatToParts(instant).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
    weekday: WEEKDAYS.indexOf(p.weekday),
  };
}

/** 米国東部時間の暦日と時刻から、その瞬間(UTC)を求める。 */
export function fromEastern(date: string, hour: number, minute: number): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`YYYY-MM-DD 形式ではない日付: ${date}`);
  const asUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, minute);
  // ずれを一度当てて、その瞬間のずれでもう一度合わせる(切り替わりの日の取引時間でも正しくなる)
  const first = asUtc - easternOffsetMinutes(new Date(asUtc)) * 60_000;
  return new Date(asUtc - easternOffsetMinutes(new Date(first)) * 60_000);
}

/** 米国東部時間の暦日の曜日(0 = 日曜)。 */
export function weekdayOf(date: string): number {
  return toEastern(fromEastern(date, 12, 0)).weekday;
}
