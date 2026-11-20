import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bar } from "@/domain/market/bar";
import { fromEastern } from "@/domain/market/eastern-time";
import { sessionOn } from "@/domain/market/market-calendar";
import type { CredentialsInput } from "@/domain/settings/settings";
import { memoryRepositories } from "@/infrastructure/memory/memory-repositories";
import { MarketDataError, type MarketDataSource, type Repositories, type SymbolBar } from "./ports";
import { BLOCKED_NO_CREDENTIALS } from "./settings-service";
import { newWorkerMemory, runTick, WORKER_MESSAGES, type WorkerMemory } from "./worker-service";

const CREDS = { keyId: "PKTESTKEY0000000ABCD", secret: "TestSecret000000000000000000000000000Zq9X" };
const DATE = "2026-11-02"; // 月曜、冬時間
const et = (hh: number, mm: number, date = DATE) => fromEastern(date, hh, mm);

function bar(symbol: string, date: string, hh: number, mm: number, o: number, h: number, l: number, c: number, v = 100, vw?: number): SymbolBar {
  return { symbol, start: et(hh, mm, date), open: o, high: h, low: l, close: c, volume: v, vwap: vw };
}

// SPEC-002 例1 と SPEC-003 例1、例2: 09:45 に買いサイン、09:50 に 78.45 で買い、09:55 に 77.10 で損切り
const SOXL_DAY: SymbolBar[] = [
  bar("SOXL", DATE, 9, 30, 77.5, 77.7, 77.1, 77.55, 100, 77.4),
  bar("SOXL", DATE, 9, 35, 77.55, 77.9, 77.4, 77.6, 70, 77.65),
  bar("SOXL", DATE, 9, 40, 77.6, 77.85, 77.35, 77.45, 55, 77.6),
  bar("SOXL", DATE, 9, 45, 77.45, 78.05, 77.7, 78.0, 120, 77.9),
  bar("SOXL", DATE, 9, 50, 78.45, 78.6, 78.2, 78.5, 100),
  bar("SOXL", DATE, 9, 55, 77.5, 77.6, 77.0, 77.2, 100),
];

/** 過去の取引日の足(どの時刻も取引量 60。取引量の基準が 60 になる) */
function pastDayBars(symbol: string, date: string): SymbolBar[] {
  const s = sessionOn(date);
  if (!s) return [];
  const bars: SymbolBar[] = [];
  for (let t = s.open.getTime(); t < s.close.getTime(); t += 5 * 60_000) {
    bars.push({ symbol, start: new Date(t), open: 70, high: 70, low: 70, close: 70, volume: 60 });
  }
  return bars;
}

/** 決めた足を返すテスト用の取得元。頼まれた期間の足だけを返す */
class ScriptedSource implements MarketDataSource {
  readonly isTestSource = true;
  fail: MarketDataError | null = null;
  readonly calls: { symbol: string; start: Date; end: Date }[] = [];
  constructor(private readonly today: Record<string, Bar[]>) {}
  async fetchBars(_c: CredentialsInput, symbol: string, start: Date, end: Date): Promise<SymbolBar[]> {
    this.calls.push({ symbol, start, end });
    if (this.fail) throw this.fail;
    const all: SymbolBar[] = [];
    for (let t = start.getTime(); t < end.getTime(); t += 86_400_000) {
      const date = new Date(t - 5 * 3_600_000).toISOString().slice(0, 10);
      if (date === DATE) all.push(...(this.today[symbol] ?? []).map((b) => ({ ...b, symbol })));
      else all.push(...pastDayBars(symbol, date));
    }
    return all.filter((b) => b.start >= start && b.start < end);
  }
  async latestBar(): Promise<SymbolBar | null> {
    return null;
  }
}

let clock: Date;
let repos: Repositories;
let source: ScriptedSource;
let memory: WorkerMemory;

