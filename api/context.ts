import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { refreshAdminAuth } from "./queries/admin-password";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  await refreshAdminAuth();
  return { req: opts.req, resHeaders: opts.resHeaders };
}
