"use client";

import { useEffect, useRef } from "react";
import type { IChartApi, IPriceLine, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import type { SymbolView } from "@/application/dashboard-service";
import { formatEasternTime } from "./dashboard-model";

// 色は globals.css と同じ値(チャートは canvas に描くので CSS 変数を直接使えない)
const COLORS = {
  text: "#93a1b3",
  grid: "#1a2533",
  border: "#223042",
  up: "#3dd68c",
  down: "#ff7b72",
  vwap: "#f2b84b",
  orb: "#8cc4ff",
  volume: "#33475e",
};

const seconds = (iso: string) => Math.floor(new Date(iso).getTime() / 1000) as UTCTimestamp;
const fromSeconds = (t: unknown) => new Date(Number(t) * 1000).toISOString();

type Parts = {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  vwap: ISeriesApi<"Line">;
  volume: ISeriesApi<"Histogram">;
  orbLines: IPriceLine[];
  lineStyleDashed: number;
};

/**
 * 5分足のローソク足に、朝の値幅と今日の平均価格の線を重ね、下に取引量を出す(AC-007-12)。
 * TradingView の帰属表示(attributionLogo)を有効にする(AC-007-13、ADR-0002)。帰属表示は部品の中の画像とリンクで、外から何も読み込まない。
 * チャートは銘柄ごとに1回だけ作り、1分ごとの読み直しでは中身だけを入れ替える(拡大や横の移動を戻さないため。T10 のレビュー 10)
 */
export function PriceChart({ view }: { view: SymbolView }) {
  const container = useRef<HTMLDivElement>(null);
  const parts = useRef<Parts | null>(null);
  const latest = useRef(view);
  const hasBars = view.bars.length > 0;

  useEffect(() => {
    latest.current = view;
    if (parts.current) setData(parts.current, view);
  }, [view]);

  useEffect(() => {
    const el = container.current;
    if (!el || !hasBars) return;
    let disposed = false;
    void import("lightweight-charts").then((lc) => {
      if (disposed) return;
      const chart = lc.createChart(el, {
        autoSize: true,
        layout: {
          background: { type: lc.ColorType.Solid, color: "transparent" },
          textColor: COLORS.text,
          fontFamily: "inherit",
          attributionLogo: true,
        },
        grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
        rightPriceScale: { borderColor: COLORS.border },
        timeScale: {
          borderColor: COLORS.border,
          timeVisible: true,
          // 時刻の目盛りは米国東部時間で出す
          tickMarkFormatter: (t: unknown) => formatEasternTime(fromSeconds(t)),
        },
        localization: { locale: "ja-JP", timeFormatter: (t: unknown) => `米国東部 ${formatEasternTime(fromSeconds(t))}` },
      });
      const candles = chart.addSeries(lc.CandlestickSeries, {
        upColor: COLORS.up,
        downColor: COLORS.down,
        borderUpColor: COLORS.up,
        borderDownColor: COLORS.down,
        wickUpColor: COLORS.up,
        wickDownColor: COLORS.down,
      });
      const vwap = chart.addSeries(lc.LineSeries, {
        color: COLORS.vwap,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      const volume = chart.addSeries(lc.HistogramSeries, {
        color: COLORS.volume,
        priceScaleId: "volume",
        priceFormat: { type: "volume" },
        priceLineVisible: false,
        lastValueVisible: false,
      });
      chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.25 } });
      parts.current = { chart, candles, vwap, volume, orbLines: [], lineStyleDashed: lc.LineStyle.Dashed };
      setData(parts.current, latest.current);
      chart.timeScale().fitContent();
    });
    return () => {
      disposed = true;
      parts.current?.chart.remove();
      parts.current = null;
    };
  }, [hasBars]);

  if (!hasBars) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-lg border border-border text-fg-sub">
        今日の値動きはまだ届いていません
      </div>
    );
  }
  // 絵は読み上げられないので、要点は figcaption の文字(AC-007-14)で伝える
  return <div ref={container} data-testid="price-chart" className="h-[320px] w-full" />;
}

function setData(p: Parts, view: SymbolView): void {
  p.candles.setData(view.bars.map((b) => ({ time: seconds(b.time), open: b.open, high: b.high, low: b.low, close: b.close })));
  p.vwap.setData(view.vwapLine.map((v) => ({ time: seconds(v.time), value: v.value })));
  p.volume.setData(view.bars.map((b) => ({ time: seconds(b.time), value: b.volume })));
  for (const line of p.orbLines) p.candles.removePriceLine(line);
  p.orbLines = [];
  const add = (price: number | null, title: string) => {
    if (price === null) return;
    p.orbLines.push(p.candles.createPriceLine({ price, color: COLORS.orb, lineStyle: p.lineStyleDashed, lineWidth: 1, title }));
  };
  add(view.orbHigh, "朝の高値");
  add(view.orbLow, "朝の安値");
}
