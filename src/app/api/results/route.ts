import { getResultsView } from "@/application/results-service";
import { getRepositories, now } from "@/infrastructure/container";
import { guardRead, jsonResponse, withSafeErrors } from "../request-guard";

/** 成績の画面に出す値(SPEC-004)。毎日ためた記録と、過去データで試した結果を分けて返す。外とは通信しない */
export async function GET(request: Request): Promise<Response> {
  const problem = guardRead(request);
  if (problem) return problem;
  return withSafeErrors(() => jsonResponse(getResultsView({ repos: getRepositories() }, now())));
}
