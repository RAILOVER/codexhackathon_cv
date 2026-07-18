import { readFile, writeFile } from "node:fs/promises";
import type { MatchingResult } from "./types.js";

const INPUT_PATH = new URL("../data/matched-companies.json", import.meta.url);
const OUTPUT_PATH = new URL("../data/role1-results.json", import.meta.url);
const geographicZone = "Monde entier";

try {
  const matching = JSON.parse(await readFile(INPUT_PATH, "utf8")) as MatchingResult;
  const relevantFundings = matching.fundings.filter((funding) => funding.score > 0);
  // Keep weak matches only if fewer than five candidates matched at all.
  const selectedFundings = (relevantFundings.length >= 5 ? relevantFundings : matching.fundings).slice(0, 8);
  const companies = selectedFundings.map((funding) => ({
    companyName: funding.companyName,
    description: funding.description,
    fundingDate: funding.fundingDate,
    articleUrl: funding.articleUrl,
    websiteUrl: funding.websiteUrl,
    siren: funding.legal?.siren ?? null,
    legalForm: funding.legal?.legalForm ?? funding.legal?.legalFormCode ?? null,
    legalRepresentative: funding.legal?.legalRepresentative?.fullName ?? null,
    headquarters: funding.legal?.headquarters ?? null,
    contact: {
      email: funding.contact.email,
      contactPageUrl: funding.contact.contactPageUrl,
    },
    match: {
      score: funding.score,
      matchedSkills: funding.matchedSkills,
      justification: funding.justification,
    },
  }));

  const result = {
    geographicZone,
    selectionCount: companies.length,
    cvExtractionMethod: matching.profile.extractionMethod,
    companies,
  };

  await writeFile(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  console.log(`✓ ${companies.length} entreprises exposées pour les rôles 2 et 3.`);
  console.table(
    companies.map((company) => ({
      entreprise: company.companyName,
      score: company.match.score,
      contact: company.contact.email ?? company.contact.contactPageUrl ?? "non trouvé",
    })),
  );
  console.log("\nRésultat enregistré dans data/role1-results.json");
} catch (error) {
  console.error("L'export du rôle 1 a échoué :", error);
  process.exitCode = 1;
}
