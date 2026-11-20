"use client";

import { useEffect, useState } from "react";
import type { DashboardView } from "@/application/dashboard-service";

/** 画面を読み直す間隔(SPEC-007 決めたこと 1。データが15分遅れの5分足なので、1分ごとで足りる) */
export const REFRESH_MS = 60_000;

export type DashboardState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; view: DashboardView; refreshFailed: boolean };

/** ダッシュボードと自動売買の記録の画面の値を、自前の API から1分ごとに読み直す */
export function useDashboard(): DashboardState {
  const [state, setState] = useState<DashboardState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/dashboard", { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<DashboardView>) : Promise.reject(new Error(String(res.status)))))
        .then((view) => !cancelled && setState({ status: "ready", view, refreshFailed: false }))
        .catch(() => {
          if (cancelled) return;
          // 一度読めていれば、前の値を出したまま、読み直せなかったことを出す
          setState((prev) => (prev.status === "ready" ? { ...prev, refreshFailed: true } : { status: "error" }));
        });
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return state;
}
