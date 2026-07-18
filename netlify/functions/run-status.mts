import type { Config } from "@netlify/functions";
import { getGinseOperation } from "../../src/ginse-adapter.js";

export default async (request: Request): Promise<Response> => {
  const providerOperationId = new URL(request.url).pathname.split("/").filter(Boolean).at(-1) ?? "";
  return getGinseOperation(request, providerOperationId);
};

export const config: Config = { path: "/run/status/:operationId", method: ["GET"] };
