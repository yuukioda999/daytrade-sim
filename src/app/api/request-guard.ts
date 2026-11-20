/**
 * 設定の API を、このパソコンの画面からの呼び出しだけに絞る(ADR-0006 の補強)。
 * - Host が localhost でなければ断る(同じネットワークの別のパソコンや、DNS の付け替えによる呼び出しを防ぐ)
 * - 別のサイトの画面からの書き込みを断る(Origin と Sec-Fetch-Site を見る)
 * - 書き込みは JSON だけを受け付ける(別のサイトのフォームから送れない形にする)
 */
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function hostnameOf(host: string): string {
  // "localhost:3000" や "[::1]:3000" からホスト名だけを取る
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  return host.split(":")[0];
}

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function forbidden(): Response {
  return jsonResponse({ error: "このパソコンの画面からだけ使えます" }, 403);
}

/** 読み込み(GET)の確かめ。問題があれば返す Response、なければ null */
export function guardRead(request: Request): Response | null {
  const host = request.headers.get("host") ?? "";
  if (!LOCAL_HOSTNAMES.has(hostnameOf(host))) return forbidden();
  if (request.headers.get("sec-fetch-site") === "cross-site") return forbidden();
  return null;
}

/** 書き込み(PUT、DELETE)の確かめ。問題があれば返す Response、なければ null */
export function guardWrite(request: Request): Response | null {
  const readProblem = guardRead(request);
  if (readProblem) return readProblem;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none") return forbidden();
  const origin = request.headers.get("origin");
  if (origin !== null) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return forbidden();
    }
    if (originHost !== request.headers.get("host")) return forbidden();
  }
  if (request.method !== "DELETE" && !(request.headers.get("content-type") ?? "").startsWith("application/json")) {
    return jsonResponse({ error: "JSON で送ってください" }, 415);
  }
  return null;
}

/**
 * 本文を JSON として読む。読めない時は null。
 * JSON.parse のエラー文には本文の一部が入ることがあるので、エラーは投げず、ログにも出さない(ADR-0006)
 */
export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function badRequest(): Response {
  return jsonResponse({ error: "送られた内容を読めませんでした" }, 400);
}
