import { deleteCredentials, saveCredentials } from "@/application/settings-service";
import { getRepositories } from "@/infrastructure/container";
import { badRequest, guardWrite, jsonResponse, readJsonBody, withSafeErrors } from "../../request-guard";

/**
 * 接続用キーを保存する(AC-006-03、08)。
 * 応答とエラーに、送られたキーを入れない。ログにも出さない(ADR-0006)
 */
export async function PUT(request: Request): Promise<Response> {
  const problem = guardWrite(request);
  if (problem) return problem;
  const body = await readJsonBody(request);
  if (!body || typeof body.keyId !== "string" || typeof body.secret !== "string") return badRequest();
  const { keyId, secret } = body;
  return withSafeErrors(() => {
    const result = saveCredentials(getRepositories(), { keyId, secret }, new Date());
    return result.ok ? jsonResponse(result.view) : jsonResponse({ errors: result.errors }, 422);
  });
}

/** 接続用キーを消す(AC-006-06) */
export async function DELETE(request: Request): Promise<Response> {
  const problem = guardWrite(request);
  if (problem) return problem;
  return withSafeErrors(() => jsonResponse(deleteCredentials(getRepositories(), new Date())));
}
