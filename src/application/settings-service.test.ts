import { describe, expect, it } from "vitest";
import { memoryRepositories } from "@/infrastructure/memory/memory-repositories";
import {
  BLOCKED_NO_CREDENTIALS,
  BLOCKED_TURNED_OFF,
  deleteCredentials,
  getSettingsView,
  saveCredentials,
  setAutoTrading,
  updateMoney,
} from "./settings-service";

const KEY_ID = "PKTESTKEY0000000ABCD";
const SECRET = "TestSecret000000000000000000000000000Zq9X";
// 2026-11-20(金)12:00 米国東部時間(冬時間)
const FRIDAY_NOON = new Date("2026-11-20T17:00:00Z");
// 2026-11-23(月)12:00 米国東部時間
const MONDAY_NOON = new Date("2026-11-23T17:00:00Z");

describe("設定の画面に返す値", () => {
  it("まだ何も保存していない時は、既定の値(元手 10,000円、為替 150、自動売買 ON、キー未設定)", () => {
    const view = getSettingsView(memoryRepositories(), FRIDAY_NOON);
    expect(view).toEqual({
      autoTrading: { enabled: true, blockedReason: BLOCKED_NO_CREDENTIALS },
      money: { current: { principalJpy: 10_000, fxRate: 150, effectiveDate: null }, scheduled: null },
      limits: { budgetJpy: 5_000, dailyLossLimitJpy: 1_000 },
      credentials: { configured: false, keyIdLast4: null },
    });
  });

  it("AC-006-02: 予算と損失の上限は、今使っている元手から決まる", () => {
    const repos = memoryRepositories();
    updateMoney(repos, { principal: "200,000", fxRate: "150" }, FRIDAY_NOON);
    expect(getSettingsView(repos, FRIDAY_NOON).limits).toEqual({ budgetJpy: 100_000, dailyLossLimitJpy: 20_000 });
  });
});

describe("AC-006-15: 元手と為替を変えると、次の取引日から使う", () => {
  it("初めての保存はすぐ使い、2回目からは次の取引日から使う。予算と上限も今の元手のまま", () => {
    const repos = memoryRepositories();
    const first = updateMoney(repos, { principal: "10,000", fxRate: "150" }, FRIDAY_NOON);
    expect(first.ok && first.view.money.current).toEqual({ principalJpy: 10_000, fxRate: 150, effectiveDate: "2026-11-20" });

    const second = updateMoney(repos, { principal: "20000", fxRate: "140.5" }, FRIDAY_NOON);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.view.money.current.principalJpy).toBe(10_000);
    expect(second.view.money.scheduled).toEqual({ principalJpy: 20_000, fxRate: 140.5, effectiveDate: "2026-11-23" });
    expect(second.view.limits.budgetJpy).toBe(5_000);

    // 月曜日になると、変えた値を使う
    const monday = getSettingsView(repos, MONDAY_NOON);
    expect(monday.money.current).toEqual({ principalJpy: 20_000, fxRate: 140.5, effectiveDate: "2026-11-23" });
    expect(monday.money.scheduled).toBeNull();
    expect(monday.limits.budgetJpy).toBe(10_000);
  });

  it("次の取引日までに2回変えたら、後の値で置き換える", () => {
    const repos = memoryRepositories();
    updateMoney(repos, { principal: "10000", fxRate: "150" }, FRIDAY_NOON);
    updateMoney(repos, { principal: "20000", fxRate: "150" }, FRIDAY_NOON);
    updateMoney(repos, { principal: "30000", fxRate: "151" }, FRIDAY_NOON);
    expect(repos.settings.listMoneySettings()).toHaveLength(2);
    expect(getSettingsView(repos, FRIDAY_NOON).money.scheduled?.principalJpy).toBe(30_000);
  });
});

describe("AC-006-15: 「今日」は米国東部時間の日付で決める(日本時間や UTC の日付ではない)", () => {
  const withHistory = () => {
    const repos = memoryRepositories();
    repos.settings.putMoneySettings({ effectiveDate: "2026-01-02", principalJpy: 10_000, fxRateX100: 15_000 });
    return repos;
  };
  const scheduledDate = (now: Date) => {
    const r = updateMoney(withHistory(), { principal: "20000", fxRate: "150" }, now);
    return r.ok ? r.view.money.scheduled?.effectiveDate : undefined;
  };

  it.each([
    // 東部時間の日曜の夜は、UTC と日本時間ではもう月曜。東部時間では日曜なので、次の取引日は月曜
    ["冬時間の日曜 20:00 ET(UTC は月曜 01:00)", "2026-11-23T01:00:00Z", "2026-11-23"],
    ["夏時間の日曜 20:00 ET(UTC は月曜 00:00)", "2026-06-08T00:00:00Z", "2026-06-08"],
    // 木曜の夜に変えると金曜から。UTC の日付(金曜)で決めると月曜になってしまう
    ["冬時間の木曜 20:00 ET(UTC は金曜 01:00)", "2026-11-06T01:00:00Z", "2026-11-06"],
    // 夏時間が終わる日(11/1)の夜。冬時間(UTC-5)で数えないと月曜 00:30 になり、次の取引日が火曜にずれる
    ["夏時間が終わる日曜 23:30 ET(冬時間に変わったあと)", "2026-11-02T04:30:00Z", "2026-11-02"],
    // 夏時間が始まる日(3/8)の夜。夏時間(UTC-4)で数える
    ["夏時間が始まる日曜 22:30 ET(夏時間に変わったあと)", "2026-03-09T02:30:00Z", "2026-03-09"],
  ])("%s に変えると、%s から使う", (_, iso, expected) => {
    expect(scheduledDate(new Date(iso))).toBe(expected);
  });
});

