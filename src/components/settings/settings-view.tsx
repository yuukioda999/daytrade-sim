"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/components/ui/cn";
import type { MoneyErrors, MoneyView, SettingsView as View } from "@/application/settings-service";
import type { CredentialsErrors } from "@/domain/settings/settings";
import { formatDateJa, formatEasternDateTime, formatFxRate, formatJpy } from "./format";
import { HistoricalSection } from "./historical-section";

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; view: View };

async function send<T>(path: string, method: "PUT" | "DELETE", body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as T };
}

export function SettingsView() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((res) => (res.ok ? (res.json() as Promise<View>) : Promise.reject(new Error(String(res.status)))))
      .then((view) => !cancelled && setState({ status: "ready", view }))
      .catch(() => !cancelled && setState({ status: "error" }));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto flex max-w-[880px] flex-col gap-4">
      <h1 className="text-xl font-bold">設定</h1>
      {state.status === "loading" && <p className="text-fg-sub">読み込んでいます</p>}
      {state.status === "error" && (
        <p role="alert" className="text-down">
          設定を読み込めませんでした。画面を読み込み直してください
        </p>
      )}
      {state.status === "ready" && (
        <>
          <AutoTradingSection view={state.view} onChange={(view) => setState({ status: "ready", view })} />
          <CredentialsSection view={state.view} onChange={(view) => setState({ status: "ready", view })} />
          <HistoricalSection configured={state.view.credentials.configured} />
          <MoneySection view={state.view} onChange={(view) => setState({ status: "ready", view })} />
        </>
      )}
    </div>
  );
}

type SectionProps = { view: View; onChange: (view: View) => void };

