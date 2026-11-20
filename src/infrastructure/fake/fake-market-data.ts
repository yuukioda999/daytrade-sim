import { MarketDataError, type MarketDataErrorKind, type MarketDataSource, type SymbolBar } from "@/application/ports";
import { sessionOn } from "@/domain/market/market-calendar";
import { toEastern } from "@/domain/market/eastern-time";
import type { CredentialsInput } from "@/domain/settings/settings";

/**
 * テスト用の市場データ。通信しない(SPEC-006 の確かめ方: Alpaca はテスト用の差し替えを使う)。
 * - キー ID が "PKBAD" で始まると、認証のエラーにする
 * - failOnce に入れた「銘柄|月」の取得は、1回目だけ失敗する(AC-006-11 の取り直しを確かめるため)
 * - 各取引日の通常の取引時間に5分足を作り、前後に時間外の足を1本ずつ足す
 */
export class FakeMarketData implements MarketDataSource {
  readonly calls: { symbol: string; start: Date; end: Date }[] = [];
  private failed = new Set<string>();

  constructor(
    private readonly options: { failOnce?: string[]; failKind?: MarketDataErrorKind; delayMs?: number } = {},
  ) {}

  async fetchBars(credentials: CredentialsInput, symbol: string, start: Date, end: Date): Promise<SymbolBar[]> {
    this.authorize(credentials);
    // 画面のテストで、進み具合の表示を見られるように少し待つ
    if (this.options.delayMs) await new Promise((r) => setTimeout(r, this.options.delayMs));
    this.calls.push({ symbol, start, end });
    const month = toEastern(start).date.slice(0, 7);
    const key = `${symbol}|${month}`;
    if (this.options.failOnce?.includes(key) && !this.failed.has(key)) {
      this.failed.add(key);
      throw new MarketDataError(this.options.failKind ?? "server", "テスト用の失敗");
    }
    const bars: SymbolBar[] = [];
    for (let t = start.getTime(); t < end.getTime(); t += 24 * 60 * 60_000) {
      const session = sessionOn(toEastern(new Date(t)).date);
      if (!session) continue;
      // 時間外の足(保存されないことを確かめるため)
      bars.push(bar(symbol, new Date(session.open.getTime() - 5 * 60_000), 10));
      for (let s = session.open.getTime(); s < session.close.getTime(); s += 5 * 60_000) {
        bars.push(bar(symbol, new Date(s), 10 + ((s / 300_000) % 7) * 0.1));
      }
      bars.push(bar(symbol, session.close, 10));
    }
    return bars.filter((b) => b.start >= start && b.start < end);
  }

  async latestBar(credentials: CredentialsInput, symbol: string, now: Date): Promise<SymbolBar | null> {
    this.authorize(credentials);
    return bar(symbol, new Date(Math.floor((now.getTime() - 20 * 60_000) / 300_000) * 300_000), 42.5);
  }

  private authorize(credentials: CredentialsInput): void {
    if (credentials.keyId.startsWith("PKBAD")) throw new MarketDataError("unauthorized", "HTTP 401");
  }
}

function bar(symbol: string, start: Date, price: number): SymbolBar {
  return { symbol, start, open: price, high: price + 0.2, low: price - 0.2, close: price, volume: 1_000, vwap: price };
}
