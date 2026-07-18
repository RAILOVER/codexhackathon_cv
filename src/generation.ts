import OpenAI from "openai";
import type { CvProfile, ScoredFunding } from "./types.js";

export type GeneratedApplication = {
  email: { subject: string; body: string };
  coverLetter: string;
  tailoredCv: {
    title: string;
    summary: string;
    skills: string[];
    experiences: Array<{ title: string; summary: string; skills: string[] }>;
  };
};

export type ApplicationGenerationResult = {
  application: GeneratedApplication;
  usedLlm: boolean;
  warning?: string;
};

const LLM_MODEL = "gpt-4.1-mini";

function truncate(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum).trimEnd()}…`;
}

function sentence(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return /[.!?]$/.test(compact) ? compact : `${compact}.`;
}

function candidateTitle(profile: CvProfile): string {
  return profile.targetRoles[0] ?? profile.jobTitles[0] ?? "professionnel·le motivé·e";
}

function companyMoment(funding: ScoredFunding): string {
  return funding.fundingDate
    ? `à la suite de votre levée de fonds annoncée le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date(`${funding.fundingDate}T12:00:00Z`))}`
    : "à un moment important de votre développement";
}

/**
 * Factual offline generator used for the hackathon demo. It only uses text
 * extracted from the CV and verified company data.
 */
export function generateApplication(
  profile: CvProfile,
  funding: ScoredFunding,
): GeneratedApplication {
  const title = candidateTitle(profile);
  const skills = profile.skills.slice(0, 8);
  const experience = profile.experiences[0];
  const skillText = skills.length > 0 ? skills.slice(0, 4).join(", ") : "mes compétences et mon expérience";
  const director = funding.legal?.legalRepresentative?.fullName;
  const greeting = director ? `Bonjour ${director},` : "Bonjour,";
  const tailoredSummary = [
    `Profil orienté ${title}, avec un intérêt particulier pour ${funding.companyName} et son secteur.`,
    skills.length > 0 ? `Compétences mises en avant : ${skills.slice(0, 6).join(", ")}.` : "Compétences à préciser depuis le CV source.",
  ].join(" ");
  const context = sentence(funding.description);
  const relevantExperience = experience
    ? sentence(experience.summary || `Expérience : ${experience.title}`)
    : "Mon parcours me permet d’apporter une contribution opérationnelle et structurée.";
  const intro = "Je souhaite vous proposer ma candidature";

  return {
    email: {
      subject: `Candidature spontanée — ${title} chez ${funding.companyName}`,
      body: [
        greeting,
        "",
        `${intro} ${companyMoment(funding)}. ${context}`,
        "",
        `Mon profil de ${title} s’appuie notamment sur ${skillText}. ${relevantExperience}`,
        "",
        `Je serais ravi·e d’échanger sur la manière dont je pourrais contribuer aux prochains enjeux de ${funding.companyName}.`,
        "",
        "Bien cordialement,",
      ].filter((line, index, lines) => line || (index > 0 && lines[index - 1] !== "")).join("\n"),
    },
    coverLetter: [
      `${intro} pour rejoindre ${funding.companyName} ${companyMoment(funding)}.`,
      context,
      `Mon parcours de ${title} m’a permis de développer ${skillText}. ${relevantExperience}`,
      `La correspondance entre mon profil et votre activité est notamment liée à : ${funding.justification}. Je souhaite mettre cette expérience au service de vos priorités de développement.`,
      `Je serais heureux·se de pouvoir vous présenter plus précisément ma motivation et mon approche lors d’un échange.`,
    ].join("\n\n"),
    tailoredCv: {
      title,
      summary: tailoredSummary,
      skills,
      experiences: profile.experiences.slice(0, 4),
    },
  };
}

/**
 * Improves only the cover letter through the OpenAI SDK when server-side
 * credentials are available. The fallback keeps the agent usable without AI.
 */
export async function generateApplicationWithLlm(
  profile: CvProfile,
  funding: ScoredFunding,
): Promise<ApplicationGenerationResult> {
  const application = generateApplication(profile, funding);

  if (!process.env.OPENAI_API_KEY) {
    return { application, usedLlm: false };
  }

  const candidateFacts = [
    `Intitulé visé : ${candidateTitle(profile)}`,
    `Compétences extraites : ${profile.skills.slice(0, 10).join(", ") || "non précisées"}`,
    `Expériences : ${profile.experiences.slice(0, 3).map((experience) => `${experience.title} — ${experience.summary}`).join(" | ") || "non précisées"}`,
  ].join("\n");
  const companyFacts = [
    `Entreprise : ${funding.companyName}`,
    `Description officielle : ${funding.description}`,
    `Date de levée si disponible : ${funding.fundingDate ?? "non communiquée"}`,
    `Dirigeant légal si disponible : ${funding.legal?.legalRepresentative?.fullName ?? "non identifié"}`,
    `Justification de correspondance : ${funding.justification}`,
  ].join("\n");

  try {
    const openai = new OpenAI();
    const completion = await openai.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0.35,
      max_tokens: 650,
      messages: [
        {
          role: "system",
          content: "Tu rédiges des lettres de motivation en français. Réponds uniquement par la lettre, sans titre, sans Markdown et sans commentaire. Ne fabrique aucune expérience, compétence, métrique, poste ouvert, montant de levée, nom de contact ni information d’entreprise. Reste entre 250 et 350 mots, avec un ton professionnel, concret et personnalisé.",
        },
        {
          role: "user",
          content: `Rédige une lettre de motivation pour cette candidature spontanée. Il n’y a pas de lettre source : adopte un ton professionnel, direct et chaleureux, uniquement à partir des faits ci-dessous.\n\nPROFIL CANDIDAT\n${truncate(candidateFacts, 4_500)}\n\nENTREPRISE\n${truncate(companyFacts, 3_500)}`,
        },
      ],
    });
    const coverLetter = completion.choices[0]?.message.content?.trim();

    if (!coverLetter || coverLetter.length < 120) {
      return { application, usedLlm: false, warning: `La lettre IA de ${funding.companyName} était vide : version factuelle utilisée.` };
    }

    return { application: { ...application, coverLetter }, usedLlm: true };
  } catch (error) {
    return {
      application,
      usedLlm: false,
      warning: `IA indisponible pour ${funding.companyName} : version factuelle utilisée.`,
    };
  }
}
