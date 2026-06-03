import type { NextRequest } from "next/server";
import { proxyAuthToApi } from "../../../lib/auth-proxy";

type RouteContext = { params: Promise<{ path?: string[] }> };

async function handle(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxyAuthToApi(request, path ?? []);
}

export const GET = handle;
export const POST = handle;
