import { describe, expect, it } from "vitest";
import type { DashboardView, SymbolView, TradeView } from "@/application/dashboard-service";
import {
  chartSummary,
  conditionRows,
  exitReasonLabel,
  formatEasternTime,
  formatShares,
  formatSignedJpy,
  formatSignedRatio,
  formatUsd,
  latestTrade,
  lossLimitPercent,
  statusLabel,
  workerNotice,
} from "./dashboard-model";

const symbol = (over: Partial<SymbolView> = {}): SymbolView => ({
  symbol: "SOXL",
  bars: [{ time: "2026-11-02T14:30:00.000Z", open: 1, high: 1, low: 1, close: 1, volume: 1 }],
  vwapLine: [],
  lastPrice: 78.5,
  previousClose: 70,
  changeRatio: 0.1214,
  conditions: { orbBreakout: true, aboveVwap: true, volumeSurge: false },
  met: 2,
  orbHigh: 77.9,
  orbLow: 77.1,
  vwap: 77.758,
  volumeRatio: 1.2345,
  breakoutTime: "2026-11-02T14:45:00.000Z",
  status: "watching",
  ...over,
});

describe("上げ下げの表示(AC-007-06)", () => {
  it("上げは ▲ と +、下げは ▼ と -、0 は ± で示す", () => {
    expect(formatSignedRatio(0.0142)).toEqual({ text: "▲ +1.42%", tone: "up" });
    expect(formatSignedRatio(-0.012)).toEqual({ text: "▼ -1.20%", tone: "down" });
    expect(formatSignedRatio(0)).toEqual({ text: "± 0.00%", tone: "flat" });
  });

  it("境界: 小数2桁に丸めて 0 になる変化は ± にする", () => {
    expect(formatSignedRatio(0.00004)).toEqual({ text: "± 0.00%", tone: "flat" });
    expect(formatSignedRatio(-0.00004)).toEqual({ text: "± 0.00%", tone: "flat" });
    expect(formatSignedRatio(0.00005).tone).toBe("up");
  });

  it("円は1円未満を四捨五入してから符号を決める(SPEC-003 定義 7)", () => {
    expect(formatSignedJpy(-86.022)).toEqual({ text: "▼ -86円", tone: "down" });
    expect(formatSignedJpy(3.186)).toEqual({ text: "▲ +3円", tone: "up" });
    expect(formatSignedJpy(1234.5)).toEqual({ text: "▲ +1,235円", tone: "up" });
    expect(formatSignedJpy(0.4)).toEqual({ text: "± 0円", tone: "flat" });
  });
});

describe("値の形", () => {
  it("ドルは小数2桁、株数は小数4桁、時刻は米国東部時間", () => {
    expect(formatUsd(78.45)).toBe("$78.45");
    expect(formatUsd(77.1)).toBe("$77.10");
    expect(formatShares(0.4248)).toBe("0.4248株");
    // 冬時間(UTC-5)と夏時間(UTC-4)
    expect(formatEasternTime("2026-11-02T14:50:00.000Z")).toBe("09:50");
    expect(formatEasternTime("2026-07-01T13:50:00.000Z")).toBe("09:50");
  });
});

describe("監視リスト(AC-007-11、07)", () => {
  it("状態: 条件 x/3、買いサイン・保有中、売り終わり", () => {
    expect(statusLabel({ status: "watching", met: 2 }).text).toBe("条件 2/3 達成");
    expect(statusLabel({ status: "holding", met: 3 }).text).toBe("買いサイン・保有中");
    expect(statusLabel({ status: "sold", met: 1 }).text).toBe("売り終わり");
  });

  it("AC-002-07: 3つの条件を普通の言葉で出し、専門用語を添える", () => {
    const rows = conditionRows(symbol());
    expect(rows.map((r) => [r.label, r.term, r.met])).toEqual([
      ["朝の高値超え", "ORB", true],
      ["今日の平均価格より上", "VWAP", true],
      ["取引量の増加", "出来高急増", false],
    ]);
    expect(rows.map((r) => r.detail)).toEqual(["朝の高値 $77.90(超えています)", "平均 $77.76", "1.5倍以上で達成。今 1.23倍"]);
  });

  it("AC-002-07: 朝の高値を超えていなければ、残りの値幅を出す(等しい時は あと $0.00)", () => {
    const below = { conditions: { orbBreakout: false, aboveVwap: true, volumeSurge: false } };
    expect(conditionRows(symbol({ ...below, lastPrice: 77.2 }))[0].detail).toBe("朝の高値 $77.90 まで あと $0.70");
    expect(conditionRows(symbol({ ...below, lastPrice: 77.9 }))[0].detail).toBe("朝の高値 $77.90 まで あと $0.00");
  });

  it("AC-002-07: 取引量の倍率は小数2桁で切り捨てる(1.4998倍を 1.50倍と出さない)", () => {
    expect(conditionRows(symbol({ volumeRatio: 1.4998 }))[2].detail).toBe("1.5倍以上で達成。今 1.49倍");
    expect(conditionRows(symbol({ volumeRatio: 1.5 }))[2].detail).toBe("1.5倍以上で達成。今 1.50倍");
  });

  it("まだ計算できない値は、計算できない理由を出す", () => {
    const rows = conditionRows(symbol({ conditions: null, orbHigh: null, vwap: null, volumeRatio: null }));
    expect(rows.every((r) => !r.met)).toBe(true);
    expect(rows.map((r) => r.detail)).toEqual(["取引開始から15分たつと決まります", "まだ計算できません", "比べる過去の日がありません"]);
  });
});

