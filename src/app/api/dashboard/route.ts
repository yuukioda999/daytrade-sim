import { getBacktestDashboardView, getDashboardView } from "@/application/dashboard-service";
import { getRepositories, now } from "@/infrastructure/container";
import { guardRead, jsonResponse, withSafeErrors } from "../request-guard";

/**
 * ダッシュボードと自動売買の記録の画面に出す値(SPEC-007)。保存している足と記録から作る。外とは通信しない。
 * ?backtest=YYYY-MM-DD なら、過去データで試したその日の値(AC-007-18)
 */
export async function GET(request: Request): Promise<Response> {
  const problem = guardRead(request);
  if (problem) return problem;
  const date = new URL(request.url).searchParams.get("backtest");
  if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return jsonResponse({ error: "日付の形が正しくありません" }, 400);
  return withSafeErrors(() => {
    const repos = getRepositories();
    if (date === null) return jsonResponse(getDashboardView({ repos }, now()));
    const view = getBacktestDashboardView({ repos }, now(), date);
    return view ? jsonResponse(view) : jsonResponse({ error: "その日は過去データで試していません" }, 404);
  });
}
