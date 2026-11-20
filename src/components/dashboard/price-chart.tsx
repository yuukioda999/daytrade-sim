"use client";

import { useEffect, useRef } from "react";
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

const seconds = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const fromSeconds = (t: unknown) => new Date(Number(t) * 1000).toISOString();

/**
 * 5分足のローソク足に、朝の値幅と今日の平均価格の線を重ね、下に取引量を出す(AC-007-12)。
 * TradingView の帰属表示(attributionLogo)を有効にする(AC-007-13、ADR-0002)。帰属表示は部品の中の画像とリンクで、外から何も読み込まない
 */
export function PriceChart({ view }: { view: SymbolView }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = container.current;
    if (!el || view.bars.length === 0) return;
    let disposed = false;
    let cleanup: (() => void) | null = null;
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
      candles.setData(
        view.bars.map((b) => ({ time: seconds(b.time) as never, open: b.open, high: b.high, low: b.low, close: b.close })),
      );
      if (view.orbHigh !== null) {
        candles.createPriceLine({ price: view.orbHigh, color: COLORS.orb, lineStyle: lc.LineStyle.Dashed, lineWidth: 1, title: "朝の高値" });
      }
      if (view.orbLow !== null) {
        candles.createPriceLine({ price: view.orbLow, color: COLORS.orb, lineStyle: lc.LineStyle.Dashed, lineWidth: 1, title: "朝の安値" });
      }
      const vwap = chart.addSeries(lc.LineSeries, {
        color: COLORS.vwap,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      vwap.setData(view.vwapLine.map((p) => ({ time: seconds(p.time) as never, value: p.value })));
      const volume = chart.addSeries(lc.HistogramSeries, {
        color: COLORS.volume,
        priceScaleId: "volume",
        priceFormat: { type: "volume" },
        priceLineVisible: false,
        lastValueVisible: false,
      });
      chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.25 } });
      volume.setData(view.bars.map((b) => ({ time: seconds(b.time) as never, value: b.volume })));
      chart.timeScale().fitContent();
      cleanup = () => chart.remove();
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [view]);

  if (view.bars.length === 0) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-lg border border-border text-fg-sub">
        今日の値動きはまだ届いていません
      </div>
    );
  }
  // 絵は読み上げられないので、要点は figcaption の文字(AC-007-14)で伝える
  return <div ref={container} data-testid="price-chart" className="h-[320px] w-full" />;
}
