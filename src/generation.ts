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

function sentence(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return /[.!?]$/.test(compact) ? compact : `${compact}.`;
}

function firstNameFromLetter(letter: string): string | null {
  const match = letter.match(/(?:bien cordialement|cordialement|sincèrement)[,\s]+([A-ZÀ-Ÿ][a-zà-ÿ'-]+)/i);
  return match?.[1] ?? null;
}

function candidateTitle(profile: CvProfile): string {
  return profile.targetRoles[0] ?? profile.jobTitles[0] ?? "professionnel·le motivé·e";
}

function companyMoment(funding: ScoredFunding): string {
  return funding.fundingDate
    ? `à la suite de votre levée de fonds annoncée le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date(`${funding.fundingDate}T12:00:00Z`))}`
    : "à un moment important de votre développement";
}

function motivationStyle(letter: string): "direct" | "formel" {
  return /bonjour|cordialement|madame|monsieur/i.test(letter) ? "formel" : "direct";
}

/**
 * Factual offline generator used for the hackathon demo. It only uses text
 * extracted from the CV, the user's motivation text and verified company data.
 * A future LLM provider can replace this function without changing the API
 * contract consumed by the interface.
 */
export function generateApplication(
  profile: CvProfile,
  funding: ScoredFunding,
  motivationLetter: string,
): GeneratedApplication {
  const title = candidateTitle(profile);
  const skills = profile.skills.slice(0, 8);
  const experience = profile.experiences[0];
  const skillText = skills.length > 0 ? skills.slice(0, 4).join(", ") : "mes compétences et mon expérience";
  const director = funding.legal?.legalRepresentative?.fullName;
  const greeting = director ? `Bonjour ${director},` : "Bonjour,";
  const signOff = firstNameFromLetter(motivationLetter);
  const style = motivationStyle(motivationLetter);
  const tailoredSummary = [
    `Profil orienté ${title}, avec un intérêt particulier pour ${funding.companyName} et son secteur.`,
    skills.length > 0 ? `Compétences mises en avant : ${skills.slice(0, 6).join(", ")}.` : "Compétences à préciser depuis le CV source.",
  ].join(" ");
  const context = sentence(funding.description);
  const relevantExperience = experience
    ? sentence(experience.summary || `Expérience : ${experience.title}`)
    : "Mon parcours me permet d’apporter une contribution opérationnelle et structurée.";
  const intro = style === "formel" ? "Je vous adresse ma candidature spontanée" : "Je souhaite vous proposer ma candidature";

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
        signOff ?? "",
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
