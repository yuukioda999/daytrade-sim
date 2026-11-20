import { BACKTEST_NO_DATA_MESSAGE, runBacktest } from "@/application/backtest-service";
import { getRepositories, now } from "@/infrastructure/container";
import { guardWrite, jsonResponse, withSafeErrors } from "../request-guard";

/** 過去データで試す(SPEC-006 AC-006-12、ADR-0010)。保存した足だけを使い、外とは通信しない */
export async function POST(request: Request): Promise<Response> {
  const problem = guardWrite(request);
  if (problem) return problem;
  return withSafeErrors(() => {
    const result = runBacktest({ repos: getRepositories() }, now());
    return result.ok ? jsonResponse(result) : jsonResponse({ error: BACKTEST_NO_DATA_MESSAGE }, 422);
  });
}
