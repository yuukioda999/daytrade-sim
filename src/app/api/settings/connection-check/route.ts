import { checkConnection } from "@/application/market-data-service";
import { getMarketDataSource, getRepositories } from "@/infrastructure/container";
import { guardWrite, jsonResponse, withSafeErrors } from "../../request-guard";

/** 接続を確かめる(AC-006-05)。Alpaca へ通信するので、書き込みと同じ確かめをする */
export async function POST(request: Request): Promise<Response> {
  const problem = guardWrite(request);
  if (problem) return problem;
  return withSafeErrors(async () =>
    jsonResponse(await checkConnection(getRepositories(), getMarketDataSource(), new Date())),
  );
}
