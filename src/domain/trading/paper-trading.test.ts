import { describe, expect, it } from "vitest";
import type { Bar } from "@/domain/market/bar";
import { sessionOn } from "@/domain/market/market-calendar";
import { roundYen } from "./round-yen";
import {
  balanceJpy,
  buyingPowerJpy,
  dailyLossLimitReached,
  lossLimitReachedJpy,
  enter,
  exitThreshold,
  isLastBarOfSession,
  newAccount,
  pnlJpy,
  processBar,
  scheduleSettings,
  settleSessionEnd,
  sharesFor,
  startDay,
  type Account,
  type Position,
} from "./paper-trading";

// 2026-11-02(月、冬時間)。為替 150、元手 10,000円(SPEC-003 計算の例の前提)
const DAY = "2026-11-02";
const session = sessionOn(DAY)!;
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 10, 2, h + 5, m));
};
const bar = (hhmm: string, o: number, h: number, l: number, c: number): Bar => ({
  start: at(hhmm),
  open: o,
  high: h,
  low: l,
  close: c,
  volume: 100,
});
const fresh = () => newAccount(10_000, 150, DAY);

/** 練習買いして、買った足の売る判定まで終えた口座を返す */
function bought(entryBar: Bar, stopPrice: number, account: Account = fresh()) {
  const r = enter(account, { session, symbol: "TQQQ", nextBar: entryBar, stopPrice });
  if (r.kind !== "entered") throw new Error(`買えなかった: ${r.reason}`);
  return processBar(r.account, { symbol: "TQQQ", bar: entryBar, isLastBar: false });
}
const pos = (a: Account): Position | undefined => a.positions.find((p) => p.symbol === "TQQQ");

