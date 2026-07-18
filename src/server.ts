import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCandidateSourcingAgent, type CandidateAgentInput } from "./agent.js";

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
// Netlify buffers JSON request bodies at 6 MB. Base64 adds about one third,
// therefore a 4 MB source PDF is the reliable cross-environment ceiling.
const MAX_REQUEST_BYTES = Math.ceil(4 * 1024 * 1024 * 1.4) + 20_000;

type AnalyzeRequest = {
  fileName?: unknown;
  mimeType?: unknown;
  fileBase64?: unknown;
  forceCache?: unknown;
};

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(payload));
}

async function readJson(request: IncomingMessage): Promise<AnalyzeRequest> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("Le fichier dépasse la limite de 4 Mo.");
    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as AnalyzeRequest;
  } catch {
    throw new Error("La requête envoyée par le navigateur est invalide.");
  }
}

async function handleAnalyze(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const input = await readJson(request);
    const result = await runCandidateSourcingAgent({
      cvFile: { fileName: text(input.fileName), mimeType: text(input.mimeType), base64: text(input.fileBase64) },
      forceCache: input.forceCache === true,
    } satisfies CandidateAgentInput);
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : "Analyse impossible." });
  }
}

async function serveStatic(urlPath: string, response: ServerResponse): Promise<void> {
  const requestedPath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = resolve(PUBLIC_DIR, `.${requestedPath}`);
  if (relative(PUBLIC_DIR, filePath).startsWith("..")) {
    sendJson(response, 403, { error: "Chemin interdit." });
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, { "content-type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    sendJson(response, 404, { error: "Page introuvable." });
  }
}

const server = createServer(async (request, response) => {
  const method = request.method ?? "GET";
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;

  if (method === "GET" && pathname === "/api/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "POST" && pathname === "/api/analyze") {
    await handleAnalyze(request, response);
    return;
  }

  if (method === "GET") {
    await serveStatic(pathname, response);
    return;
  }

  sendJson(response, 405, { error: "Méthode non autorisée." });
});

server.listen(PORT, () => {
  console.log(`GOAT your Job est prêt : http://localhost:${PORT}`);
});
