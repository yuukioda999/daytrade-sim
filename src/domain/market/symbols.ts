/** 監視している4銘柄(SPEC-002、ADR-0001) */
export const WATCHLIST = ["SOXL", "TQQQ", "TSLL", "NVDL"] as const;
export type WatchSymbol = (typeof WATCHLIST)[number];

export function isWatchSymbol(value: string): value is WatchSymbol {
  return (WATCHLIST as readonly string[]).includes(value);
}
