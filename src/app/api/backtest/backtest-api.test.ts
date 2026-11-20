import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import type { Repositories } from "@/application/ports";
import { memoryRepositories } from "@/infrastructure/memory/memory-repositories";
import { CREDS, et, pastDayBars } from "@/testing/scripted-market";
import { WATCHLIST } from "@/domain/market/symbols";

let repos: Repositories;
const NOW = et(12, 0, "2026-11-20");
vi.mock("@/infrastructure/container", () => ({
  getRepositories: () => repos,
  now: () => NOW,
}));

const { POST } = await import("./route");
const { GET: getResults } = await import("../results/route");
const { GET: getDashboard } = await import("../dashboard/route");

function request(path: string, method: "GET" | "POST", headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers: { host: "localhost:3000", ...(method === "POST" ? { "content-type": "application/json" } : {}), ...headers },
    body: method === "POST" ? "{}" : undefined,
  });
}

beforeEach(() => {
  repos = memoryRepositories(() => NOW);
  repos.credentials.save(CREDS);
});

function seedDay(date: string) {
  for (const s of WATCHLIST) {
    repos.bars.saveBars(pastDayBars(s, date));
    repos.bars.markFetched(s, [date]);
  }
}

describe("過去データで試す API(AC-006-12)", () => {
  it("AC-006-12、AC-004-04、AC-007-18: 試した日数を返し、成績の API で別の欄として読める。ダッシュボードの API でその日を読める", async () => {
    seedDay("2026-11-02");
    const res = await POST(request("/api/backtest", "POST"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, days: 1, trades: 0 });
    const results = await (await getResults(request("/api/results", "GET"))).json();
    expect(results).toMatchObject({ live: null, backtest: { summary: { recordedDays: 1 } } });
    const day = await getDashboard(request("/api/dashboard?backtest=2026-11-02", "GET"));
    expect(day.status).toBe(200);
    expect(await day.json()).toMatchObject({ mode: "backtest", date: "2026-11-02", isToday: false, backtestDates: ["2026-11-02"] });
  });

  it("AC-006-12: 試せる日がなければ 422 と、どうすればよいかを返す", async () => {
    const res = await POST(request("/api/backtest", "POST"));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("過去データ");
  });

  it("AC-007-18: 試していない日や、形の違う日付は読めない", async () => {
    expect((await getDashboard(request("/api/dashboard?backtest=2026-11-02", "GET"))).status).toBe(404);
    expect((await getDashboard(request("/api/dashboard?backtest=x", "GET"))).status).toBe(400);
  });

  it("別のサイトの画面からは、試すことも読むこともできない", async () => {
    seedDay("2026-11-02");
    expect((await POST(request("/api/backtest", "POST", { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await POST(request("/api/backtest", "POST", { origin: "https://evil.example" }))).status).toBe(403);
    expect((await getResults(request("/api/results", "GET", { host: "evil.example" }))).status).toBe(403);
    expect(repos.backtest.getRun()).toBeNull();
  });

  it("成績の API の応答に接続用キーを入れない", async () => {
    const text = await (await getResults(request("/api/results", "GET"))).text();
    expect(text).not.toContain(CREDS.keyId);
    expect(text).not.toContain(CREDS.secret);
  });
});
