import { readFile, writeFile } from "node:fs/promises";
import { extractCvProfileHeuristically } from "./cv-profile.js";

const inputPath = process.argv[2] ?? "data/sample-cv.txt";
const OUTPUT_PATH = new URL("../data/cv-profile.json", import.meta.url);

try {
  const cvText = await readFile(inputPath, "utf8");
  const profile = extractCvProfileHeuristically(cvText);
  await writeFile(OUTPUT_PATH, `${JSON.stringify(profile, null, 2)}\n`, "utf8");

  console.log(`✓ CV structuré avec la méthode ${profile.extractionMethod}.`);
  console.log(JSON.stringify(profile, null, 2));
  console.log("\nProfil enregistré dans data/cv-profile.json");
} catch (error) {
  console.error("L'extraction du CV a échoué :", error);
  process.exitCode = 1;
}
