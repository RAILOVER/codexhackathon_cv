import type { ContactEnrichedFunding, CvProfile, MatchingResult, ScoredFunding } from "./types.js";

type SkillGroup = {
  name: string;
  terms: string[];
};

const SKILL_GROUPS: SkillGroup[] = [
  {
    name: "développement logiciel",
    terms: ["typescript", "javascript", "node", "react", "next", "python", "sql", "docker", "kubernetes", "git", "software", "saas", "plateforme", "application", "api", "cloud", "it", "numérique"],
  },
  {
    name: "data et IA",
    terms: ["data", "donnees", "analyse", "machine learning", "intelligence artificielle", "ia", "algorithm", "observabil", "diagnostic"],
  },
  {
    name: "produit",
    terms: ["product", "ux", "utilisateur", "saas"],
  },
  {
    name: "commerce et marketing",
    terms: ["marketing", "seo", "salesforce", "vente", "commercial", "media"],
  },
];

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR");
}

function isMentioned(term: string, text: string): boolean {
  const normalizedTerm = normalize(term);
  const normalizedText = normalize(text);

  // Short terms such as "IA", "IT" and "SEO" must be whole words; otherwise
  // "IA" would incorrectly match words such as "matériaux".
  if (normalizedTerm.length <= 3) {
    const escapedTerm = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escapedTerm}($|[^a-z0-9])`, "i").test(normalizedText);
  }

  return normalizedText.includes(normalizedTerm);
}

function profileGroups(profile: CvProfile): SkillGroup[] {
  const profileText = [
    ...profile.skills,
    ...profile.jobTitles,
    ...profile.experiences.flatMap((experience) => [experience.title, experience.summary, ...experience.skills]),
  ].join(" ");

  return SKILL_GROUPS.filter((group) => group.terms.some((term) => isMentioned(term, profileText)));
}

function scoreFunding(profile: CvProfile, funding: ContactEnrichedFunding): ScoredFunding {
  const companyText = `${funding.companyName} ${funding.description}`;
  const matchedSkills = profile.skills.filter((skill) => isMentioned(skill, companyText));
  const directScore = profile.skills.length > 0 ? matchedSkills.length / profile.skills.length : 0;

  const groups = profileGroups(profile);
  const matchedGroups = groups.filter((group) => group.terms.some((term) => isMentioned(term, companyText)));
  const domainScore = groups.length > 0 ? matchedGroups.length / groups.length : 0;

  const experienceText = profile.experiences.map((experience) => `${experience.title} ${experience.summary}`).join(" ");
  const experienceScore = experienceText && matchedGroups.length > 0 ? 1 : 0;
  const score = Math.round((0.7 * directScore + 0.22 * domainScore + 0.08 * experienceScore) * 100) / 100;

  const reasons: string[] = [];
  if (matchedSkills.length > 0) reasons.push(`compétences citées : ${matchedSkills.slice(0, 3).join(", ")}`);
  if (matchedGroups.length > 0) reasons.push(`secteur compatible : ${matchedGroups.map((group) => group.name).slice(0, 2).join(", ")}`);
  if (reasons.length === 0) reasons.push("correspondance textuelle limitée : à vérifier avec le candidat");

  return {
    ...funding,
    score,
    matchedSkills,
    justification: reasons.join(" ; "),
  };
}

/** Ranks companies by CV relevance and returns at most eight candidates. */
export function rankFundingsForProfile(
  profile: CvProfile,
  fundings: ContactEnrichedFunding[],
  maxResults = 8,
): MatchingResult {
  const fundingsWithScores = fundings
    .map((funding) => scoreFunding(profile, funding))
    .sort(
      (left, right) =>
        right.score - left.score || (right.fundingDate ?? "").localeCompare(left.fundingDate ?? ""),
    );

  return {
    profile,
    fundings: fundingsWithScores.slice(0, Math.min(Math.max(maxResults, 1), 8)),
  };
}
