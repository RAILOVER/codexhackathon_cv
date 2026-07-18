import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { Funding, FundingScrapeResult } from "./types.js";

const MADDYNESS_ORIGIN = "https://www.maddyness.com";
export const MADDYNESS_FUNDINGS_URL = `${MADDYNESS_ORIGIN}/levees-de-fonds/`;

const REQUEST_HEADERS = {
  "user-agent": "CandidatureSpontaneeHackathon/0.1 (educational demo; contact: team@example.com)",
  accept: "text/html,application/xhtml+xml",
};

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function absoluteUrl(href: string): string {
  return new URL(href, MADDYNESS_ORIGIN).toString();
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: REQUEST_HEADERS,
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Maddyness returned ${response.status} for ${url}`);
  }

  return response.text();
}

function isFundingRecap(title: string, url: string): boolean {
  return (
    url.startsWith(MADDYNESS_ORIGIN) &&
    /\/20\d{2}\//.test(url) &&
    /(startups françaises ont levé|levées de fonds cette semaine|maddymoney)/i.test(title)
  );
}

/**
 * The main "levées de fonds" page links to MaddyMoney recap articles. We keep
 * the newest ones, because those articles contain the individual company cards.
 */
function extractRecapUrls($: CheerioAPI, maxRecaps: number): string[] {
  const urls: string[] = [];

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;

    const url = absoluteUrl(href);
    const title = normalizeText($(element).text());

    if (isFundingRecap(title, url) && !urls.includes(url)) {
      urls.push(url);
    }
  });

  return urls.slice(0, maxRecaps);
}

function extractFundingDate($: CheerioAPI): string | null {
  const publishedAt = $("meta[property='article:published_time']").attr("content");
  return publishedAt ? publishedAt.slice(0, 10) : null;
}

function extractCompanyProfileUrls($: CheerioAPI): Array<{ companyName: string; companyProfileUrl: string }> {
  const companies: Array<{ companyName: string; companyProfileUrl: string }> = [];

  // These classes are present on the current MaddyMoney company entries.
  $("a.financements__name[href*='/entreprise/'], a.js-datalayer-click-enterprise[href*='/entreprise/']").each(
    (_, element) => {
      const href = $(element).attr("href");
      const companyName = normalizeText($(element).text());
      if (!href || !companyName) return;

      const companyProfileUrl = absoluteUrl(href);
      if (!companies.some((company) => company.companyProfileUrl === companyProfileUrl)) {
        companies.push({ companyName, companyProfileUrl });
      }
    },
  );

  return companies;
}

async function scrapeCompanyProfile(
  companyName: string,
  companyProfileUrl: string,
): Promise<Pick<Funding, "description" | "websiteUrl">> {
  const html = await fetchHtml(companyProfileUrl);
  const $ = cheerio.load(html);

  const description =
    normalizeText($("meta[name='description']").attr("content") ?? "") ||
    normalizeText($(".article-text.article-text--no-initial").first().text()) ||
    `Description indisponible pour ${companyName}.`;

  const websiteUrl =
    $(".incubator__aside-link[href]")
      .toArray()
      .map((element) => $(element).attr("href"))
      .find((href): href is string => typeof href === "string" && !href.includes("maddyness.com")) ?? null;

  return { description, websiteUrl };
}

/**
 * Scrapes individual companies from recent MaddyMoney recaps. This deliberately
 * does not apply CV matching yet: matching belongs to the next step and must not
 * hide otherwise relevant companies before the CV has been parsed.
 */
export async function scrapeRecentFundings({
  maxFundings = 15,
  maxRecaps = 3,
}: {
  maxFundings?: number;
  maxRecaps?: number;
} = {}): Promise<FundingScrapeResult> {
  const warnings: string[] = [];
  const listingHtml = await fetchHtml(MADDYNESS_FUNDINGS_URL);
  const recapUrls = extractRecapUrls(cheerio.load(listingHtml), maxRecaps);

  if (recapUrls.length === 0) {
    throw new Error("No recent MaddyMoney recap was found on the Maddyness fundings page.");
  }

  const candidates: Array<{
    companyName: string;
    companyProfileUrl: string;
    fundingDate: string | null;
    articleUrl: string;
  }> = [];

  for (const articleUrl of recapUrls) {
    try {
      const articleHtml = await fetchHtml(articleUrl);
      const $ = cheerio.load(articleHtml);
      const fundingDate = extractFundingDate($);

      for (const company of extractCompanyProfileUrls($)) {
        if (!candidates.some((candidate) => candidate.companyProfileUrl === company.companyProfileUrl)) {
          candidates.push({ ...company, fundingDate, articleUrl });
        }
      }
    } catch (error) {
      warnings.push(`Impossible de lire le récapitulatif ${articleUrl}: ${String(error)}`);
    }
  }

  const fundings: Funding[] = [];
  for (const candidate of candidates.slice(0, maxFundings)) {
    try {
      const company = await scrapeCompanyProfile(candidate.companyName, candidate.companyProfileUrl);
      fundings.push({ ...candidate, ...company });
    } catch (error) {
      warnings.push(`Impossible d'enrichir ${candidate.companyName}: ${String(error)}`);
      fundings.push({
        ...candidate,
        description: `Description indisponible pour ${candidate.companyName}.`,
        websiteUrl: null,
      });
    }
  }

  return { fundings, sourceUrl: MADDYNESS_FUNDINGS_URL, recapUrls, warnings };
}
