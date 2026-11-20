"use client";

import Link from "next/link";
import { useState } from "react";
import { formatJpy } from "./format";

type Outcome = { ok: true; days: number; trades: number; principalJpy: number; fxRateX100: number };
type State =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; outcome: Outcome }
  | { status: "error"; message: string };

/** 過去データで試す(SPEC-006 AC-006-12、ADR-0010)。保存した値動きだけを使い、通信しない */
export function BacktestSection() {
  const [state, setState] = useState<State>({ status: "idle" });

  const run = async () => {
    setState({ status: "running" });
    try {
      const res = await fetch("/api/backtest", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const data = (await res.json()) as Outcome | { error?: string };
      if (res.ok && "ok" in data) setState({ status: "done", outcome: data });
      else setState({ status: "error", message: ("error" in data && data.error) || "試せませんでした" });
    } catch {
      setState({ status: "error", message: "試せませんでした。画面を読み込み直してください" });
    }
  };

  return (
    <section aria-labelledby="sec-backtest" className="flex flex-col gap-3 rounded-xl border bg-card p-5">
      <h2 id="sec-backtest" className="text-base font-semibold">
        過去データで試す
      </h2>
      <p className="text-sm text-fg-muted">
        保存している過去の値動きで、毎日の自動売買と同じルールの練習売買<span className="text-[11px]">(ペーパートレード)</span>
        を試します。4銘柄すべての値動きがある日を古い順に試し、損益を次の日に引き継ぎます。元手と為替は、この画面で最後に保存した値を使います。結果は成績の画面に、毎日の記録とは分けて出します。試すたびに、前の結果を置き換えます。通信はしません。
      </p>
      <div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={state.status === "running"}
          className="min-h-11 rounded-lg bg-primary px-4 font-bold text-primary-foreground disabled:opacity-50"
        >
          {state.status === "running" ? "試しています" : "過去データで試す"}
        </button>
      </div>
      <p role="status" className="text-sm text-up" data-testid="backtest-status">
        {state.status === "done"
          ? `${state.outcome.days}日分を試しました(練習売買 ${state.outcome.trades}回。元手 ${formatJpy(state.outcome.principalJpy)}、1ドル ${(state.outcome.fxRateX100 / 100).toFixed(2)}円)`
          : ""}
      </p>
      {state.status === "done" && (
        <Link href="/results#backtest-title" className="inline-flex min-h-11 items-center text-accent-soft">
          成績の画面で結果を見る
        </Link>
      )}
      <p role="alert" className="text-sm text-down">
        {state.status === "error" ? state.message : ""}
      </p>
    </section>
  );
}
