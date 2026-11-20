import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MarketDataError } from "@/application/ports";
import { ALPACA_DATA_ORIGIN, AlpacaMarketData } from "./alpaca-market-data";

const CREDS = { keyId: "PKTESTKEY0000000ABCD", secret: "TestSecret000000000000000000000000000Zq9X" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mockFetch(...responses: (Response | Error)[]) {
  const fn = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("想定より多く呼ばれた");
    if (next instanceof Error) throw next;
    return next;
  });
  return fn as unknown as typeof fetch & typeof fn;
}

const alpacaBar = (t: string, c = 10) => ({ t, o: c, h: c + 1, l: c - 1, c, v: 1000, n: 10, vw: c + 0.1 });

describe("AC-006-07: 通信先は Alpaca のデータ API のホストだけ", () => {
  it("足の取得は https://data.alpaca.markets/v2/stocks/bars だけに送る。キーは URL ではなくヘッダーで送る", async () => {
    const fetchImpl = mockFetch(jsonResponse({ bars: { SOXL: [alpacaBar("2026-11-02T14:30:00Z")] }, next_page_token: null }));
    await new AlpacaMarketData(fetchImpl).fetchBars(
      CREDS,
      "SOXL",
      new Date("2026-11-02T14:30:00Z"),
      new Date("2026-11-02T21:00:00Z"),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const u = new URL(url);
    expect(u.origin).toBe("https://data.alpaca.markets");
    expect(u.pathname).toBe("/v2/stocks/bars");
    expect(url).not.toContain(CREDS.keyId);
    expect(url).not.toContain(CREDS.secret);
    expect(init.headers).toMatchObject({ "APCA-API-KEY-ID": CREDS.keyId, "APCA-API-SECRET-KEY": CREDS.secret });
    // 転送(リダイレクト)で別のホストへキーが送られないようにする
    expect(init.redirect).toBe("error");
  });

  it("src の中で、通信先の URL として書かれているのは Alpaca のデータ API だけ", () => {
    const root = path.join(process.cwd(), "src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) files.push(p);
      }
    };
    walk(root);
    const urls = new Set<string>();
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(/["'`](https?:\/\/[^"'`\s]+)/g)) urls.add(m[1]);
    }
    expect([...urls]).toEqual([ALPACA_DATA_ORIGIN]);
  });
});

describe("足の取得", () => {
  it("全市場(sip)の5分足を、調整なしで頼み、終わりの時刻はその1ミリ秒前にする(Alpaca の end は両端を含む)", async () => {
    const fetchImpl = mockFetch(jsonResponse({ bars: { SOXL: [] }, next_page_token: null }));
    await new AlpacaMarketData(fetchImpl).fetchBars(
      CREDS,
      "SOXL",
      new Date("2026-11-02T14:30:00Z"),
      new Date("2026-11-02T21:00:00Z"),
    );
    const u = new URL((fetchImpl.mock.calls[0] as unknown as [string])[0]);
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      symbols: "SOXL",
      timeframe: "5Min",
      start: "2026-11-02T14:30:00.000Z",
      end: "2026-11-02T20:59:59.999Z",
      feed: "sip",
      adjustment: "raw",
      sort: "asc",
      limit: "10000",
    });
  });

  it("続きのページがあれば next_page_token で取り続け、すべての足を返す", async () => {
    const fetchImpl = mockFetch(
      jsonResponse({ bars: { SOXL: [alpacaBar("2026-11-02T14:30:00Z", 10)] }, next_page_token: "abc" }),
      jsonResponse({ bars: { SOXL: [alpacaBar("2026-11-02T14:35:00Z", 11)] }, next_page_token: null }),
    );
    const bars = await new AlpacaMarketData(fetchImpl).fetchBars(
      CREDS,
      "SOXL",
      new Date("2026-11-02T14:30:00Z"),
      new Date("2026-11-02T21:00:00Z"),
    );
    expect(bars).toEqual([
      { symbol: "SOXL", start: new Date("2026-11-02T14:30:00Z"), open: 10, high: 11, low: 9, close: 10, volume: 1000, vwap: 10.1 },
      { symbol: "SOXL", start: new Date("2026-11-02T14:35:00Z"), open: 11, high: 12, low: 10, close: 11, volume: 1000, vwap: 11.1 },
    ]);
    expect(new URL((fetchImpl.mock.calls[1] as unknown as [string])[0]).searchParams.get("page_token")).toBe("abc");
  });

  it("足がない時(bars が null)は空", async () => {
    const fetchImpl = mockFetch(jsonResponse({ bars: null, next_page_token: null }));
    const bars = await new AlpacaMarketData(fetchImpl).fetchBars(CREDS, "SOXL", new Date(0), new Date(1));
    expect(bars).toEqual([]);
  });

  it("AC-006-05 の前提: 最新の足は、15分より前(16分前)までの期間を新しい順に1本だけ頼む", async () => {
    const fetchImpl = mockFetch(jsonResponse({ bars: { SOXL: [alpacaBar("2026-11-20T16:40:00Z", 42)] }, next_page_token: null }));
    const now = new Date("2026-11-20T17:00:00Z");
    const bar = await new AlpacaMarketData(fetchImpl).latestBar(CREDS, "SOXL", now);
    expect(bar?.close).toBe(42);
    const u = new URL((fetchImpl.mock.calls[0] as unknown as [string])[0]);
    expect(u.searchParams.get("end")).toBe("2026-11-20T16:44:00.000Z");
    expect(u.searchParams.get("sort")).toBe("desc");
    expect(u.searchParams.get("limit")).toBe("1");
  });
});

describe("失敗の種類(AC-006-05: 失敗の時もキーを出さない)", () => {
  it.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [429, "rate-limited"],
    [500, "server"],
    [503, "server"],
    [400, "bad-response"],
  ] as const)("HTTP %d は %s", async (status, kind) => {
    const fetchImpl = mockFetch(jsonResponse({ message: `bad ${CREDS.keyId}` }, status));
    const err = await new AlpacaMarketData(fetchImpl).latestBar(CREDS, "SOXL", new Date()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MarketDataError);
    expect((err as MarketDataError).kind).toBe(kind);
    // 応答の本文(キーが入っていることもある)をエラー文に入れない
    expect(String((err as Error).message)).not.toContain(CREDS.keyId);
  });

  it("通信できない時は network。fetch のエラー文は入れない", async () => {
    const fetchImpl = mockFetch(new TypeError(`fetch failed ${CREDS.secret}`));
    const err = (await new AlpacaMarketData(fetchImpl).latestBar(CREDS, "SOXL", new Date()).catch((e: unknown) => e)) as MarketDataError;
    expect(err.kind).toBe("network");
    expect(err.message).not.toContain(CREDS.secret);
  });

  it("応答の形が違う時は bad-response", async () => {
    const fetchImpl = mockFetch(jsonResponse({ bars: { SOXL: [{ t: "x", o: "1" }] } }));
    const err = (await new AlpacaMarketData(fetchImpl).latestBar(CREDS, "SOXL", new Date()).catch((e: unknown) => e)) as MarketDataError;
    expect(err.kind).toBe("bad-response");
  });
});
