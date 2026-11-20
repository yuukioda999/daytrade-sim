import { setAutoTrading } from "@/application/settings-service";
import { getRepositories } from "@/infrastructure/container";
import { badRequest, guardWrite, jsonResponse, readJsonBody } from "../../request-guard";

/** 自動売買の ON / OFF を保存する(AC-006-01) */
export async function PUT(request: Request): Promise<Response> {
  const problem = guardWrite(request);
  if (problem) return problem;
  const body = await readJsonBody(request);
  if (!body || typeof body.enabled !== "boolean") return badRequest();
  return jsonResponse(setAutoTrading(getRepositories(), body.enabled, new Date()));
}
