"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { ImportChunk, RangeErrors } from "@/domain/history/import-plan";
import { WATCHLIST } from "@/domain/market/symbols";
import { formatDateJa } from "./format";

type Summary = { symbol: string; barCount: number; dayCount: number; firstDate: string | null; lastDate: string | null };
type Failure = { chunk: ImportChunk; message: string };
type RunState =
  | { status: "idle" }
  | { status: "running"; done: number; total: number; current: ImportChunk }
  | { status: "finished"; total: number; done: number; saved: number; failures: Failure[]; stopped: boolean };

async function postJson(path: string, body: unknown): Promise<{ status: number; data: unknown }> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** 米国東部時間の昨日(過去データの終わりの日の上限) */
function yesterdayEastern(): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  return addDays(today, -1);
}

function chunkLabel(c: ImportChunk): string {
  return `${c.symbol} ${formatDateJa(c.from, { withYear: true })}から${formatDateJa(c.to, { withYear: true })}`;
}

function statusText(run: RunState): string {
  if (run.status === "idle") return "";
  if (run.status === "running") {
    return `${run.done} / ${run.total} 回を取得しました。今は ${chunkLabel(run.current)} を取っています`;
  }
  if (run.total === 0) return "この期間はすべて取得済みです";
  const got = run.done - run.failures.length;
  const head = run.stopped ? `止めました。残りの ${run.total - run.done} 回は取っていません(もう一度始めると続きから取ります)。` : "";
  return `${head}${got} / ${run.total} 回を取得し、新しく ${run.saved.toLocaleString("ja-JP")} 本の値動きを保存しました`;
}

/**
 * 過去データの取得(SPEC-006 AC-006-09 から 11、ADR-0008)。
 * 画面が「1銘柄の1か月分」ずつサーバーに頼み、進み具合を数える。画面を閉じると止まる
 */
