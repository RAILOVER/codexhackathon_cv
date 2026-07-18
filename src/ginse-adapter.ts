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
    return parseInput(envelope.input);
  }
  return parseInput(value);
}

function providerIdempotencyKey(request: Request, body: unknown): string {
  const envelope = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const headerKey = request.headers.get("idempotency-key")?.trim()
    ?? request.headers.get("x-idempotency-key")?.trim()
    ?? request.headers.get("x-ginse-idempotency-key")?.trim();
  if (headerKey) return headerKey;
  const bodyKey = envelope.idempotency_key ?? envelope.idempotencyKey;
  return typeof bodyKey === "string" ? bodyKey.trim() : "";
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

function operationId(): string {
  return `goat_${randomUUID().replace(/-/g, "")}`;
}

function operationStoreKey(providerOperationId: string): string {
  return `operations-v7/${providerOperationId}`;
}

function idempotencyStoreKey(idempotencyKey: string): string {
  return `idempotency-v7/${createHash("sha256").update(idempotencyKey).digest("hex")}`;
}

function statusUrl(request: Request, providerOperationId: string): string {
  const url = new URL(request.url);
  return `${url.origin}/run/status/${providerOperationId}`;
}

async function waitForTerminalOperation(key: string, initial: StoredOperation): Promise<StoredOperation> {
  let current = initial;
  // This action is synchronous. A duplicate that reaches another Netlify
  // replica while the first call is finishing waits for that durable result
  // instead of starting a second run or returning a different payload.
  for (let attempt = 0; current.status === "pending" && attempt < 80; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const next = await operationStore().get(key, { type: "json", consistency: "strong" }) as StoredOperation | null;
    if (!next) break;
    current = next;
  }
  return current;
}

export async function runGinseOperation(request: Request): Promise<Response> {
  if (request.method !== "POST") return response({ error: "Use POST." }, 405);
  try {
    await requireGinseBearer(request);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Unauthorized request." }, 401);
  }

  try {
    const body = await request.json();
    const idempotencyKey = providerIdempotencyKey(request, body);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/.test(idempotencyKey)) {
      return response({ error: "A valid Idempotency-Key is required." }, 400);
    }

    const input = parseProviderRequest(body);
    const store = operationStore();
    const requestFingerprint = fingerprint(input);
    const bindingKey = idempotencyStoreKey(idempotencyKey);
    const binding: Pick<StoredOperation, "fingerprint" | "providerOperationId"> = {
      fingerprint: requestFingerprint,
      providerOperationId: operationId(),
    };
    const bindingClaim = await store.set(bindingKey, JSON.stringify(binding), { onlyIfNew: true });
    let providerOperationId = binding.providerOperationId;
    if (!bindingClaim.modified) {
      const savedBinding = await store.get(bindingKey, { type: "json", consistency: "strong" }) as Pick<StoredOperation, "fingerprint" | "providerOperationId"> | null;
      if (!savedBinding || savedBinding.fingerprint !== requestFingerprint) {
        return response({ error: "Idempotency-Key was already used with a different request." }, 409);
      }
      providerOperationId = savedBinding.providerOperationId;
    }

    const key = operationStoreKey(providerOperationId);
    const claimed: StoredOperation = { fingerprint: requestFingerprint, providerOperationId, status: "pending" };
    const claim = await store.set(key, JSON.stringify(claimed), { onlyIfNew: true });

    if (!claim.modified) {
      const found = await store.get(key, { type: "json", consistency: "strong" }) as StoredOperation | null;
      const saved = found ? await waitForTerminalOperation(key, found) : null;
      if (!saved) return response({ error: "Could not load the claimed operation." }, 500);
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
      const write = await store.set(key, JSON.stringify(completed), { onlyIfMatch: claim.etag });
      if (!write.modified) throw new Error("Could not persist the completed operation.");
      return response({ status: "succeeded", provider_operation_id: providerOperationId, replayed: false, output });
    } catch (error) {
      const failed: StoredOperation = {
        ...claimed,
        status: "failed",
        error: error instanceof Error ? error.message : "Operation failed.",
      };
      await store.set(key, JSON.stringify(failed), { onlyIfMatch: claim.etag });
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
