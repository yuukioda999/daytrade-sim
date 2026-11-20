import { getDashboardView } from "@/application/dashboard-service";
import { getRepositories, now } from "@/infrastructure/container";
import { guardRead, jsonResponse, withSafeErrors } from "../request-guard";

/** ダッシュボードと自動売買の記録の画面に出す値(SPEC-007)。保存している足と記録から作る。外とは通信しない */
export async function GET(request: Request): Promise<Response> {
  const problem = guardRead(request);
  if (problem) return problem;
  return withSafeErrors(() => jsonResponse(getDashboardView({ repos: getRepositories() }, now())));
}
