import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Repositories } from "@/application/ports";
import { memoryRepositories } from "@/infrastructure/memory/memory-repositories";

// 画面のプロセスの保存先を、テストではメモリの実装に差し替える
let repos: Repositories;
vi.mock("@/infrastructure/container", () => ({ getRepositories: () => repos }));

const { GET } = await import("./route");
const { PUT: putMoney } = await import("./money/route");
const { PUT: putAutoTrading } = await import("./auto-trading/route");
const { PUT: putCredentials, DELETE: deleteCredentials } = await import("./credentials/route");

const KEY_ID = "PKTESTKEY0000000ABCD";
const SECRET = "TestSecret000000000000000000000000000Zq9X";
const BASE = "http://localhost:3000";

function request(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Request {
  const headers: Record<string, string> = { host: "localhost:3000", ...init.headers };
  if (init.body !== undefined && !("content-type" in headers)) headers["content-type"] = "application/json";
  return new Request(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  });
}

const saveKey = () =>
  putCredentials(request("/api/settings/credentials", { method: "PUT", body: { keyId: KEY_ID, secret: SECRET } }));

let logged: string[];
beforeEach(() => {
  repos = memoryRepositories();
  logged = [];
  // ログに出たものを集めて、キーが出ていないことを確かめる
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("接続用キーの API", () => {
  it("AC-006-03: 保存すると SQLite(テストではメモリ)に保存し、「設定済み」と末尾4文字だけを返す", async () => {
    const res = await saveKey();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.credentials).toEqual({ configured: true, keyIdLast4: "ABCD" });
    expect(repos.credentials.get()).toEqual({ keyId: KEY_ID, secret: SECRET });
  });

  it("AC-006-04: 設定を読み込む API の応答に、キーの全文が含まれない", async () => {
    await saveKey();
    const res = await GET(request("/api/settings"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(text).not.toContain(KEY_ID);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("Zq9X");
  });

  it("AC-006-08: 形式が違えば保存せず、どこが違うかを返す。応答とログに入力の値を出さない", async () => {
    const badSecret = "LEAKCHECK secret with spaces";
    const res = await putCredentials(
      request("/api/settings/credentials", { method: "PUT", body: { keyId: KEY_ID, secret: badSecret } }),
    );
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(JSON.parse(text).errors.secret).toContain("シークレット");
    expect(text).not.toContain("LEAKCHECK");
    expect(text).not.toContain(KEY_ID);
    expect(repos.credentials.get()).toBeNull();
    expect(logged.join("\n")).not.toContain("LEAKCHECK");
  });

  it("本文が JSON として読めない時は 400。応答とログに本文を出さない", async () => {
    const res = await putCredentials(
      // JSON.parse のエラー文は、先頭の読めない部分を含む(Unexpected token 'L', "LEAKCHECK..." is not valid JSON)
      request("/api/settings/credentials", { method: "PUT", body: `LEAKCHECK{"keyId":"${KEY_ID}"}` }),
    );
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toContain("LEAKCHECK");
    expect(text).not.toContain(KEY_ID);
    expect(logged.join("\n")).not.toContain("LEAKCHECK");
  });

  it("AC-006-06: 削除すると「未設定」になり、自動売買が止まる理由を返す", async () => {
    await saveKey();
    const res = await deleteCredentials(request("/api/settings/credentials", { method: "DELETE" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.credentials).toEqual({ configured: false, keyIdLast4: null });
    expect(body.autoTrading.blockedReason).toContain("止まっています");
    expect(repos.credentials.get()).toBeNull();
  });
});

describe("元手と為替、自動売買の API", () => {
  it("AC-006-13、14: 範囲の外は 422 で、項目ごとのエラーを返す", async () => {
    const res = await putMoney(request("/api/settings/money", { method: "PUT", body: { principal: "999", fxRate: "50" } }));
    expect(res.status).toBe(422);
    expect((await res.json()).errors).toEqual({ principal: expect.stringContaining("範囲") });
  });

  it("元手と為替を保存できる", async () => {
    const res = await putMoney(request("/api/settings/money", { method: "PUT", body: { principal: "20,000", fxRate: "155.5" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).money.current).toMatchObject({ principalJpy: 20_000, fxRate: 155.5 });
  });

  it("AC-006-01: 自動売買を OFF にできる", async () => {
    const res = await putAutoTrading(request("/api/settings/auto-trading", { method: "PUT", body: { enabled: false } }));
    expect(res.status).toBe(200);
    expect((await res.json()).autoTrading.enabled).toBe(false);
    expect(repos.settings.getAutoTradingEnabled()).toBe(false);
  });

  it("形が違う本文(enabled が文字列など)は 400", async () => {
    const res = await putAutoTrading(request("/api/settings/auto-trading", { method: "PUT", body: { enabled: "false" } }));
    expect(res.status).toBe(400);
    expect(repos.settings.getAutoTradingEnabled()).toBeNull();
  });
});

describe("このパソコンの画面からだけ使える(ADR-0006 の補強)", () => {
  it.each(["10.32.1.38:3000", "evil.example.com", "localhost.evil.example.com:3000"])(
    "Host が %s なら、読み込みも書き込みも 403",
    async (host) => {
      await saveKey();
      expect((await GET(request("/api/settings", { headers: { host } }))).status).toBe(403);
      const del = await deleteCredentials(request("/api/settings/credentials", { method: "DELETE", headers: { host } }));
      expect(del.status).toBe(403);
      expect(repos.credentials.get()).not.toBeNull();
    },
  );

  it.each(["localhost:3000", "127.0.0.1:3000", "[::1]:3000"])("Host が %s なら読み込める", async (host) => {
    expect((await GET(request("/api/settings", { headers: { host } }))).status).toBe(200);
  });

  it("別のサイトの画面からの書き込みは 403(Origin が違う)", async () => {
    const res = await putCredentials(
      request("/api/settings/credentials", {
        method: "PUT",
        body: { keyId: KEY_ID, secret: SECRET },
        headers: { origin: "https://evil.example.com" },
      }),
    );
    expect(res.status).toBe(403);
    expect(repos.credentials.get()).toBeNull();
  });

  it("別のサイトの画面からの書き込みは 403(Sec-Fetch-Site が cross-site)", async () => {
    await saveKey();
    const res = await deleteCredentials(
      request("/api/settings/credentials", { method: "DELETE", headers: { "sec-fetch-site": "cross-site" } }),
    );
    expect(res.status).toBe(403);
    expect(repos.credentials.get()).not.toBeNull();
  });

  it("同じ画面からの書き込み(Origin が同じ、same-origin)は通る", async () => {
    const res = await putCredentials(
      request("/api/settings/credentials", {
        method: "PUT",
        body: { keyId: KEY_ID, secret: SECRET },
        headers: { origin: BASE, "sec-fetch-site": "same-origin" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("JSON でない書き込み(フォームの形)は 415 で、保存しない", async () => {
    const res = await putCredentials(
      request("/api/settings/credentials", {
        method: "PUT",
        body: `keyId=${KEY_ID}&secret=${SECRET}`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
    );
    expect(res.status).toBe(415);
    expect(repos.credentials.get()).toBeNull();
  });
});
