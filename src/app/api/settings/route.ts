import { getSettingsView } from "@/application/settings-service";
import { getRepositories } from "@/infrastructure/container";
import { guardRead, jsonResponse, withSafeErrors } from "../request-guard";

/** 設定を読み込む(AC-006-04: 接続用キーの全文は返さない) */
export async function GET(request: Request): Promise<Response> {
  const problem = guardRead(request);
  if (problem) return problem;
  return withSafeErrors(() => jsonResponse(getSettingsView(getRepositories(), new Date())));
}
