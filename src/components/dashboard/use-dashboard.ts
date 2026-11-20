"use client";

import { useEffect, useState } from "react";
import type { DashboardView } from "@/application/dashboard-service";

/** 画面を読み直す間隔(SPEC-007 決めたこと 1。データが15分遅れの5分足なので、1分ごとで足りる) */
export const REFRESH_MS = 60_000;

export type DashboardState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; view: DashboardView; refreshFailed: boolean };

type Loaded = { url: string; state: DashboardState };

/**
 * ダッシュボードと自動売買の記録の画面の値を、自前の API から1分ごとに読み直す。
 * backtestDate を渡すと、過去データで試したその日の値を1回だけ読む(変わらないので読み直さない。AC-007-18)。
 * lastView は、読み込み中も前に読めた値(過去データで試した日の一覧を出し続けるため)
 */
export function useDashboard(backtestDate: string | null = null): DashboardState & { lastView: DashboardView | null } {
  const url = backtestDate === null ? "/api/dashboard" : `/api/dashboard?backtest=${encodeURIComponent(backtestDate)}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [lastView, setLastView] = useState<DashboardView | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch(url, { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<DashboardView>) : Promise.reject(new Error(String(res.status)))))
        .then((view) => {
          if (cancelled) return;
          setLoaded({ url, state: { status: "ready", view, refreshFailed: false } });
          setLastView(view);
        })
        .catch(() => {
          if (cancelled) return;
          // 一度読めていれば、前の値を出したまま、読み直せなかったことを出す
          setLoaded((prev) =>
            prev?.url === url && prev.state.status === "ready"
              ? { url, state: { ...prev.state, refreshFailed: true } }
              : { url, state: { status: "error" } },
          );
        });
    void load();
    const timer = backtestDate === null ? setInterval(load, REFRESH_MS) : undefined;
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [url, backtestDate]);

  const state: DashboardState = loaded?.url === url ? loaded.state : { status: "loading" };
  return { ...state, lastView };
}
