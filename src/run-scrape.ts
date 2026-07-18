import { mkdir, writeFile } from "node:fs/promises";
import { scrapeRecentFundings } from "./maddyness.js";

const OUTPUT_PATH = new URL("../data/latest-fundings.json", import.meta.url);

try {
  const result = await scrapeRecentFundings({ maxFundings: 15, maxRecaps: 3 });

  await mkdir(new URL("../data/", import.meta.url), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  console.log(`✓ ${result.fundings.length} entreprises récupérées depuis Maddyness.`);
  console.log("\nLes 5 premières entrées :");
  console.table(
    result.fundings.slice(0, 5).map((funding) => ({
      entreprise: funding.companyName,
      date: funding.fundingDate,
      site: funding.websiteUrl ?? "non renseigné",
      description: funding.description.slice(0, 100),
    })),
  );

  if (result.warnings.length > 0) {
    console.warn("\nAvertissements :");
    for (const warning of result.warnings) console.warn(`- ${warning}`);
  }

  console.log("\nRésultat complet enregistré dans data/latest-fundings.json");
} catch (error) {
  console.error("Le scraping a échoué :", error);
  process.exitCode = 1;
}
