import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractCvProfile } from "./cv-profile.js";
import { findPublicContact } from "./contact-finder.js";
import { generateApplicationWithLlm, type GeneratedApplication } from "./generation.js";
import { scrapeRecentFundings } from "./maddyness.js";
import { enrichFundingsWithLegalData } from "./recherche-entreprises.js";
import { rankFundingsForProfile } from "./scoring.js";
import type { ContactEnrichedFunding, CvProfile, LegalCompany, PublicContact, ScoredFunding } from "./types.js";

const ROLE1_CACHE_PATHS = [
  fileURLToPath(new URL("../data/role1-results.json", import.meta.url)),
  resolve(process.cwd(), "data/role1-results.json"),
];
const MAX_RESULTS = 6;

type CachedCompany = {
  companyName?: string;
  description?: string;
  fundingDate?: string | null;
  articleUrl?: string;
  websiteUrl?: string | null;
  siren?: string | null;
  legalForm?: string | null;
  legalRepresentative?: string | null;
  headquarters?: LegalCompany["headquarters"];
  contact?: { email?: string | null; contactPageUrl?: string | null };
};

type CachedRole1Result = { companies?: CachedCompany[] };

export type DemoCompany = {
  name: string;
  description: string;
  fundingDate: string | null;
  articleUrl: string;
  websiteUrl: string | null;
  legalRepresentative: string | null;
  legalForm: string | null;
  siren: string | null;
  contact: { type: "email" | "url" | "unavailable"; value: string | null };
  score: number;
  scoreReason: string;
  matchedSkills: string[];
  generationMode: "ai" | "fallback";
  application: GeneratedApplication;
};

export type PipelineResult = {
  sourceMode: "live" | "cache";
  profile: CvProfile;
  companies: DemoCompany[];
  warnings: string[];
};

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function emptyContact(): PublicContact {
  return { email: null, emailsFound: [], contactPageUrl: null, pagesChecked: [] };
}

function toLegalCompany(company: CachedCompany): LegalCompany | null {
  const siren = asText(company.siren);
  if (!siren) return null;

  const representative = asText(company.legalRepresentative);
  return {
    siren,
    legalFormCode: null,
    legalForm: asText(company.legalForm),
    legalRepresentative: representative ? { fullName: representative, role: null } : null,
    headquarters: company.headquarters ?? null,
  };
}

function toCachedFunding(company: CachedCompany): ContactEnrichedFunding | null {
  const companyName = asText(company.companyName);
  const articleUrl = asText(company.articleUrl);
  const description = asText(company.description);
  if (!companyName || !articleUrl || !description) return null;

  return {
    companyName,
    description,
    fundingDate: asText(company.fundingDate),
    articleUrl,
    companyProfileUrl: articleUrl,
    websiteUrl: asText(company.websiteUrl),
    legal: toLegalCompany(company),
    contact: {
      email: asText(company.contact?.email),
      emailsFound: asText(company.contact?.email) ? [company.contact!.email!.trim()] : [],
      contactPageUrl: asText(company.contact?.contactPageUrl),
      pagesChecked: [],
    },
  };
}

async function fallbackFundings(): Promise<ContactEnrichedFunding[]> {
  for (const path of ROLE1_CACHE_PATHS) {
    try {
      const raw = JSON.parse(await readFile(path, "utf8")) as CachedRole1Result;
      const fundings = (raw.companies ?? []).map(toCachedFunding).filter((company): company is ContactEnrichedFunding => company !== null);
      if (fundings.length > 0) return fundings;
    } catch {
      // Try the other deployment-aware cache location.
    }
  }

  throw new Error("Le cache de démonstration est indisponible.");
}

async function lookupContacts(fundings: ScoredFunding[]): Promise<ContactEnrichedFunding[]> {
  return Promise.all(
    fundings.map(async (funding) => {
      try {
        return { ...funding, contact: await findPublicContact(funding.websiteUrl) };
      } catch {
        return { ...funding, contact: funding.contact };
      }
    }),
  );
}

