import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeMarketData } from "@/infrastructure/fake/fake-market-data";
import { memoryRepositories, MemoryBarRepository } from "@/infrastructure/memory/memory-repositories";
import { checkConnection, importChunk, NO_CREDENTIALS_MESSAGE, planHistoricalImport } from "./market-data-service";
import type { Repositories } from "./ports";

const CREDS = { keyId: "PKTESTKEY0000000ABCD", secret: "TestSecret000000000000000000000000000Zq9X" };
// 2026-11-20(金)12:00 米国東部時間
const NOW = new Date("2026-11-20T17:00:00Z");

let repos: Repositories;
let warned: string[];
beforeEach(() => {
  repos = memoryRepositories();
  warned = [];
  vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => void warned.push(a.map(String).join(" ")));
});
afterEach(() => vi.restoreAllMocks());

describe("AC-006-05: 接続を確かめる", () => {
  it("SOXL の最新の足を1本取り、成功を返す", async () => {
    repos.credentials.save(CREDS);
    const r = await checkConnection(repos, new FakeMarketData(), NOW);
    expect(r).toEqual({ ok: true, symbol: "SOXL", barStart: "2026-11-20T16:40:00.000Z", close: 42.5 });
  });

  it("キーが違えば失敗を返す。画面に出す言葉にもログにもキーを出さない", async () => {
    const bad = { keyId: "PKBADKEY00000000WXYZ", secret: "BadSecret0000000000000000000000000000000" };
    repos.credentials.save(bad);
    const r = await checkConnection(repos, new FakeMarketData(), NOW);
    expect(r).toEqual({ ok: false, message: expect.stringContaining("キー ID かシークレットが違う") });
    expect(JSON.stringify(r)).not.toContain(bad.keyId);
    expect(warned).toEqual(["市場データの取得に失敗しました(unauthorized)"]);
  });

  it("キーが未設定なら、通信せずに失敗を返す", async () => {
    const source = new FakeMarketData();
    const spy = vi.spyOn(source, "latestBar");
    expect(await checkConnection(repos, source, NOW)).toEqual({ ok: false, message: NO_CREDENTIALS_MESSAGE });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("AC-006-09: 期間を選んで4銘柄の足を取り、保存する", () => {
  it("計画は4銘柄 × 月ごと。1回分を取ると、通常の取引時間の足だけを保存し、取り終えた日を記録する", async () => {
    repos.credentials.save(CREDS);
    const plan = planHistoricalImport(repos, { from: "2026-11-02", to: "2026-11-03" }, NOW);
    expect(plan.ok && plan.chunks).toHaveLength(4);
    if (!plan.ok) return;
    const r = await importChunk(repos, new FakeMarketData(), plan.chunks[0], NOW);
    // 2日 × 78本。時間外の足(前後1本ずつ)は捨てる
    expect(r).toEqual({ ok: true, received: 156, saved: 156 });
    expect(repos.bars.fetchedDates("SOXL", "2026-11-01", "2026-11-30")).toEqual(["2026-11-02", "2026-11-03"]);
    const stored = [...(repos.bars as MemoryBarRepository).bars.values()];
    expect(stored.every((b) => b.symbol === "SOXL")).toBe(true);
    expect(stored.map((b) => b.start.toISOString()).sort()[0]).toBe("2026-11-02T14:30:00.000Z");
  });

  it("1回分の取得は、最初の取引日の取引開始から最後の取引日の取引終了まで(短縮取引日は 13:00)", async () => {
    repos.credentials.save(CREDS);
    const source = new FakeMarketData();
    await importChunk(repos, source, { symbol: "TQQQ", from: "2026-11-25", to: "2026-11-27" }, new Date("2026-12-01T17:00:00Z"));
    expect(source.calls).toEqual([
      { symbol: "TQQQ", start: new Date("2026-11-25T14:30:00Z"), end: new Date("2026-11-27T18:00:00Z") },
    ]);
  });

  it("期間が違えば、どこが違うかを返す", () => {
    const r = planHistoricalImport(repos, { from: "2026-11-02", to: "2026-11-20" }, NOW);
    expect(r).toEqual({ ok: false, errors: { to: expect.stringContaining("昨日") } });
  });
});

describe("AC-006-10: 重なる期間を取っても、同じ足を二重に保存しない", () => {
  it("同じ範囲をもう一度取ると、新しく保存する足は0本", async () => {
    repos.credentials.save(CREDS);
    const chunk = { symbol: "SOXL", from: "2026-11-02", to: "2026-11-03" };
    await importChunk(repos, new FakeMarketData(), chunk, NOW);
    const again = await importChunk(repos, new FakeMarketData(), { ...chunk, to: "2026-11-04" }, NOW);
    expect(again).toEqual({ ok: true, received: 234, saved: 78 });
    expect((repos.bars as MemoryBarRepository).bars.size).toBe(234);
  });
});

describe("AC-006-11: 途中で失敗しても、それまでの分は残し、もう一度取れる", () => {
  it("失敗した1回分は記録せず、計画を作り直すとその範囲だけが残る。取り直すと成功する", async () => {
    repos.credentials.save(CREDS);
    const source = new FakeMarketData({ failOnce: ["TQQQ|2026-11"] });
    const plan = planHistoricalImport(repos, { from: "2026-11-02", to: "2026-11-03" }, NOW);
    if (!plan.ok) throw new Error("計画を作れない");
    const results = [];
    for (const c of plan.chunks) results.push(await importChunk(repos, source, c, NOW));
    expect(results.map((r) => r.ok)).toEqual([true, false, true, true]);
    expect(results[1]).toEqual({ ok: false, reason: "failed", message: expect.stringContaining("Alpaca 側でエラー") });

    const retry = planHistoricalImport(repos, { from: "2026-11-02", to: "2026-11-03" }, NOW);
    expect(retry.ok && retry.chunks).toEqual([{ symbol: "TQQQ", from: "2026-11-02", to: "2026-11-03" }]);
    if (!retry.ok) return;
    expect(await importChunk(repos, source, retry.chunks[0], NOW)).toEqual({ ok: true, received: 156, saved: 156 });
    expect(planHistoricalImport(repos, { from: "2026-11-02", to: "2026-11-03" }, NOW)).toEqual({ ok: true, chunks: [] });
  });
});

describe("画面から送られた1回分を確かめ直す", () => {
  it.each([
    { symbol: "AAPL", from: "2026-11-02", to: "2026-11-03" },
    { symbol: "SOXL", from: "2026-10-30", to: "2026-11-03" },
    { symbol: "SOXL", from: "2026-11-02", to: "2026-11-20" },
  ])("%o は取らない", async (chunk) => {
    repos.credentials.save(CREDS);
    const source = new FakeMarketData();
    expect(await importChunk(repos, source, chunk, NOW)).toEqual({ ok: false, reason: "invalid", message: "取得する範囲が正しくありません" });
    expect(source.calls).toEqual([]);
  });
});
