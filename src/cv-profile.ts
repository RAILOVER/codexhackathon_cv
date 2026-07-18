import OpenAI from "openai";
import type { CvExperience, CvProfile } from "./types.js";

const CV_LLM_MODEL = "gpt-4.1-mini";

/**
 * High-confidence vocabulary used by the offline fallback. It deliberately
 * covers several families of professions; it is not a list of tech keywords.
 * Explicit CV sections are also retained so the parser still works for a
 * specialised profession that is absent from this list.
 */
const KNOWN_SKILLS = [
  // Digital, product and data
  "TypeScript", "JavaScript", "Node.js", "React", "Next.js", "Python", "R", "Java", "PHP", "SQL", "PostgreSQL",
  "Docker", "Kubernetes", "AWS", "Azure", "Google Cloud", "Git", "GraphQL", "REST API", "Figma", "UX design", "UI design",
  "Product management", "Gestion de produit", "Data analysis", "Analyse de données", "Machine learning", "Intelligence artificielle",
  "Cybersécurité", "Cybersecurity", "Support informatique", "IT support", "Administration systèmes", "Systèmes d'information",
  // Sales, marketing and client work
  "Vente", "Ventes", "Sales", "Développement commercial", "Business development", "Prospection", "Négociation", "Closing",
  "Gestion de comptes", "Account management", "CRM", "Salesforce", "Service client", "Customer success", "Relation client",
  "Marketing", "Marketing digital", "SEO", "SEA", "Google Analytics", "Communication", "Relations publiques", "Copywriting",
  "Community management", "Réseaux sociaux", "Production vidéo", "Photographie", "Direction artistique",
  // Management, operations and people
  "Management", "Leadership", "Gestion de projet", "Project management", "Gestion d'équipe", "Encadrement d'équipe",
  "Planification", "Coordination", "Organisation", "Gestion des opérations", "Amélioration des processus", "Lean", "Kanban", "Scrum",
  "Logistique", "Supply chain", "Gestion des stocks", "Qualité", "Contrôle qualité", "Sécurité", "Sécurité incendie",
  "Ressources humaines", "Recrutement", "Gestion administrative", "Gestion financière", "Gestion de budget",
  "Prospection commerciale", "Relations institutionnelles", "Conduite du changement",
  // Finance, law and public affairs
  "Comptabilité", "Finance", "Contrôle de gestion", "Audit", "Fiscalité", "Trésorerie", "ERP", "SAP", "Paie",
  "Droit", "Droit des sociétés", "Droit du travail", "Gestion des contrats", "Conformité", "Compliance", "RGPD", "Protection des données",
  // Research, health and life sciences
  "Recherche", "Recherche clinique", "Biotechnologie", "Biologie moléculaire", "Bioinformatique", "Immunothérapie", "Thérapie génique",
  "CRISPR-Cas9", "PCR", "Séquençage NGS", "Cytométrie en flux", "Culture cellulaire", "Gestion de laboratoire", "BPL",
  "Santé", "Médecine", "Pharmacologie", "Essais cliniques", "Affaires réglementaires", "Dispositif médical", "GMP", "ISO 13485",
  // Design, education and other transferable expertise
  "Design graphique", "Illustration", "Photoshop", "Illustrator", "InDesign", "Événementiel", "Organisation d'événements",
  "Pédagogie", "Enseignement", "Vulgarisation scientifique", "Immobilier", "Construction", "Agriculture", "Hôtellerie", "Restauration",
  // Languages and common professional tools
  "Excel", "PowerPoint", "Word", "Photoshop", "Français", "Anglais", "Espagnol", "Allemand", "Arabe", "Chinois", "Japonais",
] as const;

const ROLE_TERMS = [
  "développeur", "developer", "ingénieur", "engineer", "data analyst", "data scientist", "product manager", "product owner",
  "designer", "directeur artistique", "business developer", "account executive", "account manager", "commercial", "sales manager",
  "marketing manager", "consultant", "manager", "directeur", "responsable", "coordinateur", "assistant", "secrétaire",
  "chef de projet", "project manager", "chef d'exploitation", "chef de service", "chef d'équipe", "manager opérationnel",
  "associé", "entrepreneur", "fondateur", "président", "gérant", "administrateur", "recruteur", "formateur", "coach",
  "comptable", "analyste financier", "contrôleur de gestion", "contrôleuse de gestion", "auditeur", "auditrice", "juriste", "avocat", "avocate", "compliance officer",
  "chercheur", "chercheuse", "researcher", "scientifique", "biologiste", "pharmacien", "médecin", "infirmier", "infirmière",
  "doctorant", "postdoctoral", "postdoctorant", "technicien", "architecte", "enseignant", "professeur", "éducateur",
] as const;