describe("SPEC-003 自動の練習売買", () => {
  it("AC-003-01: 次の足の始値で、例1の株数(0.4248株、4,998.834円)を買う", () => {
    const next = bar("09:50", 78.45, 78.6, 78.3, 78.5);
    const r = enter(fresh(), { session, symbol: "TQQQ", nextBar: next, stopPrice: 77.1 });
    expect(r.kind).toBe("entered");
    if (r.kind !== "entered") return;
    expect(r.position.entryPrice).toBe(78.45);
    expect(r.position.entryTime).toEqual(at("09:50"));
    expect(r.position.shares).toBe(0.4248);
    expect(r.position.shares * 78.45 * 150).toBeCloseTo(4998.834, 6);
    expect(buyingPowerJpy(r.account)).toBeCloseTo(10_000 - 4998.834, 6);
  });

  it("AC-003-02: 例2 安値が損切りの価格に達したら、損切りの価格で売る(-86.022円)", () => {
    const { account } = bought(bar("09:50", 78.45, 78.6, 78.3, 78.5), 77.1);
    const r = processBar(account, { symbol: "TQQQ", bar: bar("09:55", 77.5, 77.6, 77.0, 77.2), isLastBar: false });
    expect(r.closed?.exitPrice).toBe(77.1);
    expect(r.closed?.reason).toBe("stop");
    expect(r.closed?.pnlJpy).toBeCloseTo(-86.022, 6);
    expect(Math.round(r.closed!.pnlJpy)).toBe(-86);
  });

  it("AC-003-03: 例3 始値で損切りの価格を下回っていたら、始値で売る(-98.766円)", () => {
    const { account } = bought(bar("09:50", 78.45, 78.6, 78.3, 78.5), 77.1);
    const r = processBar(account, { symbol: "TQQQ", bar: bar("09:55", 76.9, 77.0, 76.5, 76.8), isLastBar: false });
    expect(r.closed?.exitPrice).toBe(76.9);
    expect(r.closed?.pnlJpy).toBeCloseTo(-98.766, 6);
    expect(Math.round(r.closed!.pnlJpy)).toBe(-99);
  });

  it("AC-003-04: 例4 利益を守る売りの目安(25.996)で売る(199.195円)", () => {
    // 買値 25.00、1.3333株、損切り 24.50
    let { account } = bought(bar("09:50", 25.0, 25.2, 24.9, 25.1), 24.5);
    expect(pos(account)?.shares).toBe(1.3333);
    account = processBar(account, { symbol: "TQQQ", bar: bar("09:55", 25.1, 26.8, 25.0, 26.5), isLastBar: false }).account;
    expect(pos(account)?.peak).toBe(26.8);
    const r = processBar(account, { symbol: "TQQQ", bar: bar("10:00", 26.3, 26.4, 25.9, 26.0), isLastBar: false });
    expect(r.closed?.reason).toBe("trailing");
    expect(r.closed?.exitPrice).toBeCloseTo(25.996, 10);
    expect(r.closed?.pnlJpy).toBeCloseTo(199.195, 3);
    expect(Math.round(r.closed!.pnlJpy)).toBe(199);
  });

  describe("AC-003-05: 境界の例", () => {
    const p = (peak: number): Position => ({
      symbol: "X", entryTime: at("09:50"), entryPrice: 25, shares: 1, stopPrice: 24.5, peak, lastBarStart: at("09:50"),
    });

    it("最高値がちょうど +5%(26.25)なら有効になり、目安は 25.4625", () => {
      const t = exitThreshold(p(26.25));
      expect(t.reason).toBe("trailing");
      expect(t.price).toBeCloseTo(25.4625, 10);
    });

    it("最高値が +5% 未満(26.24)なら有効にならない", () => {
      expect(exitThreshold(p(26.24))).toEqual({ price: 24.5, reason: "stop" });
    });

    it("+5% の境界は、小数の誤差が出る値でも有効になる(1.02 × 1.05 は 1.0710000000000002 と計算される)", () => {
      const q: Position = { ...p(1.071), entryPrice: 1.02, stopPrice: 0.9 };
      expect(exitThreshold(q).reason).toBe("trailing");
    });

    it("目安が有効でも、目安が損切りの価格以下なら、基準は損切りの価格(max)", () => {
      // e=25、s=25.5、m=26.25 で目安 t=25.4625 は s=25.5 より下
      const q: Position = { ...p(26.25), stopPrice: 25.5 };
      expect(exitThreshold(q)).toEqual({ price: 25.5, reason: "stop" });
    });

    it("安値が売りの基準と同じなら売る", () => {
      const { account } = bought(bar("09:50", 78.45, 78.6, 78.3, 78.5), 77.1);
      const r = processBar(account, { symbol: "TQQQ", bar: bar("09:55", 77.5, 77.6, 77.1, 77.3), isLastBar: false });
      expect(r.closed?.exitPrice).toBe(77.1);
    });

    it("今日の損失がちょうど上限(-1,000円)なら、その日は新しく買わない", () => {
      const a = { ...fresh(), realizedTodayJpy: -1000 };
      expect(dailyLossLimitReached(a)).toBe(true);
      expect(enter(a, { session, symbol: "TQQQ", nextBar: bar("10:00", 78, 78, 78, 78), stopPrice: 77 }).kind).toBe("skipped");
    });

    it("損益と元手からの判定も同じ境界(ダッシュボードの AC-007-17)", () => {
      expect(lossLimitReachedJpy(-1000, 10_000)).toBe(true);
      expect(lossLimitReachedJpy(-999, 10_000)).toBe(false);
      expect(lossLimitReachedJpy(0, 10_000)).toBe(false);
      expect(lossLimitReachedJpy(-1500, 10_000)).toBe(true);
    });

    it("今日の損失が上限の手前(-999円)なら、新しく買う", () => {
      const a = { ...fresh(), realizedTodayJpy: -999 };
      expect(dailyLossLimitReached(a)).toBe(false);
      expect(enter(a, { session, symbol: "TQQQ", nextBar: bar("10:00", 78, 78, 78, 78), stopPrice: 77 }).kind).toBe("entered");
    });

    it("買いに使える残りが0円なら、買わない", () => {
      // 残高 10,000円のうち 10,000円ぶん株を持っている
      const holding: Position = { ...p(25), symbol: "SOXL", entryPrice: 50, shares: 10_000 / (50 * 150) };
      const a: Account = { ...fresh(), positions: [holding] };
      expect(buyingPowerJpy(a)).toBeCloseTo(0, 6);
      const r = enter(a, { session, symbol: "TQQQ", nextBar: bar("10:00", 78, 78, 78, 78), stopPrice: 77 });
      expect(r).toMatchObject({ kind: "skipped", reason: "no-buying-power" });
    });

    it("利益0%(売値 = 買値)なら損益は0円", () => {
      expect(pnlJpy(25, 25, 1.3333, 150)).toBe(0);
    });
  });

  it("AC-003-06: 1本の足で最高値の更新と安値の下落が両方起きたら、更新前の最高値で判定する", () => {
    let { account } = bought(bar("09:50", 25.0, 25.2, 24.9, 25.1), 24.5);
    account = processBar(account, { symbol: "TQQQ", bar: bar("09:55", 25.1, 26.8, 25.0, 26.5), isLastBar: false }).account;
    // 更新前の最高値 26.80 の目安は 25.996。安値 26.00 はそれより上なので売らない。
    // 先に 28.00 へ更新してしまうと、目安 27.16 で売ってしまう
    const r = processBar(account, { symbol: "TQQQ", bar: bar("10:00", 26.5, 28.0, 26.0, 27.5), isLastBar: false });
    expect(r.closed).toBeNull();
    expect(pos(r.account)?.peak).toBe(28.0);
  });

  it("AC-003-07: 取引終了まで持っていたら、最後の足(15:55)の終値で売る", () => {
    const last = bar("15:55", 78.6, 78.9, 78.5, 78.8);
    expect(isLastBarOfSession(session, last)).toBe(true);
    expect(isLastBarOfSession(session, bar("15:50", 1, 1, 1, 1))).toBe(false);
    const { account } = bought(bar("09:50", 78.45, 78.6, 78.3, 78.5), 77.1);
    const r = processBar(account, { symbol: "TQQQ", bar: last, isLastBar: true });
    expect(r.closed).toMatchObject({ exitPrice: 78.8, reason: "close" });
    expect(r.account.positions).toHaveLength(0);
  });

  it("AC-003-07: 最後の足で安値が損切りの価格に達したら、取引終了ではなく損切りで売る", () => {
    const { account } = bought(bar("09:50", 78.45, 78.6, 78.3, 78.5), 77.1);
    // 始値 77.50、安値 77.00、終値 78.00。取引終了を先に判定すると 78.00 で売ってしまう
    const r = processBar(account, { symbol: "TQQQ", bar: bar("15:55", 77.5, 78.1, 77.0, 78.0), isLastBar: true });
    expect(r.closed).toMatchObject({ exitPrice: 77.1, reason: "stop" });
  });

  it("AC-003-07: 短縮取引日(2026-11-27)の最後の足は 12:55", () => {
    const early = sessionOn("2026-11-27")!;
    const b: Bar = { start: new Date("2026-11-27T17:55:00Z"), open: 1, high: 1, low: 1, close: 1, volume: 1 };
    expect(isLastBarOfSession(early, b)).toBe(true);
  });

  it("定義 6: 買った足でも売る判定をする(買った足の安値が損切りの価格に達したら、その足で売る)", () => {
    const entryBar = bar("09:50", 78.45, 78.6, 77.0, 77.3);
    const r = enter(fresh(), { session, symbol: "TQQQ", nextBar: entryBar, stopPrice: 77.1 });
    if (r.kind !== "entered") throw new Error("買えなかった");
    const sold = processBar(r.account, { symbol: "TQQQ", bar: entryBar, isLastBar: false });
    expect(sold.closed).toMatchObject({ exitPrice: 77.1, reason: "stop", exitTime: at("09:50") });
  });

  it("AC-003-08: 今日の損失が上限に達したら新しく買わず、持っている株の売りは続ける", () => {
    let { account } = bought(bar("09:50", 78.45, 78.6, 78.3, 78.5), 77.1);
    account = { ...account, realizedTodayJpy: -1000 };
    const r = enter(account, { session, symbol: "SOXL", nextBar: bar("10:00", 25, 25, 25, 25), stopPrice: 24 });
    expect(r).toMatchObject({ kind: "skipped", reason: "daily-loss-limit" });
    const sold = processBar(account, { symbol: "TQQQ", bar: bar("10:00", 77.5, 77.6, 77.0, 77.2), isLastBar: false });
    expect(sold.closed?.reason).toBe("stop");
  });

  it("AC-003-09: 同じ足を2回処理しても、記録は1回だけ", () => {
    const { account } = bought(bar("09:50", 78.45, 78.6, 78.3, 78.5), 77.1);
    const b = bar("09:55", 77.5, 77.6, 77.0, 77.2);
    const first = processBar(account, { symbol: "TQQQ", bar: b, isLastBar: false });
    expect(first.closed).not.toBeNull();
    // 売ったあとの口座に同じ足をもう一度渡しても、2回目の記録はできない
    expect(processBar(first.account, { symbol: "TQQQ", bar: b, isLastBar: false }).closed).toBeNull();
    // 売る前の口座に同じ足をもう一度渡しても、2回目の判定でずれない
    const holdBar = bar("09:55", 78.5, 78.7, 78.4, 78.6);
    const once = processBar(account, { symbol: "TQQQ", bar: holdBar, isLastBar: false });
    const twice = processBar(once.account, { symbol: "TQQQ", bar: holdBar, isLastBar: false });
    expect(twice.closed).toBeNull();
    expect(twice.account).toBe(once.account);
    // 買った足も、買ったあとに1回だけ判定する
    const again = processBar(once.account, { symbol: "TQQQ", bar: bar("09:50", 78.45, 78.6, 70, 78.5), isLastBar: false });
    expect(again.closed).toBeNull();
  });

  it("AC-003-11: 売った理由(損切り、利益を守る売り、取引終了)を記録する", () => {
    const reasons = new Set<string>();
    const a = bought(bar("09:50", 78.45, 78.6, 78.3, 78.5), 77.1).account;
    reasons.add(processBar(a, { symbol: "TQQQ", bar: bar("09:55", 77.5, 77.6, 77.0, 77.2), isLastBar: false }).closed!.reason);
    reasons.add(processBar(a, { symbol: "TQQQ", bar: bar("15:55", 78.6, 78.9, 78.5, 78.8), isLastBar: true }).closed!.reason);
    let b = bought(bar("09:50", 25.0, 25.2, 24.9, 25.1), 24.5).account;
    b = processBar(b, { symbol: "TQQQ", bar: bar("09:55", 25.1, 26.8, 25.0, 26.5), isLastBar: false }).account;
    reasons.add(processBar(b, { symbol: "TQQQ", bar: bar("10:00", 26.3, 26.4, 25.9, 26.0), isLastBar: false }).closed!.reason);
    expect([...reasons].sort()).toEqual(["close", "stop", "trailing"]);
  });

  it("AC-003-12: 次の取引日には、今日の損益は0から始まり、残高は引き継ぐ", () => {
    const { account } = bought(bar("09:50", 78.45, 78.6, 78.3, 78.5), 77.1);
    const sold = processBar(account, { symbol: "TQQQ", bar: bar("09:55", 77.5, 77.6, 77.0, 77.2), isLastBar: false }).account;
    expect(sold.realizedTodayJpy).toBeCloseTo(-86.022, 6);
    const next = startDay(sold, "2026-11-03");
    expect(next.today).toBe("2026-11-03");
    expect(next.realizedTodayJpy).toBe(0);
    expect(balanceJpy(next)).toBeCloseTo(10_000 - 86.022, 6);
    // 売っていない株が残っているのに日を切り替えるのは誤り
    expect(() => startDay(account, "2026-11-03")).toThrow(/売っていない株/);
  });
});

