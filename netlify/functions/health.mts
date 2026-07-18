import type { Config } from "@netlify/functions";

/** Lightweight public probe for the deployed GOAT your Job agent. */
export default async (): Promise<Response> =>
  new Response(
    JSON.stringify({
      ok: true,
      service: "GOAT your Job agent",
      action: "POST /api/agent",
      input: "CV PDF or TXT encoded as base64",
      output: "ranked funded companies with public contacts and tailored application packs",
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );

export const config: Config = {
  path: "/api/health",
  method: ["GET"],
};
