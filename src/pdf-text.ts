const MIN_EXTRACTED_CHARACTERS = 40;

/**
 * Keep the document's logical lines.  CVs routinely use headings, bullets and
 * two-column layouts; flattening every whitespace character makes it
 * impossible for the profile parser to distinguish a skill list from an
 * experience description.
 */
function preservePdfLines(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/[\t\f\v ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

/**
 * Extracts selectable text from a PDF CV. Scanned/image-only PDFs deliberately
 * fail with a clear error: inventing a profile from an unreadable CV would make
 * the matching and generated applications unreliable.
 */
export async function extractTextFromPdf(pdf: Buffer): Promise<string> {
  // `pdf-parse` loads PDF.js, which expects DOM globals unavailable in a
  // Netlify function. Loading it only for real PDF inputs keeps text-only
  // Ginse runs and the authorization gate available at cold start.
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(pdf) });

  try {
    const result = (await parser.getText()) as { text?: string };
    const text = preservePdfLines(result.text ?? "");

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
