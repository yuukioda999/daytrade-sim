import { z } from "zod";
import { MarketDataError, type MarketDataSource, type SymbolBar } from "@/application/ports";
import type { CredentialsInput } from "@/domain/settings/settings";

/**
 * 通信先は Alpaca のデータ API のホストだけ(ADR-0006、SPEC-006 AC-006-07)。
 * 利用者が入力した URL へは通信しない。この値はコードの中で固定する
 */
export const ALPACA_DATA_ORIGIN = "https://data.alpaca.markets";
const BARS_PATH = "/v2/stocks/bars";

/** 1回の応答の最大の本数(Alpaca の資料) */
const PAGE_LIMIT = 10_000;
/** 同じ取得で続きのページを取る回数の上限(応答がおかしい時に止まらなくなるのを防ぐ) */
const MAX_PAGES = 50;
/** 1回の通信の待ち時間の上限 */
const TIMEOUT_MS = 20_000;
/** 無料のプランで全市場(SIP)のデータを取るには、終わりの時刻が15分以上前である必要がある。少し余裕を持たせる */
const FREE_PLAN_DELAY_MS = 16 * 60_000;
/** 接続の確かめで、最新の足を探しにいく期間(週末と連休をまたぐため) */
const LATEST_LOOKBACK_MS = 7 * 24 * 60 * 60_000;

const barSchema = z.object({
  t: z.string(),
  // 価格と取引量は負にならない。形が違う応答は保存しない
  o: z.number().nonnegative(),
  h: z.number().nonnegative(),
  l: z.number().nonnegative(),
  c: z.number().nonnegative(),
  v: z.number().nonnegative(),
  vw: z.number().nonnegative().optional(),
});

const responseSchema = z.object({
  bars: z.record(z.string(), z.array(barSchema)).nullable(),
  next_page_token: z.string().nullable().optional(),
});

type Fetch = typeof fetch;

export class AlpacaMarketData implements MarketDataSource {
  readonly isTestSource = false;

  constructor(private readonly fetchImpl: Fetch = fetch) {}

  async fetchBars(credentials: CredentialsInput, symbol: string, start: Date, end: Date): Promise<SymbolBar[]> {
    const result: SymbolBar[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({
        symbols: symbol,
        timeframe: "5Min",
        start: start.toISOString(),
        // Alpaca の end は両端を含むので、終わりの瞬間の足を含めないように 1ミリ秒前にする
        end: new Date(end.getTime() - 1).toISOString(),
        limit: String(PAGE_LIMIT),
        feed: "sip",
        // 株式分割などの調整をしない値。自動売買(T9)がためる今日の値と同じ形にし、保存した値があとで変わらないようにする。
        // 分割のあと最大20取引日は、取引量の条件(過去20日の同じ時刻との比べ)がずれる(SPEC-006 決めたこと 11)
        adjustment: "raw",
        sort: "asc",
      });
      if (pageToken) params.set("page_token", pageToken);
      const body = await this.request(credentials, params);
      result.push(...toBars(body, symbol));
      pageToken = body.next_page_token ?? null;
      if (!pageToken) return result;
    }
    throw new MarketDataError("bad-response", `続きのページが ${MAX_PAGES} 回を超えました`);
  }

  async latestBar(credentials: CredentialsInput, symbol: string, now: Date): Promise<SymbolBar | null> {
    const end = new Date(now.getTime() - FREE_PLAN_DELAY_MS);
    const params = new URLSearchParams({
      symbols: symbol,
      timeframe: "5Min",
      start: new Date(end.getTime() - LATEST_LOOKBACK_MS).toISOString(),
      end: end.toISOString(),
      limit: "1",
      feed: "sip",
      adjustment: "raw",
      sort: "desc",
    });
    const bars = toBars(await this.request(credentials, params), symbol);
    return bars[0] ?? null;
  }

  private async request(credentials: CredentialsInput, params: URLSearchParams): Promise<z.infer<typeof responseSchema>> {
    // キーは URL ではなくヘッダーで送る(URL はログやエラー文に出やすいため)
    const url = `${ALPACA_DATA_ORIGIN}${BARS_PATH}?${params.toString()}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          "APCA-API-KEY-ID": credentials.keyId,
          "APCA-API-SECRET-KEY": credentials.secret,
          Accept: "application/json",
        },
        // 通信先の転送(リダイレクト)には従わない。別のホストへキーが送られるのを防ぐ
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (e) {
      // fetch のエラー文には URL が入ることがあるが、キーは入らない。それでも種類の名前だけを残す
      throw new MarketDataError("network", e instanceof Error ? e.name : "unknown");
    }
    if (res.status === 401 || res.status === 403) throw new MarketDataError("unauthorized", `HTTP ${res.status}`);
    if (res.status === 429) throw new MarketDataError("rate-limited", "HTTP 429");
    if (res.status >= 500) throw new MarketDataError("server", `HTTP ${res.status}`);
    if (!res.ok) throw new MarketDataError("bad-response", `HTTP ${res.status}`);
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new MarketDataError("bad-response", "JSON として読めません");
    }
    const parsed = responseSchema.safeParse(json);
    if (!parsed.success) throw new MarketDataError("bad-response", "応答の形が違います");
    return parsed.data;
  }
}

function toBars(body: z.infer<typeof responseSchema>, symbol: string): SymbolBar[] {
  const raw = body.bars?.[symbol] ?? [];
  return raw.map((b) => {
    const start = new Date(b.t);
    if (Number.isNaN(start.getTime())) throw new MarketDataError("bad-response", "足の時刻を読めません");
    return { symbol, start, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v, vwap: b.vw };
  });
}