describe("株数の切り捨て", () => {
  it("割り切れる時は、誤差で1つ少なく切り捨てない", () => {
    expect(sharesFor(5000, 50, 100)).toBe(1);
    expect(sharesFor(4500, 0.3, 150)).toBe(100);
  });

  it("小数の誤差で 6.9999株にならず、7株になる(73.5円 / (0.07ドル × 150) は 6.999999999999999 と計算される)", () => {
    expect(sharesFor(73.5, 0.07, 150)).toBe(7);
  });

  it("予算か価格が0以下なら0株", () => {
    expect(sharesFor(0, 78, 150)).toBe(0);
    expect(sharesFor(5000, 0, 150)).toBe(0);
  });
});

describe("1回の買いの予算", () => {
  it("残高が減っても、予算は元手の50%(5,000円)が上限のまま", () => {
    const a = { ...fresh(), realizedTotalJpy: -2000 };
    const r = enter(a, { session, symbol: "TQQQ", nextBar: bar("10:00", 50, 50, 50, 50), stopPrice: 49 });
    if (r.kind !== "entered") throw new Error("買えなかった");
    expect(r.position.shares).toBe(sharesFor(5000, 50, 150));
  });

  it("買いに使える残りが 5,000円より少なければ、その残りで買う", () => {
    const holding: Position = {
      symbol: "SOXL", entryTime: at("09:50"), entryPrice: 50, shares: 7000 / (50 * 150), stopPrice: 49, peak: 50, lastBarStart: at("09:50"),
    };
    const a: Account = { ...fresh(), positions: [holding] };
    const r = enter(a, { session, symbol: "TQQQ", nextBar: bar("10:00", 50, 50, 50, 50), stopPrice: 49 });
    if (r.kind !== "entered") throw new Error("買えなかった");
    expect(r.position.shares).toBe(sharesFor(3000, 50, 150));
  });
});