describe("損失の上限の使用割合(AC-007-16、17)", () => {
  it("0%、途中、上限の手前は切り捨て、上限に達したら 100%", () => {
    expect(lossLimitPercent(0, false)).toBe(0);
    expect(lossLimitPercent(0.086022, false)).toBe(8);
    expect(lossLimitPercent(0.999, false)).toBe(99);
    expect(lossLimitPercent(0.995, false)).toBe(99);
    expect(lossLimitPercent(1, true)).toBe(100);
  });
});

describe("チャートの要点(AC-007-14)", () => {
  it("朝の高値、今日の平均価格、高値を超えた時刻を文字で出す", () => {
    expect(chartSummary(symbol())).toBe("SOXL: 朝の高値は $77.90、今日の平均価格は $77.76。米国東部 09:45 に朝の高値を超えました。");
  });

  it("まだ超えていない時と、足がない時", () => {
    expect(chartSummary(symbol({ breakoutTime: null }))).toContain("まだ朝の高値を超えていません");
    expect(chartSummary(symbol({ bars: [] }))).toBe("SOXL の今日の値動きはまだ届いていません。");
    expect(chartSummary(symbol({ orbHigh: null, breakoutTime: null }))).toBe(
      "SOXL: 朝の高値は取引開始から15分たつと決まります、今日の平均価格は $77.76。",
    );
  });
});

describe("売買の記録(AC-007-15、19)", () => {
  const trade = (symbol: string, entryTime: string): TradeView => ({
    symbol,
    signalTime: entryTime,
    entryTime,
    entryPrice: 1,
    shares: 1,
    costJpy: 150,
    stopPrice: 1,
    exit: null,
    late: false,
  });

  it("売った理由を普通の言葉で出す", () => {
    expect(exitReasonLabel("stop")).toBe("損切りの価格に達した");
    expect(exitReasonLabel("trailing")).toBe("利益を守る売りの目安に達した");
    expect(exitReasonLabel("close")).toBe("取引終了で売った");
  });

  it("一番新しい買いを選ぶ。なければ null", () => {
    expect(latestTrade([])).toBeNull();
    const a = trade("SOXL", "2026-11-02T14:50:00.000Z");
    const b = trade("TQQQ", "2026-11-02T15:05:00.000Z");
    expect(latestTrade([b, a])?.symbol).toBe("TQQQ");
  });

  it("同じ時刻に買った銘柄が複数あれば、まだ持っている銘柄を選ぶ", () => {
    const t = "2026-11-02T14:50:00.000Z";
    const sold = { ...trade("SOXL", t), exit: { time: t, price: 1, reason: "stop" as const, pnlJpy: -1 } };
    const holding = trade("TQQQ", t);
    expect(latestTrade([sold, holding])?.symbol).toBe("TQQQ");
    expect(latestTrade([holding, sold])?.symbol).toBe("TQQQ");
  });
});

describe("自動売買のプロセスの様子(AC-007-08、09、10)", () => {
  const base = (worker: Partial<DashboardView["worker"]>): DashboardView =>
    ({
      worker: { state: "running", message: "動いています", stopped: false, heartbeatAt: "h", lastBarReceivedAt: "r", ...worker },
    }) as DashboardView;
  const fmt = (iso: string) => `[${iso}]`;

  it("AC-007-08: 動いている時は「15分遅れ」と最後にデータを受け取った時刻", () => {
    expect(workerNotice(base({}), fmt)).toEqual({
      tone: "ok",
      title: "自動売買は動いています",
      detail: "データは15分遅れです。最後にデータを受け取った時刻: [r]",
    });
  });

  it("AC-007-09: 止まっている時は「自動売買が止まっています」と最後に動いていた時刻", () => {
    expect(workerNotice(base({ stopped: true }), fmt)).toEqual({
      tone: "error",
      title: "自動売買が止まっています",
      detail: "最後に動いていた時刻: [h]",
    });
  });

  it("AC-007-10: データを取れない時は、その言葉をそのまま出す", () => {
    const msg = "データを取得できていません。練習売買はしていません(接続用キー)";
    expect(workerNotice(base({ state: "data-error", message: msg }), fmt)).toMatchObject({ tone: "error", title: msg });
  });
});