beforeEach(() => {
  clock = et(9, 0);
  repos = memoryRepositories(() => clock);
  source = new ScriptedSource({ SOXL: SOXL_DAY });
  memory = newWorkerMemory();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function tickAt(time: Date) {
  clock = time;
  await runTick({ repos, source }, memory, time);
}

async function tickEveryMinute(from: Date, to: Date) {
  for (let t = from.getTime(); t <= to.getTime(); t += 60_000) await tickAt(new Date(t));
}

const status = () => repos.trading.getWorkerStatus();

describe("ワーカーの様子(画面に出す言葉)", () => {
  it("AC-001-12: 休場日の表にない年は動かず、「休場日の表が古い」と出す", async () => {
    repos.credentials.save(CREDS);
    await tickAt(new Date("2030-01-07T15:00:00Z"));
    expect(status()).toMatchObject({ state: "calendar-outdated", message: WORKER_MESSAGES.calendarOutdated });
    expect(source.calls).toEqual([]);
  });

  it("AC-006-06: 接続用キーがなければ、データを取らずに止まっている理由を出す", async () => {
    await tickAt(et(10, 0));
    expect(status()).toMatchObject({ state: "no-credentials", message: BLOCKED_NO_CREDENTIALS });
    expect(source.calls).toEqual([]);
  });

  it("休みの日と、取引開始の前は通信しない", async () => {
    repos.credentials.save(CREDS);
    await tickAt(et(10, 0, "2026-11-07")); // 土曜
    expect(status()?.message).toBe(WORKER_MESSAGES.closedDay);
    await tickAt(et(9, 29));
    expect(status()?.message).toBe(WORKER_MESSAGES.beforeOpen);
    expect(source.calls).toEqual([]);
  });

  it("AC-007-10: データを取れない時は、取れていないことと、練習売買をしていないことを出す", async () => {
    repos.credentials.save(CREDS);
    source.fail = new MarketDataError("unauthorized", "HTTP 401");
    await tickAt(et(10, 30));
    expect(status()?.state).toBe("data-error");
    expect(status()?.message).toContain("データを取得できていません。練習売買はしていません");
    expect(repos.trading.listTrades(DATE)).toEqual([]);
  });
});

describe("取引時間中の練習売買(ADR-0009)", () => {
  it("1分ごとに動くと、15分遅れで届く足から、SPEC-003 例1、例2 どおりに記録する", async () => {
    repos.credentials.save(CREDS);
    await tickEveryMinute(et(9, 30), et(10, 20));
    const trades = repos.trading.listTrades(DATE);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ symbol: "SOXL", entryPrice: 78.45, shares: 0.4248, stopPrice: 77.1, late: false });
    expect(trades[0].exit).toMatchObject({ price: 77.1, reason: "stop" });
    expect(trades[0].exit?.pnlJpy).toBeCloseTo(-86.022, 6);
    expect(status()).toMatchObject({ state: "running", message: WORKER_MESSAGES.running });
  });

  it("足は、終わりが15分以上前のものだけを取る(足の途中の値を保存しない)", async () => {
    repos.credentials.save(CREDS);
    await tickAt(et(10, 9)); // 09:45 の足(09:50 に終わる)は、10:05 から取れる。09:50 の足はまだ
    const soxl = source.calls.filter((c) => c.symbol === "SOXL" && c.start.getTime() === et(9, 30).getTime());
    expect(soxl.at(-1)?.end).toEqual(et(9, 50));
  });

  it("AC-003-09: 同じ足で何度動いても、記録は1回分", async () => {
    repos.credentials.save(CREDS);
    await tickEveryMinute(et(10, 15), et(10, 25));
    expect(repos.trading.listTrades(DATE)).toHaveLength(1);
  });

  it("AC-003-10: 止まっていた間の足を取り直して順に処理し、同じ記録を作る。あとから処理した印が付く", async () => {
    repos.credentials.save(CREDS);
    await tickAt(et(9, 55));
    await tickAt(et(10, 40)); // 09:45 から 09:55 の足は、ここで初めて届く
    const trades = repos.trading.listTrades(DATE);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ entryPrice: 78.45, shares: 0.4248, late: true });
    expect(trades[0].exit?.pnlJpy).toBeCloseTo(-86.022, 6);
  });

  it("AC-006-01: OFF にした時刻よりあとの足では新しく買わない", async () => {
    repos.credentials.save(CREDS);
    clock = et(9, 47);
    repos.settings.setAutoTradingEnabled(false);
    await tickEveryMinute(et(10, 0), et(10, 20));
    expect(repos.trading.listTrades(DATE)).toEqual([]);
  });

  it("AC-006-15、SPEC-006 決めたこと 6: その日を始める時に、その日の元手と為替を保存する", async () => {
    repos.credentials.save(CREDS);
    await tickAt(et(9, 31));
    expect(repos.settings.listMoneySettings()).toEqual([{ effectiveDate: DATE, principalJpy: 10_000, fxRateX100: 15_000 }]);
    expect(repos.trading.getDayRun(DATE)).toMatchObject({ principalJpy: 10_000, fxRateX100: 15_000, closed: false });
  });

  it("取引量の基準のために、過去20取引日の足を取って「取り終えた日」にする", async () => {
    repos.credentials.save(CREDS);
    await tickAt(et(9, 31));
    expect(repos.bars.fetchedDates("SOXL", "2026-10-01", "2026-11-01")).toHaveLength(20);
    expect(repos.bars.fetchedDates("NVDL", "2026-10-01", "2026-11-01")).toHaveLength(20);
  });
});

