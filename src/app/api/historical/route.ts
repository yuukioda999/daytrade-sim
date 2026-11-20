import { historicalSummary } from "@/application/market-data-service";
import { getRepositories } from "@/infrastructure/container";
import { guardRead, jsonResponse, withSafeErrors } from "../request-guard";

/** 保存している過去データの様子(銘柄ごとの本数と、取り終えた日の最初と最後) */
export async function GET(request: Request): Promise<Response> {
  const problem = guardRead(request);
  if (problem) return problem;
  return withSafeErrors(() => jsonResponse({ symbols: historicalSummary(getRepositories()) }));
}
