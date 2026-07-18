import { PDFParse } from "pdf-parse";

const MIN_EXTRACTED_CHARACTERS = 40;

/**
 * Extracts selectable text from a PDF CV. Scanned/image-only PDFs deliberately
 * fail with a clear error: inventing a profile from an unreadable CV would make
 * the matching and generated applications unreliable.
 */
export async function extractTextFromPdf(pdf: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(pdf) });

  try {
    const result = (await parser.getText()) as { text?: string };
    const text = result.text?.replace(/\s+/g, " ").trim() ?? "";

    if (text.length < MIN_EXTRACTED_CHARACTERS) {
      throw new Error(
        "Le PDF ne contient pas assez de texte sélectionnable. Utilisez un PDF exporté depuis un traitement de texte, ou un fichier TXT.",
      );
    }

    return text;
  } finally {
    await parser.destroy();
  }
}