describe("AC-006-13、14: 元手か為替が違えば、どちらも保存しない", () => {
  it("どこが違うかを、項目ごとに返す", () => {
    const repos = memoryRepositories();
    const r = updateMoney(repos, { principal: "999", fxRate: "301" }, FRIDAY_NOON);
    expect(r).toEqual({ ok: false, errors: { principal: expect.stringContaining("範囲"), fxRate: expect.stringContaining("範囲") } });
    expect(repos.settings.listMoneySettings()).toEqual([]);
  });

  it("片方だけ違っても、もう片方も保存しない", () => {
    const repos = memoryRepositories();
    const r = updateMoney(repos, { principal: "20000", fxRate: "abc" }, FRIDAY_NOON);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.principal).toBeUndefined();
    expect(repos.settings.listMoneySettings()).toEqual([]);
  });
});

describe("AC-006-01: 自動売買の ON / OFF を保存する", () => {
  it("OFF にすると OFF で、理由を出す。ON に戻せる", () => {
    const repos = memoryRepositories();
    saveCredentials(repos, { keyId: KEY_ID, secret: SECRET }, FRIDAY_NOON);
    expect(setAutoTrading(repos, false, FRIDAY_NOON).autoTrading).toEqual({ enabled: false, blockedReason: BLOCKED_TURNED_OFF });
    expect(setAutoTrading(repos, true, FRIDAY_NOON).autoTrading).toEqual({ enabled: true, blockedReason: null });
  });
});

describe("接続用キー", () => {
  it("AC-006-03: 保存すると「設定済み」と、キー ID の末尾4文字だけを返す", () => {
    const repos = memoryRepositories();
    const r = saveCredentials(repos, { keyId: KEY_ID, secret: SECRET }, FRIDAY_NOON);
    expect(r.ok && r.view.credentials).toEqual({ configured: true, keyIdLast4: "ABCD" });
    expect(repos.credentials.get()).toEqual({ keyId: KEY_ID, secret: SECRET });
  });

  it("AC-006-04: 設定済みでも、返す値にキー ID とシークレットの全文が含まれない", () => {
    const repos = memoryRepositories();
    saveCredentials(repos, { keyId: KEY_ID, secret: SECRET }, FRIDAY_NOON);
    const json = JSON.stringify(getSettingsView(repos, FRIDAY_NOON));
    expect(json).not.toContain(KEY_ID);
    expect(json).not.toContain(SECRET);
    // シークレットは一部も返さない
    expect(json).not.toContain(SECRET.slice(-4));
  });

  it("AC-006-08: 形式が違えば保存せず、どこが違うかを返す", () => {
    const repos = memoryRepositories();
    const r = saveCredentials(repos, { keyId: KEY_ID, secret: "too short" }, FRIDAY_NOON);
    expect(r).toEqual({ ok: false, errors: { secret: expect.any(String) } });
    expect(repos.credentials.get()).toBeNull();
  });

  it("AC-006-08: 形式が違う時、前に保存したキーはそのまま残る", () => {
    const repos = memoryRepositories();
    saveCredentials(repos, { keyId: KEY_ID, secret: SECRET }, FRIDAY_NOON);
    saveCredentials(repos, { keyId: "", secret: "" }, FRIDAY_NOON);
    expect(repos.credentials.get()).toEqual({ keyId: KEY_ID, secret: SECRET });
  });

  it("AC-006-06: 消すと「未設定」になり、自動売買が止まる理由を返す", () => {
    const repos = memoryRepositories();
    saveCredentials(repos, { keyId: KEY_ID, secret: SECRET }, FRIDAY_NOON);
    const view = deleteCredentials(repos, FRIDAY_NOON);
    expect(view.credentials).toEqual({ configured: false, keyIdLast4: null });
    expect(view.autoTrading.blockedReason).toBe(BLOCKED_NO_CREDENTIALS);
    expect(repos.credentials.get()).toBeNull();
  });
});
