import { readFile, writeFile } from "node:fs/promises";
import { enrichFundingsWithLegalData } from "./recherche-entreprises.js";
import type { Funding, FundingScrapeResult } from "./types.js";

const INPUT_PATH = new URL("../data/latest-fundings.json", import.meta.url);
const OUTPUT_PATH = new URL("../data/enriched-fundings.json", import.meta.url);
const geographicZone = process.argv[2]?.trim();

try {
  const input = JSON.parse(await readFile(INPUT_PATH, "utf8")) as FundingScrapeResult;
  const result = await enrichFundingsWithLegalData(input.fundings, geographicZone);

  await writeFile(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  console.log(`✓ ${result.fundings.length} entreprises enrichies légalement.`);
  if (result.geographicZone) {
    console.log(`Zone appliquée au siège social : ${result.geographicZone}`);
    console.log(`${result.excludedByGeographicZone} entreprises exclues par zone.`);
  }

  console.table(
    result.fundings.slice(0, 5).map((funding) => ({
      entreprise: funding.companyName,
      siren: funding.legal?.siren ?? "non trouvé",
      forme: funding.legal?.legalForm ?? funding.legal?.legalFormCode ?? "non trouvée",
      dirigeant: funding.legal?.legalRepresentative?.fullName ?? "non trouvé",
      ville_siege: funding.legal?.headquarters?.city ?? "non trouvée",
    })),
  );

  if (result.warnings.length > 0) {
    console.warn("\nAvertissements :");
    for (const warning of result.warnings) console.warn(`- ${warning}`);
  }

  console.log("\nRésultat complet enregistré dans data/enriched-fundings.json");
} catch (error) {
  console.error("L'enrichissement légal a échoué :", error);
  process.exitCode = 1;
}
