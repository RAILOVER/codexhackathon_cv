/** A company that has recently raised funds, ready for the matching stage. */
export type Funding = {
  companyName: string;
  description: string;
  fundingDate: string | null;
  articleUrl: string;
  companyProfileUrl: string;
  websiteUrl: string | null;
};

export type FundingScrapeResult = {
  fundings: Funding[];
  sourceUrl: string;
  recapUrls: string[];
  warnings: string[];
};

export type LegalCompany = {
  siren: string;
  legalFormCode: string | null;
  legalForm: string | null;
  legalRepresentative: {
    fullName: string;
    role: string | null;
  } | null;
  headquarters: {
    address: string | null;
    city: string | null;
    postalCode: string | null;
    department: string | null;
    regionCode: string | null;
  } | null;
};

export type LegallyEnrichedFunding = Funding & {
  legal: LegalCompany | null;
};

export type LegalEnrichmentResult = {
  fundings: LegallyEnrichedFunding[];
  geographicZone: string | null;
  excludedByGeographicZone: number;
  warnings: string[];
};

export type PublicContact = {
  /** The preferred public email, if one is published on the official site. */
  email: string | null;
  /** Every relevant public email retained after excluding technical artefacts. */
  emailsFound: string[];
  /** Used when no public email is found. */
  contactPageUrl: string | null;
  pagesChecked: string[];
};

export type ContactEnrichedFunding = LegallyEnrichedFunding & {
  contact: PublicContact;
};

export type ContactEnrichmentResult = {
  fundings: ContactEnrichedFunding[];
  warnings: string[];
};

export type CvExperience = {
  title: string;
  summary: string;
  skills: string[];
};

export type CvProfile = {
  skills: string[];
  jobTitles: string[];
  targetRoles: string[];
  experiences: CvExperience[];
  extractionMethod: "heuristic" | "llm";
};

export type ScoredFunding = ContactEnrichedFunding & {
  score: number;
  matchedSkills: string[];
  justification: string;
};

export type MatchingResult = {
  profile: CvProfile;
  fundings: ScoredFunding[];
};
