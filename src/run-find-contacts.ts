import { readFile, writeFile } from "node:fs/promises";
import { enrichFundingsWithPublicContacts } from "./contact-finder.js";
import type { LegalEnrichmentResult } from "./types.js";

const INPUT_PATH = new URL("../data/enriched-fundings.json", import.meta.url);
const OUTPUT_PATH = new URL("../data/contact-enriched-fundings.json", import.meta.url);

try {
  const input = JSON.parse(await readFile(INPUT_PATH, "utf8")) as LegalEnrichmentResult;
  const result = await enrichFundingsWithPublicContacts(input.fundings);

  await writeFile(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  console.log(`✓ ${result.fundings.length} entreprises traitées pour les contacts publics.`);
  console.table(
    result.fundings.slice(0, 8).map((funding) => ({
      entreprise: funding.companyName,
      email: funding.contact.email ?? "non trouvé",
      page_contact: funding.contact.contactPageUrl ?? "non trouvée",
      pages_lues: funding.contact.pagesChecked.length,
    })),
  );

  if (result.warnings.length > 0) {
    console.warn("\nAvertissements :");
    for (const warning of result.warnings) console.warn(`- ${warning}`);
  }

  console.log("\nRésultat complet enregistré dans data/contact-enriched-fundings.json");
} catch (error) {
  console.error("La recherche de contacts a échoué :", error);
  process.exitCode = 1;
}
