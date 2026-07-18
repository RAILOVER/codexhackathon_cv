import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractTextFromPdf } from "./pdf-text.js";
import { runApplicationPipeline } from "./pipeline.js";

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
// Netlify buffers JSON request bodies at 6 MB. Base64 adds about one third,
// therefore a 4 MB source PDF is the reliable cross-environment ceiling.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = Math.ceil(MAX_UPLOAD_BYTES * 1.4) + 20_000;

type AnalyzeRequest = {
  fileName?: unknown;
  mimeType?: unknown;
  fileBase64?: unknown;
  motivationLetter?: unknown;
  geographicZone?: unknown;
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

async function extractCvText(input: AnalyzeRequest): Promise<string> {
  const fileName = text(input.fileName);
  const mimeType = text(input.mimeType);
  const fileBase64 = text(input.fileBase64);
  if (!fileName || !fileBase64) throw new Error("Ajoutez un CV PDF ou TXT.");

  const buffer = Buffer.from(fileBase64, "base64");
  if (buffer.length === 0 || buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error("Le CV doit faire au maximum 4 Mo.");
  }

  const isPdf = mimeType === "application/pdf" || /\.pdf$/i.test(fileName);
  const isText = mimeType === "text/plain" || /\.txt$/i.test(fileName);
  if (isPdf) return extractTextFromPdf(buffer);
  if (isText) return buffer.toString("utf8").trim();
  throw new Error("Format de CV non pris en charge : utilisez un PDF ou un fichier TXT.");
}

async function handleAnalyze(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const input = await readJson(request);
    const motivationLetter = text(input.motivationLetter);
    const geographicZone = text(input.geographicZone);
    if (!motivationLetter) throw new Error("Ajoutez votre lettre de motivation ou vos éléments de motivation.");
    if (geographicZone !== "Monde entier") {
      throw new Error("La démo est volontairement limitée à la zone « Monde entier ».");
    }

    const cvText = await extractCvText(input);
    if (cvText.length < 40) throw new Error("Le CV ne contient pas assez de texte pour lancer une analyse fiable.");

    const result = await runApplicationPipeline({
      cvText,
      motivationLetter,
      forceCache: input.forceCache === true,
    });

    sendJson(response, 200, { ...result, geographicZone, cvFileName: text(input.fileName) });
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