const SKILL_HEADING_PATTERN = /^(?:compétences?|skills?|stack(?: technique)?|outils|technologies?|hard skills?|soft skills?|savoir[ -]?faire|expertise)\s*:??$/i;
const EXPERIENCE_HEADING_PATTERN = /^(?:expériences? (?:professionnelles?)?|parcours professionnel|professional experience|expérience|experience|emploi(?:s)?|work experience|carrière|career)\s*:??$/i;
const EDUCATION_HEADING_PATTERN = /^(?:formation|éducation|education|diplômes?|degrees?|études|academic background|certifications?)\s*:??$/i;
const LANGUAGE_HEADING_PATTERN = /^(?:langues?|languages?|linguistic skills)\s*:??$/i;
const SECTION_HEADING_PATTERN = /^(?:compétences?|skills?|expériences?|experience|formation|éducation|education|langues?|languages?|certifications?|références?|references?|profil|profile|contact|portfolio|intérêts?|centres d['’]intérêt|distinctions?|publications?)\s*:??$/i;
const DATE_PATTERN = /\b(?:(?:19|20)\d{2}|(?:janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre|january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:19|20)\d{2})(?:\s*(?:-|–|à|to)\s*(?:(?:19|20)\d{2}|aujourd['’]hui|présent|present|current))?/i;
const ACTION_START_PATTERN = /\b(?:pilotage|étude|analyse|conception|développement|supervision|collaboration|obtention|publication|présentation|thèse|validation|rédaction|encadrement|participation|recrutement|suivi|coordination|création|production|contribution|mise en place|gestion\s+(?:des|de la|du|d['’]))\b/i;

export const CV_EXTRACTION_SYSTEM_PROMPT = `Tu extrais fidèlement un CV, quel que soit le métier (tech, commerce, recherche, santé, création, opérations, finance, droit, etc.).
Réponds uniquement par un objet JSON valide de cette forme :
{
  "skills": ["compétence ou domaine explicitement présent"],
  "jobTitles": ["intitulé de poste explicitement présent"],
  "targetRoles": ["poste explicitement présent ou poste très proche fondé sur le CV"],
  "experiences": [{"title":"intitulé réel", "summary":"résumé factuel", "skills":["compétence liée"]}]
}
Règles strictes : ne rien inventer, conserver toutes les expériences distinctes et les compétences pertinentes, y compris les compétences transférables, les langues, méthodes, outils et domaines métier. Si le texte du PDF est désordonné, reconstitue seulement les éléments explicitement lisibles.`;

export type CvLlmExtractor = {
  extractJson: (systemPrompt: string, cvText: string) => Promise<unknown>;
};

export type CvProfileExtractionResult = {
  profile: CvProfile;
  usedLlm: boolean;
  warning?: string;
};

function normalizedText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const cleaned = value.trim().replace(/\s+/g, " ");
    const key = normalizedText(cleaned);
    if (!cleaned || !key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function phraseIsMentioned(phrase: string, text: string): boolean {
  const needle = normalizedText(phrase);
  const haystack = normalizedText(text);
  if (!needle || !haystack) return false;

  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(haystack);
}

function cleanLine(value: string): string {
  return value
    .replace(/\u00ad/g, "")
    // PDF text sometimes joins a title and its first verb (e.g.
    // "BiotechnologiePilotage"). This restores the missing word boundary.
    .replace(/([\p{Ll}\d])([\p{Lu}])/gu, "$1 $2")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

function cvLines(cvText: string): string[] {
  const rawLines = cvText
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((line) => line.length > 0);

  const lines: string[] = [];
  for (let index = 0; index < rawLines.length; index += 1) {
    const current = rawLines[index];
    const next = rawLines[index + 1];
    // Some PDF generators wrap only the last word of a job title on the next
    // visual line ("Chercheur senior en" / "Biotechnologie"). Rejoin those
    // two fragments before looking for an experience.
    const canContinueTitle = ROLE_TERMS.some((role) => phraseIsMentioned(role, current))
      && current.length <= 56
      && (/(?:\b(?:en|de|du|des|d['’])|chercheur|researcher)$/i.test(current)
        || /^(?:senior|junior|postdoctoral|postdoctorant|biotechnologie|sécurité|security)\b/i.test(next ?? ""));
    if (canContinueTitle && next && !SECTION_HEADING_PATTERN.test(next)) {
      lines.push(cleanLine(`${current} ${next}`));
      index += 1;
    } else {
      lines.push(current);
    }
  }
  return lines;
}

function isUppercaseHeading(line: string): boolean {
  const letters = line.replace(/[^A-Za-zÀ-ÿ]/g, "");
  return letters.length >= 4 && letters === letters.toLocaleUpperCase("fr-FR") && line.length <= 64;
}

function isSectionHeading(line: string): boolean {
  return SECTION_HEADING_PATTERN.test(line) || isUppercaseHeading(line);
}

function sectionAfter(lines: string[], heading: RegExp, limit = 18): string[] {
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return [];

  const result: string[] = [];
  for (const line of lines.slice(start + 1, start + 1 + limit)) {
    if (isSectionHeading(line)) break;
    result.push(line);
  }
  return result;
}

function findKnownSkills(text: string): string[] {
  return KNOWN_SKILLS
    .filter((skill) => phraseIsMentioned(skill, text))
    .sort((left, right) => normalizedText(text).indexOf(normalizedText(left)) - normalizedText(text).indexOf(normalizedText(right)));
}

function looksLikeSkillItem(value: string): boolean {
  const wordCount = normalizedText(value).split(" ").filter(Boolean).length;
  return value.length >= 2
    && value.length <= 96
    && wordCount <= 10
    && !DATE_PATTERN.test(value)
    && !/^(?:aujourd['’]hui|présent|present|current)\b/i.test(value)
    && !/[@]|https?:\/\//i.test(value)
    && !/\b\d+\s+of\s+\d+\b/i.test(value)
    && !ACTION_START_PATTERN.test(value)
    && !SECTION_HEADING_PATTERN.test(value);
}

function extractExplicitSkills(lines: string[]): string[] {
  const candidates = lines
    .filter((line) => {
      const words = normalizedText(line).split(" ").filter(Boolean).length;
      return /^[•·*\-]\s*/.test(line)
        || (words <= 15 && /[,;/]/.test(line) && !ACTION_START_PATTERN.test(line) && !DATE_PATTERN.test(line));
    })
    .flatMap((line) => line.replace(/^[•·*\-]\s*/, "").split(/[,;/]/))
    .map(cleanLine)
    .filter(looksLikeSkillItem);

  return unique([...findKnownSkills(lines.join("\n")), ...candidates]);
}

function titleFromLine(line: string): string | null {
  if (line.length > 180 || SECTION_HEADING_PATTERN.test(line) || /^cv\b/i.test(line)) return null;

  const withoutDate = cleanLine(line.replace(DATE_PATTERN, " ").replace(/\b(?:aujourd['’]hui|présent|present|current)\b/gi, " "));
  const beforeCompany = cleanLine(withoutDate.split("|")[0]?.split(/[–—]/)[0] ?? "");
  const actionIndex = withoutDate.search(ACTION_START_PATTERN);
  const candidate = cleanLine((actionIndex >= 0 ? withoutDate.slice(0, actionIndex) : beforeCompany).replace(/\s*[–—\-,:;]+\s*$/g, ""));
  if (!candidate || candidate.length > 100) return null;

  const roleIndex = ROLE_TERMS
    .filter((role) => phraseIsMentioned(role, candidate))
    .map((role) => normalizedText(candidate).indexOf(normalizedText(role)))
    .sort((left, right) => left - right)[0];
  if (roleIndex !== undefined && roleIndex <= 5 && !/\b(?:dans le cadre|en charge de|auprès de|pour le compte de)\b/i.test(candidate)) return candidate;
  if (DATE_PATTERN.test(line) && /^[A-ZÀ-Ÿ][A-ZÀ-Ÿ '\-]{2,80}$/.test(candidate)) return candidate;
  return null;
}

function extractJobTitles(lines: string[]): string[] {
  return unique(lines.map(titleFromLine).filter((title): title is string => title !== null)).slice(0, 12);
}

function experienceContextEnd(lines: string[], start: number): number {
  const maximum = Math.min(lines.length, start + 12);
  for (let index = start + 1; index < maximum; index += 1) {
    if (titleFromLine(lines[index])) return index;
    if (EDUCATION_HEADING_PATTERN.test(lines[index]) || LANGUAGE_HEADING_PATTERN.test(lines[index]) || SKILL_HEADING_PATTERN.test(lines[index])) return index;
  }
  return maximum;
}

function extractExperiences(lines: string[], fallbackSkills: string[]): CvExperience[] {
  const experiences: CvExperience[] = [];
  const seenTitles = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const title = titleFromLine(lines[index]);
    if (!title) continue;
    const key = normalizedText(title);
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);

    const contextStart = index > 0 && DATE_PATTERN.test(lines[index - 1]) ? index - 1 : index;
    const context = lines.slice(contextStart, experienceContextEnd(lines, index)).join(" ");
    experiences.push({
      title,
      summary: context.slice(0, 650),
      skills: unique([...findKnownSkills(context), ...fallbackSkills.filter((skill) => phraseIsMentioned(skill, context))]),
    });
  }

  return experiences.slice(0, 10);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? unique(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0))
    : [];
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

function profileFromUnknown(raw: unknown, extractionMethod: CvProfile["extractionMethod"]): CvProfile {
  const value = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
  return {
    skills: stringArray(value.skills),
    jobTitles: stringArray(value.jobTitles),
    targetRoles: stringArray(value.targetRoles),
    experiences: cvExperiences(value.experiences),
    extractionMethod,
  };
}

function mergeExperiences(primary: CvExperience[], fallback: CvExperience[]): CvExperience[] {
  const seen = new Set<string>();
  return [...primary, ...fallback]
    .filter((experience) => {
      const key = normalizedText(experience.title || experience.summary);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);
}

function mergeProfiles(llm: CvProfile, fallback: CvProfile): CvProfile {
  return {
    skills: unique([...llm.skills, ...fallback.skills]).slice(0, 40),
    jobTitles: unique([...llm.jobTitles, ...fallback.jobTitles]).slice(0, 12),
    targetRoles: unique([...llm.targetRoles, ...fallback.targetRoles, ...llm.jobTitles]).slice(0, 6),
    experiences: mergeExperiences(llm.experiences, fallback.experiences),
    extractionMethod: "llm",
  };
}

/** Uses a caller-selected LLM provider and validates its JSON before scoring. */
export async function extractCvProfileWithLlm(cvText: string, extractor: CvLlmExtractor): Promise<CvProfile> {
  const raw = await extractor.extractJson(CV_EXTRACTION_SYSTEM_PROMPT, cvText);
  return profileFromUnknown(raw, "llm");
}

/**
 * Offline parser. It preserves explicit skills and recognises titles across a
 * broad range of occupations, while remaining useful when no model key is set.
 */
export function extractCvProfileHeuristically(cvText: string): CvProfile {
  const lines = cvLines(cvText);
  const explicitSkills = extractExplicitSkills(sectionAfter(lines, SKILL_HEADING_PATTERN));
  const languageSkills = extractExplicitSkills(sectionAfter(lines, LANGUAGE_HEADING_PATTERN));
  const allSkills = unique([
    ...explicitSkills,
    ...languageSkills,
    ...findKnownSkills(cvText),
  ]).slice(0, 40);
  const jobTitles = extractJobTitles(lines);
  const experiences = extractExperiences(lines, allSkills);
  const targetRoles = unique([...jobTitles.slice(0, 5), ...experiences.slice(0, 3).map((experience) => experience.title)]).slice(0, 6);

  return {
    skills: allSkills,
    jobTitles,
    targetRoles,
    experiences,
    extractionMethod: "heuristic",
  };
}

/**
 * Uses OpenAI on the server when available, then merges it with the local
 * parser so that a model omission never erases an explicit CV fact. The SDK is
 * instantiated without browser-visible credentials; Netlify AI Gateway or a
 * server-side OPENAI_API_KEY supplies them at runtime.
 */
export async function extractCvProfile(cvText: string): Promise<CvProfileExtractionResult> {
  const fallback = extractCvProfileHeuristically(cvText);
  if (!process.env.OPENAI_API_KEY) return { profile: fallback, usedLlm: false };

  try {
    const openai = new OpenAI();
    const completion = await openai.chat.completions.create({
      model: CV_LLM_MODEL,
      temperature: 0,
      max_tokens: 1_800,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: CV_EXTRACTION_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Analyse ce CV et retourne l'objet JSON demandé. Le texte peut provenir d'un PDF à colonnes ; conserve les faits lisibles sans compléter les trous.\n\nCV\n${cvText.slice(0, 18_000)}`,
        },
      ],
    });
    const content = completion.choices[0]?.message.content?.trim();
    if (!content) throw new Error("réponse vide");

    const llmProfile = profileFromUnknown(JSON.parse(content), "llm");
    if (llmProfile.skills.length === 0 && llmProfile.jobTitles.length === 0 && llmProfile.experiences.length === 0) {
      throw new Error("profil vide");
    }

    return { profile: mergeProfiles(llmProfile, fallback), usedLlm: true };
  } catch {
    return {
      profile: fallback,
      usedLlm: false,
      warning: "Extraction IA indisponible : analyse locale utilisée.",
    };
  }
}
