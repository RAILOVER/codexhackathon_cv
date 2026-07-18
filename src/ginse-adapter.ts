import { getStore } from "@netlify/blobs";
import { createHash, randomUUID } from "node:crypto";
import { compactVerify, createRemoteJWKSet, importJWK } from "jose";
import { runCandidateSourcingAgent, type CandidateAgentOutput } from "./agent.js";

const MAX_CV_TEXT_LENGTH = 100_000;
const jwks = createRemoteJWKSet(new URL("https://api.ginse.ai/.well-known/jwks.json"));
// Published Ginse invocation key. The remote JWKS remains primary so key
// rotation works; this fallback keeps verification available in a cold
// function even if a one-off JWKS fetch is unavailable.
const ginseInvocationKey = importJWK({
  kty: "OKP",
  crv: "Ed25519",
  x: "QHjetzvxsSaceb-Ud_TRd7je-TQYsjYG45jRUEJyw9Y",
  alg: "EdDSA",
  use: "sig",
});
function operationStore() {
  // Netlify attaches the Blobs environment during function invocation, so the
  // shared store must be created after the request has entered the handler.
  return getStore({ name: "ginse-goat-your-job-operations", consistency: "strong" });
}

export type GinseInput = { cvText: string };

type StoredOperation = {
  fingerprint: string;
  providerOperationId: string;
  status: "pending" | "succeeded" | "failed";
  output?: CandidateAgentOutput;
  error?: string;
};

export function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function requireGinseBearer(request: Request): Promise<void> {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/i.exec(authorization);
  if (!match) throw new Error("Missing Ginse bearer token.");

  // Ginse issues a compact Ed25519 JWS. Signature validity is the required
  // trust boundary; it is deliberately not assumed to have JWT claims.
  try {
    await compactVerify(match[1], jwks, { algorithms: ["EdDSA"] });
  } catch {
    await compactVerify(match[1], await ginseInvocationKey, { algorithms: ["EdDSA"] });
  }
}

export function parseInput(value: unknown): GinseInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Input must be a JSON object.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || typeof input.cvText !== "string") {
    throw new Error("Input must contain only cvText.");
  }
  const cvText = input.cvText.trim();
  if (cvText.length < 40 || cvText.length > MAX_CV_TEXT_LENGTH) {
    throw new Error("cvText must contain between 40 and 100000 characters.");
  }
  return { cvText };
}

function parseProviderRequest(value: unknown): GinseInput {
  // Ginse transports the marketplace input in an `input` envelope, while the
  // public schema describes the enclosed value. Retaining support for the
  // bare form also makes the endpoint easy to test directly.
  if (value && typeof value === "object" && !Array.isArray(value) && "input" in value) {
    const envelope = value as Record<string, unknown>;
    if (Object.keys(envelope).length === 1) return parseInput(envelope.input);
  }
  return parseInput(value);
}

export function validateOutput(value: CandidateAgentOutput): CandidateAgentOutput {
  if (
    !value ||
    !["live", "cache"].includes(value.sourceMode) ||
    !value.profile ||
    !Array.isArray(value.profile.skills) ||
    !Array.isArray(value.profile.jobTitles) ||
    !Array.isArray(value.profile.targetRoles) ||
    !Array.isArray(value.profile.experiences) ||
    !["heuristic", "llm"].includes(value.profile.extractionMethod) ||
    !Array.isArray(value.companies) ||
    !Array.isArray(value.warnings) ||
    value.geographicZone !== "Monde entier" ||
    !(typeof value.cvFileName === "string" || value.cvFileName === null)
  ) {
    throw new Error("Agent output did not match the advertised schema.");
  }
  for (const company of value.companies) {
    if (
      !company ||
      typeof company.name !== "string" ||
      typeof company.score !== "number" ||
      typeof company.scoreReason !== "string" ||
      !Array.isArray(company.matchedSkills) ||
      !company.contact ||
      !company.application
    ) throw new Error("Agent output did not match the advertised company schema.");
  }
  return value;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
}

function fingerprint(input: GinseInput): string {
  return createHash("sha256").update(canonicalize(input)).digest("hex");
}

