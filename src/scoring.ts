import type { ContactEnrichedFunding, CvProfile, MatchingResult, ScoredFunding } from "./types.js";

type SkillGroup = {
  name: string;
  terms: string[];
};

/**
 * Matching domains are deliberately profession-agnostic. A recently funded
 * startup can need research, operations, sales, legal or creative profiles as
 * well as engineers; no group is treated as the default.
 */
const SKILL_GROUPS: SkillGroup[] = [
  {
    name: "numérique, produit et ingénierie",
    terms: ["typescript", "javascript", "python", "sql", "cloud", "api", "logiciel", "software", "saas", "plateforme", "application", "numérique", "it", "infrastructure", "observabilité"],
  },
  {
    name: "data et IA",
    terms: ["data", "donnée", "analyse", "analytics", "machine learning", "intelligence artificielle", "ia", "algorithm", "diagnostic", "bioinformatique"],
  },
  {
    name: "recherche, santé et sciences du vivant",
    terms: ["recherche", "research", "biotechnologie", "biologie", "moléculaire", "immunothérapie", "thérapie", "génom", "clinique", "santé", "health", "médical", "diagnostic", "laboratoire", "pharma"],
  },
  {
    name: "commerce, marketing et relation client",
    terms: ["vente", "sales", "commercial", "marketing", "client", "customer", "prospection", "crm", "croissance", "growth", "saas", "solution", "professionnels", "entreprise", "organisation"],
  },
  {
    name: "opérations, management et logistique",
    terms: ["opération", "operations", "management", "équipe", "organisation", "logistique", "fret", "supply", "process", "infrastructure", "sécurité", "coordination", "pilotage"],
  },
  {
    name: "finance, droit et conformité",
    terms: ["finance", "financier", "juridique", "legal", "droit", "conformité", "compliance", "réglement", "comptable", "audit", "contrat", "assurance"],
  },
  {
    name: "création, communication et design",
    terms: ["design", "créatif", "création", "communication", "contenu", "média", "audiovisuel", "vidéo", "marque", "utilisateur", "expérience"],
  },
  {
    name: "climat et impact",
    terms: ["environnement", "climat", "décarbon", "impact", "durable", "énergie", "transition", "carbone"],
  },
];

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isMentioned(term: string, text: string): boolean {
  const normalizedTerm = normalize(term);
  const normalizedText = normalize(text);
  if (!normalizedTerm || !normalizedText) return false;
  const escapedTerm = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escapedTerm}($|[^a-z0-9])`, "i").test(normalizedText);
}

function profileText(profile: CvProfile): string {
  return [
    ...profile.skills,
    ...profile.jobTitles,
    ...profile.targetRoles,
    ...profile.experiences.flatMap((experience) => [experience.title, experience.summary, ...experience.skills]),
  ].join(" ");
}

function profileGroups(profile: CvProfile): SkillGroup[] {
  const text = profileText(profile);
  return SKILL_GROUPS.filter((group) => group.terms.some((term) => isMentioned(term, text)));
}

function scoreFunding(profile: CvProfile, funding: ContactEnrichedFunding): ScoredFunding {
  const companyText = `${funding.companyName} ${funding.description}`;
  const matchedSkills = profile.skills.filter((skill) => isMentioned(skill, companyText));
  // A long, rich CV must not be penalised just because it contains more than
  // ten skills. The denominator is deliberately capped for comparable scores.
  const directScore = matchedSkills.length === 0 ? 0 : Math.min(1, matchedSkills.length / Math.min(profile.skills.length, 10));

  const groups = profileGroups(profile);
  const matchedGroups = groups.filter((group) => group.terms.some((term) => isMentioned(term, companyText)));
  const domainScore = groups.length === 0 ? 0 : matchedGroups.length / groups.length;

  const experienceText = profile.experiences.map((experience) => `${experience.title} ${experience.summary}`).join(" ");
  const experienceScore = experienceText && matchedGroups.length > 0 ? 1 : 0;
  const score = Math.round((0.55 * directScore + 0.35 * domainScore + 0.1 * experienceScore) * 100) / 100;

  const reasons: string[] = [];
  if (matchedSkills.length > 0) reasons.push(`compétences citées : ${matchedSkills.slice(0, 3).join(", ")}`);
  if (matchedGroups.length > 0) reasons.push(`domaines compatibles : ${matchedGroups.map((group) => group.name).slice(0, 2).join(", ")}`);
  if (reasons.length === 0) reasons.push("correspondance sectorielle limitée : candidature possible, mais à personnaliser manuellement");

  return {
    ...funding,
    score,
    matchedSkills,
    justification: reasons.join(" ; "),
  };
}

/** Ranks recently funded companies by CV relevance and returns at most eight candidates. */
export function rankFundingsForProfile(profile: CvProfile, fundings: ContactEnrichedFunding[], maxResults = 8): MatchingResult {
  const fundingsWithScores = fundings
    .map((funding) => scoreFunding(profile, funding))
    .sort(
      (left, right) => right.score - left.score || (right.fundingDate ?? "").localeCompare(left.fundingDate ?? ""),
    );

  return {
    profile,
    fundings: fundingsWithScores.slice(0, Math.min(Math.max(maxResults, 1), 8)),
  };
}
