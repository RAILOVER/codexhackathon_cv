import type { CvExperience, CvProfile } from "./types.js";

const KNOWN_SKILLS = [
  "TypeScript",
  "JavaScript",
  "Node.js",
  "Express",
  "React",
  "Next.js",
  "Python",
  "SQL",
  "PostgreSQL",
  "MongoDB",
  "Docker",
  "CI/CD",
  "GitHub Actions",
  "Kubernetes",
  "AWS",
  "Git",
  "Figma",
  "WCAG",
  "Scrum",
  "Agile",
  "Product management",
  "Data analysis",
  "Machine learning",
  "Intelligence artificielle",
  "Marketing",
  "SEO",
  "Salesforce",
  "Excel",
];

const JOB_TITLE_PATTERN = /\b(?:développeur(?:\s+(?:full[ -]?stack|front[ -]?end|back[ -]?end|web|mobile))?|developer(?:\s+(?:full[ -]?stack|front[ -]?end|back[ -]?end))?|software engineer|ingénieur(?:\s+(?:logiciel|data|ia|machine learning))?|data analyst|data scientist|product manager|chef(?:fe)? de projet|project manager|ux\/?ui designer|designer|business developer|account executive|commercial(?:e)?|consultant(?:e)?|marketing manager)\b/i;

const SKILL_HEADING_PATTERN = /^(?:compétences?|skills?|stack(?: technique)?|outils|technologies?)\s*:??$/i;
const EXPERIENCE_HEADING_PATTERN = /^(?:expériences? (?:professionnelles?)?|parcours professionnel|professional experience)\s*:??$/i;
const STOP_SECTION_PATTERN = /^(?:formation|éducation|education|certifications?|langues?|intérêts?|centres d'intérêt)\b/i;

export const CV_EXTRACTION_SYSTEM_PROMPT = `Tu extrais un CV sans inventer aucune information.
Réponds uniquement par un objet JSON valide conforme à ce schéma :
{
  "skills": ["compétence"],
  "jobTitles": ["intitulé de poste"],
  "targetRoles": ["poste recherché ou plausible d'après le CV"],
  "experiences": [{"title":"", "summary":"", "skills":["compétence"]}]
}
Règles : conserve uniquement les éléments explicitement présents dans le CV ; n'invente ni employeur, ni diplôme, ni compétence ; utilise le français ; déduplique les listes.`;

export type CvLlmExtractor = {
  extractJson: (systemPrompt: string, cvText: string) => Promise<unknown>;
};

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/[^a-z0-9+#.]/g, "");
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const cleaned = value.trim();
    const key = normalize(cleaned);
    if (!cleaned || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sectionAfter(lines: string[], heading: RegExp): string[] {
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return [];

  const result: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (STOP_SECTION_PATTERN.test(line) || /^[A-ZÀ-Ÿ][A-ZÀ-Ÿ\s]{3,}:?$/.test(line)) break;
    result.push(line);
  }
  return result;
}

function findKnownSkills(text: string): string[] {
  const normalizedText = normalize(text);
  return KNOWN_SKILLS.filter((skill) => normalizedText.includes(normalize(skill)));
}

function extractExplicitSkills(lines: string[]): string[] {
  const candidates = lines
    .flatMap((line) => line.replace(/^[•·\-*]\s*/, "").split(/[,;|/]/))
    .map((value) => value.trim())
    .filter((value) => value.length >= 2 && value.length <= 50)
    .filter((value) => !/^\d{4}/.test(value));

  return unique([...findKnownSkills(lines.join(" ")), ...candidates.filter((value) => /[a-zA-ZÀ-ÿ]/.test(value))]);
}

function extractJobTitles(lines: string[]): string[] {
  const titles: string[] = [];
  for (const line of lines) {
    const match = line.match(JOB_TITLE_PATTERN);
    if (match) titles.push(match[0]);
  }
  return unique(titles);
}

function experienceTitle(line: string): string | null {
  const jobTitle = line.match(JOB_TITLE_PATTERN);
  if (jobTitle) return line.split(/[—–]/)[0].trim();

  const projectTitle = line.match(/^projet(?:\s+personnel)?\s*[—–-]\s*(.+)$/i);
  return projectTitle?.[1]?.trim() ? `Projet personnel — ${projectTitle[1].trim()}` : null;
}

function extractExperiences(lines: string[], fallbackSkills: string[]): CvExperience[] {
  const experienceLines = sectionAfter(lines, EXPERIENCE_HEADING_PATTERN);
  const sourceLines = experienceLines.length > 0 ? experienceLines : lines;
  const experiences: CvExperience[] = [];

  for (let index = 0; index < sourceLines.length; index += 1) {
    const title = experienceTitle(sourceLines[index]);
    if (!title) continue;

    const nextTitleIndex = sourceLines.findIndex(
      (line, candidateIndex) => candidateIndex > index && experienceTitle(line) !== null,
    );
    const endIndex = nextTitleIndex === -1 ? index + 4 : nextTitleIndex;
    const context = sourceLines.slice(index, endIndex).join(" ");
    experiences.push({
      title,
      summary: context.slice(0, 350),
      skills: unique([...findKnownSkills(context), ...fallbackSkills.filter((skill) => normalize(context).includes(normalize(skill)))]),
    });
  }

  return experiences.slice(0, 8);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? unique(value.filter((item): item is string => typeof item === "string")) : [];
}

function cvExperiences(value: unknown): CvExperience[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      title: typeof item.title === "string" ? item.title.trim() : "",
      summary: typeof item.summary === "string" ? item.summary.trim() : "",
      skills: stringArray(item.skills),
    }))
    .filter((experience) => experience.title || experience.summary);
}

/** Uses a chosen LLM provider while validating the JSON before it enters the pipeline. */
export async function extractCvProfileWithLlm(
  cvText: string,
  extractor: CvLlmExtractor,
): Promise<CvProfile> {
  const raw = await extractor.extractJson(CV_EXTRACTION_SYSTEM_PROMPT, cvText);
  const value = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};

  return {
    skills: stringArray(value.skills),
    jobTitles: stringArray(value.jobTitles),
    targetRoles: stringArray(value.targetRoles),
    experiences: cvExperiences(value.experiences),
    extractionMethod: "llm",
  };
}

/**
 * Offline fallback for the demo. It creates the same JSON contract as the LLM
 * path, so the scoring stage and interface work without an API key or network.
 */
export function extractCvProfileHeuristically(cvText: string): CvProfile {
  const lines = cvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const skills = extractExplicitSkills(sectionAfter(lines, SKILL_HEADING_PATTERN));
  const allSkills = unique([...skills, ...findKnownSkills(cvText)]);
  const jobTitles = extractJobTitles(lines);

  return {
    skills: allSkills,
    jobTitles,
    targetRoles: jobTitles.slice(0, 3),
    experiences: extractExperiences(lines, allSkills),
    extractionMethod: "heuristic",
  };
}
