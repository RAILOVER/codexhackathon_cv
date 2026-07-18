import type { Config } from "@netlify/functions";
import { extractTextFromPdf } from "../../src/pdf-text.js";
import { runApplicationPipeline } from "../../src/pipeline.js";

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

type AnalyzeRequest = {
  fileName?: unknown;
  mimeType?: unknown;
  fileBase64?: unknown;
  motivationLetter?: unknown;
  geographicZone?: unknown;
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

async function extractCvText(input: AnalyzeRequest): Promise<string> {
  const fileName = text(input.fileName);
  const mimeType = text(input.mimeType);
  const fileBase64 = text(input.fileBase64);
  if (!fileName || !fileBase64) throw new Error("Ajoutez un CV PDF ou TXT.");

  const buffer = Buffer.from(fileBase64, "base64");
  if (buffer.length === 0 || buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error("Le CV doit faire au maximum 4 Mo.");
  }

  if (mimeType === "application/pdf" || /\.pdf$/i.test(fileName)) return extractTextFromPdf(buffer);
  if (mimeType === "text/plain" || /\.txt$/i.test(fileName)) return buffer.toString("utf8").trim();
  throw new Error("Format de CV non pris en charge : utilisez un PDF ou un fichier TXT.");
}

export default async (request: Request): Promise<Response> => {
  if (request.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);

  try {
    const input = (await request.json()) as AnalyzeRequest;
    const motivationLetter = text(input.motivationLetter);
    if (!motivationLetter) throw new Error("Ajoutez votre lettre de motivation ou vos éléments de motivation.");
    if (text(input.geographicZone) !== "Monde entier") {
      throw new Error("La démo est volontairement limitée à la zone « Monde entier ».");
    }

    const cvText = await extractCvText(input);
    if (cvText.length < 40) throw new Error("Le CV ne contient pas assez de texte pour lancer une analyse fiable.");

    const result = await runApplicationPipeline({
      cvText,
      motivationLetter,
      forceCache: input.forceCache === true,
    });

    return json({ ...result, geographicZone: "Monde entier", cvFileName: text(input.fileName) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Analyse impossible." }, 400);
  }
};

export const config: Config = {
  path: "/api/analyze",
};