export function HistoricalSection({ configured }: { configured: boolean }) {
  const fromId = useId();
  const toId = useId();
  // 初めの値: 終わりは昨日、始めはその30日前(米国東部時間)。この部品は設定を読み込んだあとに
  // ブラウザだけで描くので、サーバーで描いた値と食い違うことはない
  const [to, setTo] = useState(yesterdayEastern);
  const [from, setFrom] = useState(() => addDays(yesterdayEastern(), -30));
  const [errors, setErrors] = useState<RangeErrors>({});
  const [summary, setSummary] = useState<Summary[] | null>(null);
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const [message, setMessage] = useState<string | null>(null);
  const stopRequested = useRef(false);
  // 最後に計画した期間。「もう一度取る」は入力欄ではなく、この期間で取り直す(T8 のレビュー 9)
  const lastRange = useRef<{ from: string; to: string } | null>(null);
  // 終わった時に結果の欄へフォーカスを移す(押したボタンが消えるため。T8 のレビュー 8)
  const statusRef = useRef<HTMLParagraphElement>(null);

  // 保存している様子を読み直す合図。取得が終わるたびに増やす
  const [summaryVersion, setSummaryVersion] = useState(0);
  const loadSummary = () => setSummaryVersion((v) => v + 1);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/historical")
      .then((res) => (res.ok ? (res.json() as Promise<{ symbols: Summary[] }>) : null))
      .then((data) => {
        // 監視リストの順に並べる
        const order = (s: string) => (WATCHLIST as readonly string[]).indexOf(s);
        if (data && !cancelled) setSummary([...data.symbols].sort((a, b) => order(a.symbol) - order(b.symbol)));
      })
      // 様子の表示は取れなくても取得はできるので、ここでは何もしない
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [summaryVersion]);

  const runImport = async (range: { from: string; to: string }) => {
    setMessage(null);
    stopRequested.current = false;
    lastRange.current = range;
    let chunks: ImportChunk[];
    try {
      const { status, data } = await postJson("/api/historical/plan", range);
      if (status === 422) {
        setErrors((data as { errors: RangeErrors }).errors);
        return;
      }
      if (status !== 200) throw new Error();
      setErrors({});
      chunks = (data as { chunks: ImportChunk[] }).chunks;
    } catch {
      setMessage("取得を始められませんでした");
      return;
    }
    let saved = 0;
    let done = 0;
    const failures: Failure[] = [];
    for (const chunk of chunks) {
      if (stopRequested.current) break;
      setRun({ status: "running", done, total: chunks.length, current: chunk });
      try {
        const { status, data } = await postJson("/api/historical/import", chunk);
        const result = data as { ok: boolean; saved?: number; message?: string };
        if (status === 200 && result.ok) saved += result.saved ?? 0;
        else failures.push({ chunk, message: result.message ?? "取得できませんでした" });
      } catch {
        failures.push({ chunk, message: "サーバーに接続できませんでした" });
      }
      done++;
    }
    setRun({ status: "finished", total: chunks.length, done, saved, failures, stopped: done < chunks.length });
    loadSummary();
    requestAnimationFrame(() => statusRef.current?.focus());
  };

  const start = (e: FormEvent) => {
    e.preventDefault();
    void runImport({ from, to });
  };

  const running = run.status === "running";

  return (
    <section aria-labelledby="sec-past" className="flex flex-col gap-3 rounded-xl border bg-card p-5">
      <h2 id="sec-past" className="text-base font-semibold">
        過去データの取得
      </h2>
      <p className="text-sm text-fg-muted">
        Alpaca から4銘柄(SOXL、TQQQ、TSLL、NVDL)の5分ごとの値動き<span className="text-[11px]">(5分足)</span>を取って保存します。期間は最大1年、終わりは昨日(米国東部時間)までです。取得中にこの画面を閉じると止まります。もう一度始めると、取り終えた分を飛ばして続きから取ります。
      </p>

      {summary && summary.length > 0 && (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="保存している過去データ(横に動かせます)">
          <table className="w-full min-w-[560px] text-left text-sm tabular-nums whitespace-nowrap" data-testid="historical-summary">
            <thead>
              <tr className="border-b text-xs text-fg-muted">
                <th scope="col" className="p-2 font-medium">銘柄</th>
                <th scope="col" className="p-2 text-right font-medium">保存している値動き</th>
                <th scope="col" className="p-2 text-right font-medium">取り終えた日</th>
                <th scope="col" className="p-2 font-medium">その範囲</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.symbol} className="border-b border-muted">
                  <th scope="row" className="p-2 font-semibold">{s.symbol}</th>
                  <td className="p-2 text-right">{s.barCount.toLocaleString("ja-JP")}本</td>
                  <td className="p-2 text-right">{s.dayCount.toLocaleString("ja-JP")}日</td>
                  <td className="p-2">
                    {s.firstDate && s.lastDate
                      ? `${formatDateJa(s.firstDate, { withYear: true })}から${formatDateJa(s.lastDate, { withYear: true })}`
                      : "なし"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!configured ? (
        <p className="text-sm text-fg-sub">接続用キーを保存すると、過去データを取れます。</p>
      ) : (
        <form onSubmit={start} className="flex flex-col gap-3" noValidate>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
            <DateField id={fromId} label="始めの日" value={from} onChange={setFrom} error={errors.from} disabled={running} />
            <DateField id={toId} label="終わりの日" value={to} onChange={setTo} error={errors.to} disabled={running} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={running}
              className="min-h-11 rounded-lg bg-primary px-4 font-bold text-primary-foreground disabled:opacity-50"
            >
              過去データを取得する
            </button>
            {running && (
              <button
                type="button"
                onClick={() => {
                  stopRequested.current = true;
                }}
                className="min-h-11 rounded-lg border border-input px-4 text-fg"
              >
                止める
              </button>
            )}
          </div>
        </form>
      )}

      {run.status === "running" && (
        <progress
          className="h-2 w-full accent-[var(--color-accent)]"
          max={run.total}
          value={run.done}
          aria-label="過去データの取得の進み具合"
        />
      )}
      {/* 読み上げの欄は最初から置き、中身だけを変える(T8 のレビュー 8) */}
      <p ref={statusRef} tabIndex={-1} role="status" className="text-sm tabular-nums focus:outline-none" data-testid="historical-status">
        {statusText(run)}
      </p>
      <div role="alert">
        {run.status === "finished" && run.failures.length > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-down/50 px-3 py-2 text-sm">
            <p className="font-semibold text-down">取得できなかった期間があります。それまでに取った分は保存しています</p>
            <ul className="list-disc pl-5" data-testid="historical-failures">
              {run.failures.map((f) => (
                <li key={`${f.chunk.symbol}-${f.chunk.from}`}>
                  {chunkLabel(f.chunk)}: {f.message}
                </li>
              ))}
            </ul>
            <div>
              <button
                type="button"
                onClick={() => lastRange.current && void runImport(lastRange.current)}
                className="min-h-11 rounded-lg border border-input px-4 text-fg"
              >
                取得できなかった期間をもう一度取る
              </button>
            </div>
          </div>
        )}
      </div>
      {message && (
        <p role="alert" className="text-sm text-down">
          {message}
        </p>
      )}
    </section>
  );
}

function DateField({
  id,
  label,
  value,
  onChange,
  error,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm text-fg-sub">
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="min-h-11 w-full rounded-lg border border-input bg-surface-2 px-3 text-fg [color-scheme:dark] aria-[invalid=true]:border-down"
      />
      {error && (
        <p id={`${id}-error`} className="text-sm text-down">
          {error}
        </p>
      )}
    </div>
  );
}