describe("その日を締める(SPEC-003 定義 14)", () => {
  // 09:50 に買ったまま、09:55 の足までしか届かない銘柄(最後の足 15:55 が届かない)
  const HELD: SymbolBar[] = [...SOXL_DAY.slice(0, 5), bar("SOXL", DATE, 9, 55, 78.5, 78.8, 78.4, 78.7)];

  it("取引終了から30分たつと、届いた最後の足の終値で売って締め、その日を「取り終えた日」にする", async () => {
    source = new ScriptedSource({ SOXL: HELD });
    repos.credentials.save(CREDS);
    await tickAt(et(15, 0));
    expect(repos.trading.listTrades(DATE)[0].exit).toBeNull();
    await tickAt(et(16, 29));
    expect(repos.trading.listTrades(DATE)[0].exit).toBeNull();
    await tickAt(et(16, 30));
    expect(repos.trading.listTrades(DATE)[0].exit).toMatchObject({ reason: "close", price: 78.7 });
    expect(repos.trading.getDayRun(DATE)?.closed).toBe(true);
    expect(repos.bars.fetchedDates("SOXL", DATE, DATE)).toEqual([DATE]);
    await tickAt(et(16, 40));
    expect(status()?.message).toBe(WORKER_MESSAGES.dayDone);
  });

  it("取引中に止まり、次の日に動いた時は、前の日の残りの足を取り直して締める(印つき)", async () => {
    source = new ScriptedSource({ SOXL: HELD });
    repos.credentials.save(CREDS);
    await tickAt(et(10, 20));
    await tickAt(et(9, 35, "2026-11-03"));
    const trades = repos.trading.listTrades(DATE);
    expect(trades[0].exit).toMatchObject({ reason: "close", price: 78.7 });
    expect(trades[0].late).toBe(true);
    expect(repos.trading.getDayRun(DATE)?.closed).toBe(true);
  });

  it("取引時間が終わってから初めて動いた日は記録しない(SPEC-004、ADR-0009)", async () => {
    repos.credentials.save(CREDS);
    await tickAt(et(17, 0));
    expect(repos.trading.getDayRun(DATE)).toBeNull();
    expect(status()?.message).toBe(WORKER_MESSAGES.dayDone);
  });

  it("AC-003-12: 次の取引日は、前の日の損益を引き継ぎ、今日の損益は0から始める", async () => {
    repos.credentials.save(CREDS);
    await tickAt(et(10, 20)); // 1日目に動く(損益 −86.022)
    await tickAt(et(16, 30)); // 1日目を締める
    await tickAt(et(9, 31, "2026-11-03"));
    expect(repos.trading.getDayRun("2026-11-03")?.startingRealizedJpy).toBeCloseTo(-86.022, 6);
  });
});
