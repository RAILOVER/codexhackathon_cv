import type { Config } from "@netlify/functions";
import { runCandidateSourcingAgent, type CandidateAgentInput } from "../../src/agent.js";

type AnalyzeRequest = {
  fileName?: unknown;
  mimeType?: unknown;
  fileBase64?: unknown;
  forceCache?: unknown;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export default async (request: Request): Promise<Response> => {
  if (request.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);

  try {
    const input = (await request.json()) as AnalyzeRequest;
    const result = await runCandidateSourcingAgent({
      cvFile: { fileName: text(input.fileName), mimeType: text(input.mimeType), base64: text(input.fileBase64) },
      forceCache: input.forceCache === true,
    } satisfies CandidateAgentInput);
    return json(result);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Analyse impossible." }, 400);
  }
};

export const config: Config = {
  path: "/api/analyze",
};
