import { extractTextFromPdf } from "./pdf-text.js";
import { runApplicationPipeline, type PipelineResult } from "./pipeline.js";

const MAX_CV_BYTES = 4 * 1024 * 1024;

export type CandidateAgentInput = {
  /** Use this when the calling platform already extracted text from the CV. */
  cvText?: string;
  /** Use this for a PDF or TXT uploaded by the calling platform. */
  cvFile?: {
    fileName: string;
    mimeType?: string;
    base64: string;
  };
  /** Explicitly useful for a reliable offline demo. */
  forceCache?: boolean;
};

export type CandidateAgentOutput = PipelineResult & {
  geographicZone: "Monde entier";
  cvFileName: string | null;
};

function requiredText(value: string | undefined, label: string): string {
  const text = value?.trim() ?? "";
  if (!text) throw new Error(`${label} est obligatoire.`);
  return text;
}

async function cvTextFromInput(input: CandidateAgentInput): Promise<{ text: string; fileName: string | null }> {
  if (input.cvText?.trim()) return { text: input.cvText.trim(), fileName: null };
  if (!input.cvFile) throw new Error("Ajoutez un CV PDF, TXT ou son texte extrait.");

  const fileName = requiredText(input.cvFile.fileName, "Le nom du CV");
  const buffer = Buffer.from(requiredText(input.cvFile.base64, "Le contenu du CV"), "base64");
  if (buffer.length === 0 || buffer.length > MAX_CV_BYTES) {
    throw new Error("Le CV doit faire au maximum 4 Mo.");
  }

  const isPdf = input.cvFile.mimeType === "application/pdf" || /\.pdf$/i.test(fileName);
  const isText = input.cvFile.mimeType === "text/plain" || /\.txt$/i.test(fileName);
  if (isPdf) return { text: await extractTextFromPdf(buffer), fileName };
  if (isText) return { text: buffer.toString("utf8").trim(), fileName };
  throw new Error("Format de CV non pris en charge : utilisez un PDF ou un fichier TXT.");
}

/**
 * The portable agent contract. A CLI or an API endpoint can invoke the same
 * function without depending on a website or a framework.
 */
export async function runCandidateSourcingAgent(input: CandidateAgentInput): Promise<CandidateAgentOutput> {
  const cv = await cvTextFromInput(input);
  if (cv.text.length < 40) throw new Error("Le CV ne contient pas assez de texte pour une analyse fiable.");

  const result = await runApplicationPipeline({
    cvText: cv.text,
    forceCache: input.forceCache === true,
  });

  return { ...result, geographicZone: "Monde entier", cvFileName: cv.fileName };
}
