import type { Config } from "@netlify/functions";
import { runCandidateSourcingAgent } from "../../src/agent.js";

type AgentRequest = {
  fileName?: unknown;
  mimeType?: unknown;
  fileBase64?: unknown;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** One-call API: send one CV, receive the complete tailored candidate list. */
export default async (request: Request): Promise<Response> => {
  if (request.method !== "POST") return json({ error: "Utilisez POST avec un CV PDF ou TXT." }, 405);

  try {
    const body = await request.json() as AgentRequest;
    const result = await runCandidateSourcingAgent({
      cvFile: {
        fileName: text(body.fileName),
        mimeType: text(body.mimeType),
        base64: text(body.fileBase64),
      },
    });
    return json(result);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Exécution impossible." }, 400);
  }
};

export const config: Config = {
  path: "/api/agent",
  method: ["POST"],
};
