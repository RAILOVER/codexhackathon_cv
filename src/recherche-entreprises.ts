import type {
  Funding,
  LegalCompany,
  LegalEnrichmentResult,
  LegallyEnrichedFunding,
} from "./types.js";

const API_URL = "https://recherche-entreprises.api.gouv.fr/search";
const REQUEST_DELAY_MS = 250;

// The labels below are official Insee category labels. We always preserve the
// source code, because the API response provides the code rather than a label.
const LEGAL_FORM_LABELS: Record<string, string> = {
  "1000": "Entrepreneur individuel",
  "5499": "Société à responsabilité limitée (SARL)",
  "5510": "Société anonyme à conseil d'administration (SA)",
  "5610": "Société anonyme à directoire (SA)",
  "5710": "Société par actions simplifiée (SAS)",
  "5785": "Société d'exercice libéral par actions simplifiée (SELAS)",
  "6540": "Société civile immobilière (SCI)",
  "9220": "Association déclarée",
};

type ApiDirector = {
  nom?: string | null;
  prenoms?: string | null;
  qualite?: string | null;
  type_dirigeant?: string | null;
};

type ApiHeadquarters = {
  adresse?: string | null;
  code_postal?: string | null;
  departement?: string | null;
  libelle_commune?: string | null;
  region?: string | null;
};

// This is intentionally limited to fields observed in the live API response.
type ApiSearchResult = {
  siren?: string;
  nom_complet?: string | null;
  nom_raison_sociale?: string | null;
  sigle?: string | null;
  nature_juridique?: string | null;
  dirigeants?: ApiDirector[] | null;
  siege?: ApiHeadquarters | null;
};

type ApiSearchResponse = {
  results?: ApiSearchResult[];
};

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/[^a-z0-9]/g, "");
}

function asNonEmptyString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function selectBestMatch(companyName: string, results: ApiSearchResult[]): ApiSearchResult | null {
  const target = normalize(companyName);

  const exactMatch = results.find((result) =>
    [result.nom_complet, result.nom_raison_sociale, result.sigle]
      .filter((value): value is string => Boolean(value))
      .some((value) => normalize(value) === target),
  );

  return exactMatch ?? results[0] ?? null;
}

function toLegalCompany(result: ApiSearchResult): LegalCompany | null {
  if (!result.siren) return null;

  const legalFormCode = asNonEmptyString(result.nature_juridique);
  const director = result.dirigeants?.find(
    (candidate) => candidate.type_dirigeant === "personne physique",
  ) ?? result.dirigeants?.[0];

  const fullName = director
    ? [director.prenoms, director.nom].filter((value): value is string => Boolean(value?.trim())).join(" ")
    : "";

  const headquarters = result.siege
    ? {
        address: asNonEmptyString(result.siege.adresse),
        city: asNonEmptyString(result.siege.libelle_commune),
        postalCode: asNonEmptyString(result.siege.code_postal),
        department: asNonEmptyString(result.siege.departement),
        regionCode: asNonEmptyString(result.siege.region),
      }
    : null;

  return {
    siren: result.siren,
    legalFormCode,
    legalForm: legalFormCode ? LEGAL_FORM_LABELS[legalFormCode] ?? null : null,
    legalRepresentative: fullName
      ? { fullName, role: asNonEmptyString(director?.qualite) }
      : null,
    headquarters,
  };
}

/** Looks up one company in the public Recherche Entreprises API. */
export async function fetchLegalCompany(companyName: string): Promise<LegalCompany | null> {
  const url = new URL(API_URL);
  url.searchParams.set("q", companyName);
  url.searchParams.set("per_page", "5");

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "CandidatureSpontaneeHackathon/0.1",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Recherche Entreprises returned ${response.status} for ${companyName}`);
  }

  const payload = (await response.json()) as ApiSearchResponse;
  const match = selectBestMatch(companyName, payload.results ?? []);
  return match ? toLegalCompany(match) : null;
}

const FRENCH_REGION_CODES: Record<string, string> = {
  "auvergne-rhone-alpes": "84",
  bourgognefranchecomte: "27",
  bretagne: "53",
  centrevaldeloire: "24",
  corse: "94",
  grandest: "44",
  hautdefrance: "32",
  iledefrance: "11",
  normandie: "28",
  nouvelleaquitaine: "75",
  occitanie: "76",
  paysdelaloire: "52",
  provencealpescotedazur: "93",
};

/**
 * A geographic-zone filter applies to the legal headquarters. It deliberately
 * runs after legal enrichment: MaddyMoney does not provide a reliable location
 * for every company. The zone accepts a city, postal code, department or region.
 */
export function matchesGeographicZone(legal: LegalCompany | null, zone?: string): boolean {
  if (!zone?.trim()) return true;
  if (!legal?.headquarters) return false;

  const normalizedZone = normalize(zone);
  const headquarters = legal.headquarters;
  const textualValues = [headquarters.address, headquarters.city, headquarters.postalCode, headquarters.department]
    .filter((value): value is string => Boolean(value))
    .map(normalize);

  if (textualValues.some((value) => value.includes(normalizedZone))) return true;

  const regionCode = FRENCH_REGION_CODES[normalizedZone];
  return Boolean(regionCode && regionCode === headquarters.regionCode);
}

export async function enrichFundingsWithLegalData(
  fundings: Funding[],
  geographicZone?: string,
): Promise<LegalEnrichmentResult> {
  const warnings: string[] = [];
  const enriched: LegallyEnrichedFunding[] = [];
  let excludedByGeographicZone = 0;

  for (const [index, funding] of fundings.entries()) {
    let legal: LegalCompany | null = null;

    try {
      legal = await fetchLegalCompany(funding.companyName);
      if (!legal) warnings.push(`Aucun résultat légal trouvé pour ${funding.companyName}.`);
    } catch (error) {
      warnings.push(`Impossible d'identifier légalement ${funding.companyName}: ${String(error)}`);
    }

    if (matchesGeographicZone(legal, geographicZone)) {
      enriched.push({ ...funding, legal });
    } else {
      excludedByGeographicZone += 1;
    }

    // The official API allows at most 7 requests per second. Four per second
    // keeps this demo well below the public rate limit.
    if (index < fundings.length - 1) await sleep(REQUEST_DELAY_MS);
  }

  return {
    fundings: enriched,
    geographicZone: geographicZone?.trim() || null,
    excludedByGeographicZone,
    warnings,
  };
}