function Section({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * 保存の結果を読み上げる欄。成功(status)と失敗(alert)の欄を最初から別々に置き、中身だけを入れ替える
 * (role を途中で変えると、読み上げソフトによっては読まれないため。T7 のレビュー 9)
 */
function Message({ message }: { message: { kind: "ok" | "error"; text: string } | null }) {
  return (
    <div className="min-h-5 text-sm">
      <p role="status" className="text-up">
        {message?.kind === "ok" ? message.text : ""}
      </p>
      <p role="alert" className="text-down">
        {message?.kind === "error" ? message.text : ""}
      </p>
    </div>
  );
}

/** 保存できなかった時に、最初のエラーの入力欄へフォーカスを移す */
function useFocusFirstError(errors: Record<string, string | undefined>, refs: [string, RefObject<HTMLInputElement | null>][]) {
  const [token, setToken] = useState(0);
  useEffect(() => {
    if (token === 0) return;
    for (const [key, ref] of refs) {
      if (errors[key]) {
        ref.current?.focus();
        return;
      }
    }
    // token が変わった時だけ動かす(errors と refs は同じ描画で決まる)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  return () => setToken((t) => t + 1);
}

function AutoTradingSection({ view, onChange }: SectionProps) {
  const id = useId();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { budgetJpy, dailyLossLimitJpy } = view.limits;

  const toggle = async (enabled: boolean) => {
    setMessage(null);
    // 送っている間はスイッチを押せなくし、送った順と反映する順がずれないようにする
    setBusy(true);
    try {
      const { status, data } = await send<View>("/api/settings/auto-trading", "PUT", { enabled });
      if (status !== 200) throw new Error();
      onChange(data);
      setMessage({ kind: "ok", text: enabled ? "自動売買を ON にしました" : "自動売買を OFF にしました" });
    } catch {
      setMessage({ kind: "error", text: "保存できませんでした" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section id="sec-auto" title="自動売買">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="flex min-h-11 flex-1 cursor-pointer items-center">
          自動で練習売買をする
        </label>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="w-8 text-right text-sm font-semibold text-fg-sub">
            {view.autoTrading.enabled ? "ON" : "OFF"}
          </span>
          <Switch id={id} checked={view.autoTrading.enabled} disabled={busy} onCheckedChange={toggle} />
        </div>
      </div>
      <p className="text-sm text-fg-muted">
        買いサインが出ると、アプリが自動で練習売買<span className="text-[11px]">(ペーパートレード)</span>を記録します。実際の注文は出しません。OFF にすると新しく買いませんが、持っている株の売りの判定は続けます。
      </p>
      {view.autoTrading.blockedReason && (
        <p className="rounded-lg border border-warn/40 bg-warn/15 px-3 py-2 text-sm text-fg" data-testid="auto-trading-blocked">
          {view.autoTrading.blockedReason}
        </p>
      )}
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
        <div className="rounded-lg bg-surface-2 px-3 py-2.5">
          <dt className="text-xs text-fg-muted">1回の買いに使う金額</dt>
          <dd className="font-semibold tabular-nums" data-testid="budget">
            元手の50%まで({formatJpy(budgetJpy)})
          </dd>
        </div>
        <div className="rounded-lg bg-surface-2 px-3 py-2.5">
          <dt className="text-xs text-fg-muted">
            今日の損失の上限 <span className="text-[11px]">(デイリー損失リミット)</span>
          </dt>
          <dd className="font-semibold tabular-nums" data-testid="daily-loss-limit">
            元手の10%({formatJpy(dailyLossLimitJpy)})
          </dd>
        </div>
      </dl>
      <p className="text-xs text-fg-muted">この2つは決まったルールのため、設定では変えられません。</p>
      <Message message={message} />
    </Section>
  );
}

function CredentialsSection({ view, onChange }: SectionProps) {
  const keyIdId = useId();
  const secretId = useId();
  const [keyId, setKeyId] = useState("");
  const [secret, setSecret] = useState("");
  const [errors, setErrors] = useState<CredentialsErrors>({});
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { configured, keyIdLast4 } = view.credentials;
  const keyIdRef = useRef<HTMLInputElement>(null);
  const secretRef = useRef<HTMLInputElement>(null);
  const focusFirstError = useFocusFirstError(errors, [
    ["keyId", keyIdRef],
    ["secret", secretRef],
  ]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setBusy(true);
    try {
      const { status, data } = await send<View | { errors: CredentialsErrors }>("/api/settings/credentials", "PUT", {
        keyId,
        secret,
      });
      if (status === 422 && "errors" in data) {
        setErrors(data.errors);
        setMessage({ kind: "error", text: "保存していません。入力を確かめてください" });
        focusFirstError();
      } else if (status === 200 && !("errors" in data)) {
        setErrors({});
        // 保存したキーは、画面の入力欄にも残さない
        setKeyId("");
        setSecret("");
        onChange(data);
        setMessage({ kind: "ok", text: "接続用キーを保存しました" });
      } else {
        throw new Error();
      }
    } catch {
      setMessage({ kind: "error", text: "保存できませんでした" });
    } finally {
      setBusy(false);
    }
  };

  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const checkConnection = async () => {
    setCheck(null);
    setChecking(true);
    try {
      const res = await fetch("/api/settings/connection-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const data = (await res.json()) as
        | { ok: true; symbol: string; barStart: string; close: number }
        | { ok: false; message: string };
      if (!res.ok) throw new Error();
      setCheck(
        data.ok
          ? {
              kind: "ok",
              text: `接続できました。${data.symbol} の最新の5分足: ${formatEasternDateTime(data.barStart)}(米国東部時間)、終値 $${data.close.toFixed(2)}`,
            }
          : { kind: "error", text: data.message },
      );
    } catch {
      setCheck({ kind: "error", text: "接続を確かめられませんでした" });
    } finally {
      setChecking(false);
    }
  };

  const remove = async () => {
    setMessage(null);
    setBusy(true);
    try {
      const { status, data } = await send<View>("/api/settings/credentials", "DELETE");
      if (status !== 200) throw new Error();
      onChange(data);
      setMessage({ kind: "ok", text: "接続用キーを削除しました" });
    } catch {
      setMessage({ kind: "error", text: "削除できませんでした" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      id="sec-live"
      title="実際の市場データ"
      aside={
        <span
          data-testid="credentials-status"
          className={cn(
            "rounded-md px-2 py-0.5 text-xs font-bold",
            configured ? "bg-up/15 text-up" : "bg-muted text-fg-sub",
          )}
        >
          {configured ? `設定済み(キー ID の末尾 ${keyIdLast4})` : "未設定"}
        </span>
      }
    >
      <p className="text-sm text-fg-muted">
        株価(15分遅れ)を受け取るための、Alpaca の接続用キーです。Alpaca の画面で作ったキー ID とシークレットを貼り付けてください。
      </p>
      <form onSubmit={save} className="flex flex-col gap-3" noValidate>
        <Field id={keyIdId} label="キー ID" error={errors.keyId}>
          <input
            ref={keyIdRef}
            id={keyIdId}
            name="keyId"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={keyId}
            onChange={(e) => setKeyId(e.target.value)}
            aria-invalid={errors.keyId ? true : undefined}
            aria-describedby={errors.keyId ? `${keyIdId}-error` : undefined}
            className={inputClass}
          />
        </Field>
        <Field id={secretId} label="シークレット" error={errors.secret}>
          <input
            ref={secretRef}
            id={secretId}
            name="secret"
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            aria-invalid={errors.secret ? true : undefined}
            aria-describedby={errors.secret ? `${secretId}-error` : undefined}
            className={inputClass}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy} className={primaryButtonClass}>
            {configured ? "キーを置き換えて保存" : "キーを保存"}
          </button>
          {configured && (
            <button type="button" disabled={busy || checking} onClick={checkConnection} className={secondaryButtonClass}>
              {checking ? "確かめています" : "接続を確かめる"}
            </button>
          )}
          {configured && (
            <button type="button" disabled={busy} onClick={remove} className={secondaryButtonClass}>
              キーを削除
            </button>
          )}
        </div>
      </form>
      {configured && (
        <div data-testid="connection-check-result">
          <Message message={check} />
        </div>
      )}
      <p className="text-xs text-fg-muted">
        キーはこのパソコンの中(data フォルダ)にだけ保存し、画面にはキー ID の末尾4文字だけを出します。シークレットは画面に出しません。
      </p>
      <Message message={message} />
    </Section>
  );
}

function moneyText(m: MoneyView): string {
  return `元手 ${formatJpy(m.principalJpy)}、為替レート ${formatFxRate(m.fxRate)}円`;
}

function MoneySection({ view, onChange }: SectionProps) {
  const principalId = useId();
  const fxId = useId();
  const { current, scheduled } = view.money;
  const base = scheduled ?? current;
  const [principal, setPrincipal] = useState(base.principalJpy.toLocaleString("ja-JP"));
  const [fxRate, setFxRate] = useState(formatFxRate(base.fxRate));
  const [errors, setErrors] = useState<MoneyErrors>({});
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const principalRef = useRef<HTMLInputElement>(null);
  const fxRef = useRef<HTMLInputElement>(null);
  const focusFirstError = useFocusFirstError(errors, [
    ["principal", principalRef],
    ["fxRate", fxRef],
  ]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setBusy(true);
    try {
      const { status, data } = await send<View | { errors: MoneyErrors } | { error: string }>("/api/settings/money", "PUT", {
        principal,
        fxRate,
      });
      if (status === 422 && "errors" in data) {
        setErrors(data.errors);
        setMessage({ kind: "error", text: "保存していません。入力を確かめてください" });
        focusFirstError();
      } else if (status === 503 && "error" in data && typeof data.error === "string") {
        // 休場日の表が古くて、次の取引日を決められない時
        setMessage({ kind: "error", text: data.error });
      } else if (status === 200 && "money" in data) {
        setErrors({});
        onChange(data);
        const s = data.money.scheduled;
        setMessage({
          kind: "ok",
          text: s ? `保存しました。${formatDateJa(s.effectiveDate)}から使います` : "保存しました。今日から使います",
        });
      } else {
        throw new Error();
      }
    } catch {
      setMessage({ kind: "error", text: "保存できませんでした" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section id="sec-money" title="元手と為替">
      <dl className="flex flex-col gap-1 rounded-lg bg-surface-2 px-3 py-2.5 text-sm">
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-fg-muted">今使っている値</dt>
          <dd className="tabular-nums" data-testid="money-current">
            {moneyText(current)}
          </dd>
        </div>
        {scheduled && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-fg-muted">{formatDateJa(scheduled.effectiveDate)}から</dt>
            <dd className="tabular-nums" data-testid="money-scheduled">
              {moneyText(scheduled)}
            </dd>
          </div>
        )}
      </dl>
      <form onSubmit={save} className="flex flex-col gap-3" noValidate>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
          <Field id={principalId} label="元手(円)" note="元本。1,000 から 10,000,000 の整数" error={errors.principal}>
            <input
              ref={principalRef}
              id={principalId}
              name="principal"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={principal}
              onChange={(e) => setPrincipal(e.target.value)}
              aria-invalid={errors.principal ? true : undefined}
              aria-describedby={`${principalId}-note${errors.principal ? ` ${principalId}-error` : ""}`}
              className={inputClass}
            />
          </Field>
          <Field id={fxId} label="為替レート(1ドルあたりの円)" note="50 から 300。小数2桁まで" error={errors.fxRate}>
            <input
              ref={fxRef}
              id={fxId}
              name="fxRate"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={fxRate}
              onChange={(e) => setFxRate(e.target.value)}
              aria-invalid={errors.fxRate ? true : undefined}
              aria-describedby={`${fxId}-note${errors.fxRate ? ` ${fxId}-error` : ""}`}
              className={inputClass}
            />
          </Field>
        </div>
        <div>
          <button type="submit" disabled={busy} className={primaryButtonClass}>
            元手と為替を保存
          </button>
        </div>
      </form>
      <p className="text-xs text-fg-muted">
        変えた値は、次の取引日から使います(1日の途中で計算の前提が変わらないようにするため)。初めて保存する時だけ、今日から使います。為替レートは自動では更新されません。
      </p>
      <Message message={message} />
    </Section>
  );
}

function Field({
  id,
  label,
  note,
  error,
  children,
}: {
  id: string;
  label: string;
  note?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm text-fg-sub">
        {label}
      </label>
      {children}
      {note && (
        <p id={`${id}-note`} className="text-xs text-fg-muted">
          {note}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-down">
          {error}
        </p>
      )}
    </div>
  );
}

const inputClass =
  "min-h-11 w-full rounded-lg border border-input bg-surface-2 px-3 text-fg aria-[invalid=true]:border-down";
const primaryButtonClass =
  "min-h-11 rounded-lg bg-primary px-4 font-bold text-primary-foreground disabled:opacity-50";
const secondaryButtonClass = "min-h-11 rounded-lg border border-input px-4 text-fg disabled:opacity-50";
