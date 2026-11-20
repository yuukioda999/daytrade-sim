import { planHistoricalImport } from "@/application/market-data-service";
import { getRepositories } from "@/infrastructure/container";
import { badRequest, guardWrite, jsonResponse, readJsonBody, withSafeErrors } from "../../request-guard";

/** 期間から、まだ取っていない範囲の一覧を返す(AC-006-09、11。ADR-0008) */
export async function POST(request: Request): Promise<Response> {
  const problem = guardWrite(request);
  if (problem) return problem;
  const body = await readJsonBody(request);
  if (!body || typeof body.from !== "string" || typeof body.to !== "string") return badRequest();
  const range = { from: body.from, to: body.to };
  return withSafeErrors(() => {
    const result = planHistoricalImport(getRepositories(), range, new Date());
    return result.ok ? jsonResponse({ chunks: result.chunks }) : jsonResponse({ errors: result.errors }, 422);
  });
}
