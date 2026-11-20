import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Repositories } from "@/application/ports";
import { memoryRepositories } from "@/infrastructure/memory/memory-repositories";
import { CREDS } from "@/testing/scripted-market";

let repos: Repositories;
vi.mock("@/infrastructure/container", () => ({
  getRepositories: () => repos,
  now: () => new Date("2026-11-02T15:17:30Z"),
}));

const { GET } = await import("./route");

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/dashboard", { headers: { host: "localhost:3000", ...headers } });
}

beforeEach(() => {
  repos = memoryRepositories();
  repos.credentials.save(CREDS);
});

describe("ダッシュボードの API(T9 のセキュリティレビュー)", () => {
  it("このパソコンの画面からは読める。応答に接続用キーの全文も末尾4文字も入れない", async () => {
    const res = await GET(request());
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(text)).toMatchObject({ date: null, worker: { state: "never-started" } });
    expect(text).not.toContain(CREDS.keyId);
    expect(text).not.toContain(CREDS.secret);
    expect(text).not.toContain(CREDS.keyId.slice(-4));
  });

  it("Host が localhost でなければ断る(DNS の付け替えで別のサイトから読まれない)", async () => {
    const res = await GET(request({ host: "evil.example:3000" }));
    expect(res.status).toBe(403);
  });

  it("別のサイトの画面からの読み込みは断る", async () => {
    const res = await GET(request({ "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(403);
  });
});