describe("SPEC-003 決めたこと(2026-11-19、PR #4 のレビューで追記)", () => {
  it("AC-003-05: 買う足が新しい買いの締め切り(15:30)以降に始まるなら買わない(定義 1)", () => {
    // 15:25 の足で買いサインが出ると、買う足は 15:30
    const r = enter(fresh(), { session, symbol: "TQQQ", nextBar: bar("15:30", 78, 78, 78, 78), stopPrice: 77 });
    expect(r).toMatchObject({ kind: "skipped", reason: "after-entry-cutoff" });
    const ok = enter(fresh(), { session, symbol: "TQQQ", nextBar: bar("15:25", 78, 78, 78, 78), stopPrice: 77 });
    expect(ok.kind).toBe("entered");
  });

  it("AC-003-05: 短縮取引日(2026-11-27)は 12:30 に始まる足では買わない(定義 1)", () => {
    const early = sessionOn("2026-11-27")!;
    const b = (iso: string): Bar => ({ start: new Date(iso), open: 78, high: 78, low: 78, close: 78, volume: 1 });
    expect(enter(fresh(), { session: early, symbol: "TQQQ", nextBar: b("2026-11-27T17:30:00Z"), stopPrice: 77 }).kind).toBe("skipped");
    expect(enter(fresh(), { session: early, symbol: "TQQQ", nextBar: b("2026-11-27T17:25:00Z"), stopPrice: 77 }).kind).toBe("entered");
  });

  it("AC-003-05: 買値が損切りの価格以下なら買わない(同じ値も買わない。定義 4)", () => {
    const below = enter(fresh(), { session, symbol: "TQQQ", nextBar: bar("09:50", 77.0, 77.2, 76.9, 77.1), stopPrice: 77.1 });
    expect(below).toMatchObject({ kind: "skipped", reason: "entry-at-or-below-stop" });
    const equal = enter(fresh(), { session, symbol: "TQQQ", nextBar: bar("09:50", 77.1, 77.2, 77.0, 77.1), stopPrice: 77.1 });
    expect(equal).toMatchObject({ kind: "skipped", reason: "entry-at-or-below-stop" });
  });

  it("AC-003-05: 最後の足が届かなかった時は、その日に届いた最後の足の終値で売る(定義 14)", () => {
    let { account } = bought(bar("09:50", 78.45, 78.6, 78.3, 78.5), 77.1);
    const lastReceived = bar("15:45", 78.5, 78.7, 78.4, 78.6);
    account = processBar(account, { symbol: "TQQQ", bar: lastReceived, isLastBar: false }).account;
    // 15:50 と 15:55 の足が届かないまま取引時間が終わった
    const r = settleSessionEnd(account, { symbol: "TQQQ", lastReceivedBar: lastReceived });
    expect(r.closed).toMatchObject({ exitPrice: 78.6, reason: "close", exitTime: at("15:45") });
    // 損益 = (78.60 - 78.45) × 0.4248 × 150 = 9.558円
    expect(r.closed?.pnlJpy).toBeCloseTo(9.558, 6);
    expect(r.account.realizedTodayJpy).toBeCloseTo(9.558, 6);
    expect(r.account.realizedTotalJpy).toBeCloseTo(9.558, 6);
    expect(r.account.positions).toHaveLength(0);
    expect(() => startDay(r.account, "2026-11-03")).not.toThrow();
  });

  it("AC-003-05: まだ判定していない足が損切りに届かなければ、その足の終値で取引終了として売る(定義 14)", () => {
    const { account } = bought(bar("09:50", 78.45, 78.6, 78.3, 78.5), 77.1);
    const r = settleSessionEnd(account, { symbol: "TQQQ", lastReceivedBar: bar("15:45", 78.5, 78.7, 78.4, 78.6) });
    expect(r.closed).toMatchObject({ exitPrice: 78.6, reason: "close", exitTime: at("15:45") });
    expect(r.closed?.pnlJpy).toBeCloseTo(9.558, 6);
    expect(r.account.positions).toHaveLength(0);
  });

  it("定義 14: すでに判定した足より前の足を渡したらエラーにする(売った時刻が買った時刻より前にならないように)", () => {
    let { account } = bought(bar("10:00", 78.45, 78.6, 78.3, 78.5), 77.1);
    account = processBar(account, { symbol: "TQQQ", bar: bar("15:45", 78.5, 78.7, 78.4, 78.6), isLastBar: false }).account;
    expect(() => settleSessionEnd(account, { symbol: "TQQQ", lastReceivedBar: bar("09:50", 70, 70, 70, 70) })).toThrow(/判定済み/);
  });

  it("定義 14: 持っている株がなければ何もしない", () => {
    const a = fresh();
    expect(settleSessionEnd(a, { symbol: "TQQQ", lastReceivedBar: bar("15:45", 1, 1, 1, 1) })).toEqual({ account: a, closed: null });
  });

  it("AC-003-05: まだ判定していない足なら、先に売る判定をする(損切りが先。定義 14)", () => {
    const { account } = bought(bar("09:50", 78.45, 78.6, 78.3, 78.5), 77.1);
    const r = settleSessionEnd(account, { symbol: "TQQQ", lastReceivedBar: bar("15:45", 77.5, 77.6, 77.0, 77.4) });
    expect(r.closed).toMatchObject({ exitPrice: 77.1, reason: "stop" });
  });

  it("AC-003-13: 日の途中で変えた為替レートと元手は、次の取引日から使う", () => {
    let { account } = bought(bar("09:50", 25.0, 25.2, 24.9, 25.1), 24.5);
    account = scheduleSettings(account, { fxRate: 100, principal: 20_000 });
    // 今日はまだ 150 円、元手 10,000円のまま
    expect(account.fxRate).toBe(150);
    expect(account.principal).toBe(10_000);
    const sold = processBar(account, { symbol: "TQQQ", bar: bar("15:55", 26, 26, 26, 26), isLastBar: true });
    expect(sold.closed?.pnlJpy).toBeCloseTo(1 * 1.3333 * 150, 6);
    const next = startDay(sold.account, "2026-11-03");
    expect(next.fxRate).toBe(100);
    expect(next.principal).toBe(20_000);
    expect(next.pending).toBeNull();
  });

  it("AC-003-13: 元手だけ、為替だけを別々に取っておいても、次の取引日に両方使う", () => {
    let a = scheduleSettings(fresh(), { principal: 20_000 });
    a = scheduleSettings(a, { fxRate: 100 });
    expect(a.pending).toEqual({ principal: 20_000, fxRate: 100 });
    const next = startDay(a, "2026-11-03");
    expect(next).toMatchObject({ principal: 20_000, fxRate: 100, pending: null });
  });

  it("AC-003-13: 元手だけ変えた時は、為替レートはそのまま", () => {
    const next = startDay(scheduleSettings(fresh(), { principal: 20_000 }), "2026-11-03");
    expect(next).toMatchObject({ principal: 20_000, fxRate: 150 });
  });

  it("AC-003-13: 元手の変更を取っておいても、その日の買いの予算は 5,000円のまま", () => {
    const a = scheduleSettings(fresh(), { principal: 20_000 });
    const r = enter(a, { session, symbol: "TQQQ", nextBar: bar("10:00", 50, 50, 50, 50), stopPrice: 49 });
    if (r.kind !== "entered") throw new Error("買えなかった");
    expect(r.position.shares).toBe(sharesFor(5000, 50, 150));
  });

  it("AC-003-12: 同じ日、過去の日、取引日でない日には切り替えない", () => {
    const a = { ...fresh(), realizedTodayJpy: -1000 };
    expect(() => startDay(a, DAY)).toThrow(/より後の日/);
    expect(() => startDay(a, "2026-10-30")).toThrow(/より後の日/);
    expect(() => startDay(a, "2026-11-07")).toThrow(/取引日ではありません/);
    expect(() => startDay(a, "2026-11-26")).toThrow(/取引日ではありません/);
  });

  it("AC-003-05: 夏時間の日(2026-07-01)も、15:30 に始まる足では買わず、15:25 なら買う(定義 1)", () => {
    const summer = sessionOn("2026-07-01")!;
    const b = (iso: string): Bar => ({ start: new Date(iso), open: 78, high: 78, low: 78, close: 78, volume: 1 });
    expect(enter(fresh(), { session: summer, symbol: "TQQQ", nextBar: b("2026-07-01T19:30:00Z"), stopPrice: 77 }).kind).toBe("skipped");
    expect(enter(fresh(), { session: summer, symbol: "TQQQ", nextBar: b("2026-07-01T19:25:00Z"), stopPrice: 77 }).kind).toBe("entered");
  });

  it("AC-003-14: 同じ銘柄の株をすでに持っている時は買わない", () => {
    const { account } = bought(bar("09:50", 78.45, 78.6, 78.3, 78.5), 77.1);
    const r = enter(account, { session, symbol: "TQQQ", nextBar: bar("10:30", 79, 79, 79, 79), stopPrice: 77.1 });
    expect(r).toMatchObject({ kind: "skipped", reason: "already-holding" });
  });

  it("AC-003-05: 画面の円は、負の値も絶対値で四捨五入する(-86.5 は -87。定義 7)", () => {
    expect(roundYen(-86.5)).toBe(-87);
    expect(roundYen(86.5)).toBe(87);
    expect(roundYen(-86.022)).toBe(-86);
    expect(roundYen(199.195)).toBe(199);
    expect(roundYen(-0.4)).toBe(0);
    // 買値 20.15、売値 19.97、0.5株、為替 150 は -13.5円のはずが、計算では -13.499999999999979 になる
    const pnl = pnlJpy(20.15, 19.97, 0.5, 150);
    expect(pnl).not.toBe(-13.5);
    expect(roundYen(pnl)).toBe(-14);
    expect(Object.is(roundYen(-0.4), -0)).toBe(false);
  });
});
