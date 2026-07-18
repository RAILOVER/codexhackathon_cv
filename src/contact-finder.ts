import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type {
  ContactEnrichedFunding,
  ContactEnrichmentResult,
  LegallyEnrichedFunding,
  PublicContact,
} from "./types.js";

const MAX_PAGES_PER_COMPANY = 5;
const SOCIAL_HOSTS = new Set([
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
]);

// Homepage + the four paths requested in the project roadmap.
const COMMON_PATHS = ["/contact", "/about", "/team", "/a-propos"];
const CONTACT_LINK_PATTERN = /contact|nous-contacter|about|a-propos|team|equipe/i;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SINGLE_EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const TECHNICAL_EMAIL_DOMAIN = /(^|\.)(sentry|wixpress)\.|(^|\.)(example|mysite)\.com$/i;

function normalizeEmail(value: string): string {
  return value.trim().replace(/^mailto:/i, "").split("?")[0].replace(/[)>.,;:]+$/, "").toLowerCase();
}

function isUsableEmail(value: string): boolean {
  return SINGLE_EMAIL_PATTERN.test(value) && !value.endsWith("@example.com");
}

function isSocialHost(hostname: string): boolean {
  const normalizedHost = hostname.replace(/^www\./, "").toLowerCase();
  return [...SOCIAL_HOSTS].some((host) => normalizedHost === host || normalizedHost.endsWith(`.${host}`));
}

function isSameSite(url: URL, siteUrl: URL): boolean {
  return url.hostname === siteUrl.hostname || url.hostname.endsWith(`.${siteUrl.hostname}`);
}

function addUrl(urls: URL[], candidate: URL, siteUrl: URL): void {
  if (!isSameSite(candidate, siteUrl)) return;
  if (!urls.some((url) => url.href === candidate.href)) urls.push(candidate);
}

function extractEmails($: CheerioAPI, html: string): string[] {
  const emails = new Set<string>();

  $("a[href^='mailto:']").each((_, element) => {
    const email = normalizeEmail($(element).attr("href") ?? "");
    if (isUsableEmail(email)) emails.add(email);
  });

  for (const match of html.matchAll(EMAIL_PATTERN)) {
    const email = normalizeEmail(match[0]);
    if (isUsableEmail(email)) emails.add(email);
  }

  return [...emails];
}

function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1);
}

function isTechnicalEmail(email: string): boolean {
  return TECHNICAL_EMAIL_DOMAIN.test(emailDomain(email));
}

function primaryDomain(hostname: string): string {
  const pieces = hostname.replace(/^www\./, "").split(".");
  return pieces.slice(-2).join(".");
}

function retainRelevantEmails(emails: string[], siteUrl: URL): string[] {
  const nonTechnical = emails.filter((email) => !isTechnicalEmail(email));
  const siteDomain = primaryDomain(siteUrl.hostname);
  const sameDomain = nonTechnical.filter((email) => emailDomain(email).endsWith(siteDomain));

  // A company may publish a Gmail/Outlook address. Keep it only when no address
  // from the official domain was published on the site.
  return sameDomain.length > 0 ? sameDomain : nonTechnical;
}

function preferEmail(emails: string[]): string | null {
  if (emails.length === 0) return null;

  const priorities = [
    /recrut|career|job|talent|rh@|hr@/i,
    /contact|hello|bonjour|team|office/i,
  ];

  for (const priority of priorities) {
    const match = emails.find((email) => priority.test(email));
    if (match) return match;
  }

  return emails[0];
}

function discoverContactLinks($: CheerioAPI, pageUrl: URL, siteUrl: URL): URL[] {
  const urls: URL[] = [];

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    const text = $(element).text();
    if (!href || !CONTACT_LINK_PATTERN.test(`${href} ${text}`)) return;

    try {
      addUrl(urls, new URL(href, pageUrl), siteUrl);
    } catch {
      // Ignore malformed public links rather than failing the company lookup.
    }
  });

  return urls;
}

async function fetchPublicPage(url: URL): Promise<{ url: URL; html: string }> {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "CandidatureSpontaneeHackathon/0.1",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { url: new URL(response.url), html: await response.text() };
}

/**
 * Looks only at public pages on an official company website. Social-media URLs
 * are skipped: they are not reliable company contact pages and are often subject
 * to platform-specific scraping restrictions.
 */
export async function findPublicContact(websiteUrl: string | null): Promise<PublicContact> {
  const emptyResult: PublicContact = {
    email: null,
    emailsFound: [],
    contactPageUrl: null,
    pagesChecked: [],
  };

  if (!websiteUrl) return emptyResult;

  let siteUrl: URL;
  try {
    siteUrl = new URL(websiteUrl);
  } catch {
    return emptyResult;
  }

  if (!/^https?:$/.test(siteUrl.protocol) || isSocialHost(siteUrl.hostname)) return emptyResult;

  const urlsToVisit: URL[] = [siteUrl];
  for (const path of COMMON_PATHS) addUrl(urlsToVisit, new URL(path, siteUrl), siteUrl);

  const emails = new Set<string>();
  let contactPageUrl: string | null = null;

  // The five known pages are independent. Fetching them together gives a fixed
  // upper timeout per company instead of adding five individual timeouts.
  const initialCandidates = urlsToVisit.slice(0, MAX_PAGES_PER_COMPANY);
  const pageResults = await Promise.allSettled(initialCandidates.map(fetchPublicPage));

  for (const pageResult of pageResults) {
    if (pageResult.status !== "fulfilled") continue;

    try {
      const { url: finalUrl, html } = pageResult.value;
      emptyResult.pagesChecked.push(finalUrl.href);
      const $ = cheerio.load(html);

      for (const email of extractEmails($, html)) emails.add(email);

      const appearsToBeContactPage = CONTACT_LINK_PATTERN.test(finalUrl.pathname);
      if (appearsToBeContactPage && !contactPageUrl) contactPageUrl = finalUrl.href;

      for (const discoveredUrl of discoverContactLinks($, finalUrl, siteUrl)) {
        addUrl(urlsToVisit, discoveredUrl, siteUrl);
      }
    } catch {
      // An unexpected HTML parse issue must not fail the company lookup.
    }
  }

  const emailsFound = retainRelevantEmails([...emails], siteUrl);
  return {
    email: preferEmail(emailsFound),
    emailsFound,
    contactPageUrl: emailsFound.length === 0 ? contactPageUrl : null,
    pagesChecked: emptyResult.pagesChecked,
  };
}

export async function enrichFundingsWithPublicContacts(
  fundings: LegallyEnrichedFunding[],
): Promise<ContactEnrichmentResult> {
  const warnings: string[] = [];
  const enriched: ContactEnrichedFunding[] = [];

  for (const funding of fundings) {
    try {
      enriched.push({ ...funding, contact: await findPublicContact(funding.websiteUrl) });
    } catch (error) {
      warnings.push(`Impossible de chercher un contact pour ${funding.companyName}: ${String(error)}`);
      enriched.push({
        ...funding,
        contact: { email: null, emailsFound: [], contactPageUrl: null, pagesChecked: [] },
      });
    }
  }

  return { fundings: enriched, warnings };
}