function operationId(idempotencyKey: string): string {
  return `goat_${createHash("sha256").update(idempotencyKey).digest("hex")}`;
}

function operationStoreKey(providerOperationId: string): string {
  return `operations/${providerOperationId}`;
}

function statusUrl(request: Request, providerOperationId: string): string {
  const url = new URL(request.url);
  return `${url.origin}/run/status/${providerOperationId}`;
}

export async function runGinseOperation(request: Request): Promise<Response> {
  if (request.method !== "POST") return response({ error: "Use POST." }, 405);
  try {
    await requireGinseBearer(request);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Unauthorized request." }, 401);
  }

  try {
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
    if (!/^[A-Za-z0-9._-]{8,200}$/.test(idempotencyKey)) {
      return response({ error: "A valid Idempotency-Key is required." }, 400);
    }

    const input = parseProviderRequest(await request.json());
    const providerOperationId = operationId(idempotencyKey);
    const key = operationStoreKey(providerOperationId);
    const store = operationStore();
    const claimed: StoredOperation = { fingerprint: fingerprint(input), providerOperationId, status: "pending" };
    const claim = await store.setJSON(key, claimed, { onlyIfNew: true });

    if (!claim.modified) {
      const saved = await store.get(key, { type: "json", consistency: "strong" }) as StoredOperation | null;
      if (!saved || saved.fingerprint !== claimed.fingerprint) {
        return response({ error: "Idempotency-Key was already used with a different request." }, 409);
      }
      if (saved.status === "succeeded" && saved.output) {
        return response({ status: "succeeded", provider_operation_id: saved.providerOperationId, replayed: true, output: saved.output });
      }
      if (saved.status === "failed") {
        return response({ status: "failed", provider_operation_id: saved.providerOperationId, replayed: true, error: saved.error ?? "Operation failed." }, 500);
      }
      return response({ status: "pending", provider_operation_id: saved.providerOperationId, replayed: true, status_url: statusUrl(request, saved.providerOperationId) }, 202);
    }

    try {
      // The fixed Ginse action uses the project’s vetted funding snapshot so
      // every invocation completes within the marketplace verification window.
      const output = validateOutput(await runCandidateSourcingAgent({ cvText: input.cvText, forceCache: true }));
      const completed: StoredOperation = { ...claimed, status: "succeeded", output };
      await store.setJSON(key, completed, { onlyIfMatch: claim.etag });
      return response({ status: "succeeded", provider_operation_id: providerOperationId, replayed: false, output });
    } catch (error) {
      const failed: StoredOperation = {
        ...claimed,
        status: "failed",
        error: error instanceof Error ? error.message : "Operation failed.",
      };
      await store.setJSON(key, failed, { onlyIfMatch: claim.etag });
      return response({ status: "failed", provider_operation_id: providerOperationId, replayed: false, error: failed.error }, 500);
    }
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Could not process the Ginse run." }, 500);
  }
}

export async function getGinseOperation(request: Request, providerOperationId: string): Promise<Response> {
  if (request.method !== "GET") return response({ error: "Use GET." }, 405);
  try {
    await requireGinseBearer(request);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Unauthorized request." }, 401);
  }

  try {
    if (!/^goat_[a-f0-9]{64}$/.test(providerOperationId)) return response({ error: "Unknown operation." }, 404);
    const store = operationStore();
    const saved = await store.get(operationStoreKey(providerOperationId), { type: "json", consistency: "strong" }) as StoredOperation | null;
    if (!saved) return response({ error: "Unknown operation." }, 404);
    if (saved.status === "succeeded" && saved.output) {
      return response({ status: "succeeded", provider_operation_id: saved.providerOperationId, output: saved.output });
    }
    if (saved.status === "failed") return response({ status: "failed", provider_operation_id: saved.providerOperationId, error: saved.error ?? "Operation failed." }, 500);
    return response({ status: "pending", provider_operation_id: saved.providerOperationId, status_url: statusUrl(request, saved.providerOperationId) }, 202);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Could not read the Ginse run." }, 500);
  }
}
