import { updateMoney } from "@/application/settings-service";
import { getRepositories } from "@/infrastructure/container";
import { badRequest, guardWrite, jsonResponse, readJsonBody } from "../../request-guard";

/** 元手と為替レートを保存する(AC-006-13、14、15) */
export async function PUT(request: Request): Promise<Response> {
  const problem = guardWrite(request);
  if (problem) return problem;
  const body = await readJsonBody(request);
  if (!body || typeof body.principal !== "string" || typeof body.fxRate !== "string") return badRequest();
  const result = updateMoney(getRepositories(), { principal: body.principal, fxRate: body.fxRate }, new Date());
  return result.ok ? jsonResponse(result.view) : jsonResponse({ errors: result.errors }, 422);
}
