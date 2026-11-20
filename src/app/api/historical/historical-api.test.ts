import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Repositories } from "@/application/ports";
import { FakeMarketData } from "@/infrastructure/fake/fake-market-data";
import { memoryRepositories } from "@/infrastructure/memory/memory-repositories";

let repos: Repositories;
let source: FakeMarketData;
vi.mock("@/infrastructure/container", () => ({
  getRepositories: () => repos,
  getMarketDataSource: () => source,
}));

const { GET: getSummary } = await import("./route");
const { POST: postPlan } = await import("./plan/route");
const { POST: postImport } = await import("./import/route");
const { POST: postCheck } = await import("../settings/connection-check/route");

const CREDS = { keyId: "PKTESTKEY0000000ABCD", secret: "TestSecret000000000000000000000000000Zq9X" };

function request(path: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost:3000${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { host: "localhost:3000", ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  repos = memoryRepositories();
  source = new FakeMarketData({ failOnce: ["NVDL|2026-11"] });
  vi.useFakeTimers({ now: new Date("2026-11-20T17:00:00Z"), toFake: ["Date"] });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("接続の確かめの API", () => {
  it("AC-006-05: 成功と、SOXL の足を返す。応答にキーを入れない", async () => {
    repos.credentials.save(CREDS);
    const res = await postCheck(request("/api/settings/connection-check", {}));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({ ok: true, symbol: "SOXL" });
    expect(text).not.toContain(CREDS.keyId);
  });

  it("別のサイトの画面からは呼べない(外へ通信させない)", async () => {
    repos.credentials.save(CREDS);
    const spy = vi.spyOn(source, "latestBar");
    const res = await postCheck(request("/api/settings/connection-check", {}, { origin: "https://evil.example.com" }));
    expect(res.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("過去データの API", () => {
  it("AC-006-09: 計画、1回分の取得、保存している様子", async () => {
    repos.credentials.save(CREDS);
    const plan = await postPlan(request("/api/historical/plan", { from: "2026-11-02", to: "2026-11-03" }));
    const { chunks } = await plan.json();
    expect(chunks).toHaveLength(4);
    const res = await postImport(request("/api/historical/import", chunks[0]));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, received: 156, saved: 156 });
    const summary = await (await getSummary(request("/api/historical"))).json();
    expect(summary.symbols).toEqual([{ symbol: "SOXL", barCount: 156, dayCount: 2, firstDate: "2026-11-02", lastDate: "2026-11-03" }]);
  });

  it("期間が違えば 422 で、どこが違うかを返す", async () => {
    const res = await postPlan(request("/api/historical/plan", { from: "2026-11-02", to: "2026-11-20" }));
    expect(res.status).toBe(422);
    expect((await res.json()).errors.to).toContain("昨日");
  });

  it("AC-006-11: Alpaca から取れなかった1回分は 502 で、失敗の言葉を返す", async () => {
    repos.credentials.save(CREDS);
    const res = await postImport(request("/api/historical/import", { symbol: "NVDL", from: "2026-11-02", to: "2026-11-03" }));
    expect(res.status).toBe(502);
    expect((await res.json()).message).toContain("Alpaca 側でエラー");
  });

  it("範囲が違う1回分は 422 で、通信しない", async () => {
    repos.credentials.save(CREDS);
    const res = await postImport(request("/api/historical/import", { symbol: "AAPL", from: "2026-11-02", to: "2026-11-03" }));
    expect(res.status).toBe(422);
    expect(source.calls).toEqual([]);
  });
});

describe("過去データの API も、別のサイトの画面や別の名前からは呼べない(T8 のセキュリティレビュー 3)", () => {
  const chunk = { symbol: "SOXL", from: "2026-11-02", to: "2026-11-03" };
  it.each([
    ["Origin が別のサイト", { origin: "https://evil.example.com" }],
    ["Sec-Fetch-Site が cross-site", { "sec-fetch-site": "cross-site" }],
    ["Host が localhost 以外", { host: "evil.example.com" }],
  ])("%s なら、計画も取得も 403 で、Alpaca 側を呼ばない", async (_, headers) => {
    repos.credentials.save(CREDS);
    expect((await postPlan(request("/api/historical/plan", { from: "2026-11-02", to: "2026-11-03" }, headers))).status).toBe(403);
    expect((await postImport(request("/api/historical/import", chunk, headers))).status).toBe(403);
    expect(source.calls).toEqual([]);
  });

  it("保存している様子の読み込みも、Host が localhost 以外なら 403", async () => {
    expect((await getSummary(request("/api/historical", undefined, { host: "evil.example.com" }))).status).toBe(403);
  });
});