async function loadLiveFundings(profile: CvProfile): Promise<{ fundings: ContactEnrichedFunding[]; warnings: string[] }> {
  // Six final matches are shown. Ten recent candidates keep the synchronous
  // Netlify request comfortably within the hosting execution time.
  const scraped = await scrapeRecentFundings({ maxFundings: 10, maxRecaps: 2 });
  // "Monde entier" deliberately means no headquarters filter in the demo.
  const legal = await enrichFundingsWithLegalData(scraped.fundings);
  const withoutContacts = legal.fundings.map((funding) => ({ ...funding, contact: emptyContact() }));
  const bestBeforeContacts = rankFundingsForProfile(profile, withoutContacts, MAX_RESULTS).fundings;
  const withContacts = await lookupContacts(bestBeforeContacts);

  return { fundings: withContacts, warnings: [...scraped.warnings, ...legal.warnings] };
}

async function toDemoCompany(
  funding: ScoredFunding,
  profile: CvProfile,
): Promise<{ company: DemoCompany; warning?: string }> {
  const email = funding.contact.email;
  const contactPage = funding.contact.contactPageUrl;
  const generated = await generateApplicationWithLlm(profile, funding);

  return {
    company: {
      name: funding.companyName,
      description: funding.description,
      fundingDate: funding.fundingDate,
      articleUrl: funding.articleUrl,
      websiteUrl: funding.websiteUrl,
      legalRepresentative: funding.legal?.legalRepresentative?.fullName ?? null,
      legalForm: funding.legal?.legalForm ?? funding.legal?.legalFormCode ?? null,
      siren: funding.legal?.siren ?? null,
      contact: email
        ? { type: "email", value: email }
        : contactPage
          ? { type: "url", value: contactPage }
          : { type: "unavailable", value: null },
      score: funding.score,
      scoreReason: funding.justification,
      matchedSkills: funding.matchedSkills,
      generationMode: generated.usedLlm ? "ai" : "fallback",
      application: generated.application,
    },
    warning: generated.warning,
  };
}

/** Runs the complete sourcing/matching/generation sequence used by the website. */
export async function runApplicationPipeline({
  cvText,
  forceCache = false,
}: {
  cvText: string;
  forceCache?: boolean;
}): Promise<PipelineResult> {
  const extracted = await extractCvProfile(cvText);
  const profile = extracted.profile;
  const warnings: string[] = [];
  if (extracted.warning) warnings.push(extracted.warning);
  let sourceMode: PipelineResult["sourceMode"] = "live";
  let fundings: ContactEnrichedFunding[];

  if (forceCache) {
    sourceMode = "cache";
    fundings = await fallbackFundings();
  } else {
    try {
      const live = await loadLiveFundings(profile);
      fundings = live.fundings;
      warnings.push(...live.warnings);
      if (fundings.length === 0) throw new Error("Aucune levée exploitable n’a été trouvée.");
    } catch (error) {
      sourceMode = "cache";
      warnings.push(`Sources en ligne indisponibles : ${String(error)}. Résultats de démonstration chargés.`);
      fundings = await fallbackFundings();
    }
  }

  const ranked = rankFundingsForProfile(profile, fundings, MAX_RESULTS);
  if (profile.skills.length < 2 && profile.jobTitles.length === 0 && profile.experiences.length === 0) {
    warnings.push("Le PDF contient peu de texte de CV exploitable. Vérifiez qu’il s’agit bien d’un CV exporté (et non d’une image ou d’un aperçu Canva) et qu’il contient du texte sélectionnable.");
  }

  const generatedCompanies = await Promise.all(
    ranked.fundings.map((funding) => toDemoCompany(funding, profile)),
  );
  warnings.push(...generatedCompanies.flatMap((result) => result.warning ? [result.warning] : []));

  return {
    sourceMode,
    profile,
    companies: generatedCompanies.map((result) => result.company),
    warnings,
  };
}
