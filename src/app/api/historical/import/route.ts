import { importChunk } from "@/application/market-data-service";
import { getMarketDataSource, getRepositories } from "@/infrastructure/container";
import { badRequest, guardWrite, jsonResponse, readJsonBody, withSafeErrors } from "../../request-guard";

/** 1回分(1銘柄の1か月の中)を取って保存する(AC-006-09、10、11。ADR-0008) */
export async function POST(request: Request): Promise<Response> {
  const problem = guardWrite(request);
  if (problem) return problem;
  const body = await readJsonBody(request);
  if (!body || typeof body.symbol !== "string" || typeof body.from !== "string" || typeof body.to !== "string") {
    return badRequest();
  }
  const chunk = { symbol: body.symbol, from: body.from, to: body.to };
  return withSafeErrors(async () => {
    const result = await importChunk(getRepositories(), getMarketDataSource(), chunk, new Date());
    if (result.ok) return jsonResponse(result);
    // 範囲が違う、キーがない時は 422。Alpaca から取れなかった時は 502
    return jsonResponse(result, result.reason === "failed" ? 502 : 422);
  });
}
