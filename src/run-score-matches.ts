import { readFile, writeFile } from "node:fs/promises";
import { rankFundingsForProfile } from "./scoring.js";
import type { ContactEnrichmentResult, CvProfile } from "./types.js";

const CV_PATH = new URL("../data/cv-profile.json", import.meta.url);
const FUNDINGS_PATH = new URL("../data/contact-enriched-fundings.json", import.meta.url);
const OUTPUT_PATH = new URL("../data/matched-companies.json", import.meta.url);

try {
  const profile = JSON.parse(await readFile(CV_PATH, "utf8")) as CvProfile;
  const contacts = JSON.parse(await readFile(FUNDINGS_PATH, "utf8")) as ContactEnrichmentResult;
  const result = rankFundingsForProfile(profile, contacts.fundings, 8);
  await writeFile(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  console.log(`✓ ${result.fundings.length} entreprises classées selon le CV.`);
  console.table(
    result.fundings.map((funding) => ({
      entreprise: funding.companyName,
      score: funding.score,
      contact: funding.contact.email ?? funding.contact.contactPageUrl ?? "non trouvé",
      justification: funding.justification,
    })),
  );
  console.log("\nRésultat complet enregistré dans data/matched-companies.json");
} catch (error) {
  console.error("Le scoring a échoué :", error);
  process.exitCode = 1;
}
