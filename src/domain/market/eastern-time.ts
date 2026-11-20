/**
 * 米国東部時間(America/New_York)と UTC の変換。
 * 夏時間の切り替えは実行環境のタイムゾーンのデータに任せ、自前で計算しない(SPEC-001)。
 */
export const MARKET_TIME_ZONE = "America/New_York";

let offsetFormat: Intl.DateTimeFormat | undefined;
let partsFormat: Intl.DateTimeFormat | undefined;

// Intl は使う時に作る。対応していない環境では、読み込み時ではなく呼んだ時にエラーになる
function getOffsetFormat(): Intl.DateTimeFormat {
  offsetFormat ??= new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TIME_ZONE,
    timeZoneName: "longOffset",
  });
  return offsetFormat;
}

function getPartsFormat(): Intl.DateTimeFormat {
  partsFormat ??= new Intl.DateTimeFormat("en-CA", {
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
  return partsFormat;
}

const HOUR_MS = 3_600_000;
/** ずれの覚え書き(UTC の1時間ごと)。上限を超えたら捨てて作り直す */
const offsetCache = new Map<number, number>();
const OFFSET_CACHE_LIMIT = 100_000;

/**
 * その瞬間の、UTC からのずれ(分)。冬時間は -300、夏時間は -240。
 * 米国の夏時間の切り替えは現地の午前2時(UTC のちょうどの時刻)に起きるので、UTC の1時間の中ではずれは変わらない。
 * そのため UTC の1時間ごとに覚えておく(過去データで試す時に何万回も呼ぶため。T11 で測って 6秒のうち 4秒がここだった)
 */
export function easternOffsetMinutes(instant: Date): number {
  const hourKey = Math.floor(instant.getTime() / HOUR_MS);
  const cached = offsetCache.get(hourKey);
  if (cached !== undefined) return cached;
  const minutes = readOffsetMinutes(new Date(hourKey * HOUR_MS));
  if (offsetCache.size >= OFFSET_CACHE_LIMIT) offsetCache.clear();
  offsetCache.set(hourKey, minutes);
  return minutes;
}

function readOffsetMinutes(instant: Date): number {
  const name = getOffsetFormat()
    .formatToParts(instant)
    .find((p) => p.type === "timeZoneName")?.value;
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

function weekdayIndex(name: string | undefined): number {
  const i = WEEKDAYS.indexOf(name ?? "");
  // 読み取れない時に平日として扱うと、休みの日を開いていると誤るので止める
  if (i < 0) throw new Error(`曜日を読み取れない: ${name}`);
  return i;
}

export function toEastern(instant: Date): EasternParts {
  // ずれを当てた時刻を UTC として読む(Intl で毎回分解するより速い。ずれは Intl で読んだ値)
  const local = new Date(instant.getTime() + easternOffsetMinutes(instant) * 60_000);
  if (Number.isNaN(local.getTime())) throw new Error("時刻が正しくありません");
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    second: local.getUTCSeconds(),
    weekday: local.getUTCDay(),
  };
}

/** Intl で分解した米国東部時間(toEastern の速い計算と同じ結果になることを、テストで確かめるため) */
export function toEasternByIntl(instant: Date): EasternParts {
  const p = Object.fromEntries(getPartsFormat().formatToParts(instant).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
    weekday: weekdayIndex(p.weekday),
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
