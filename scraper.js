const {
  dedupe,
  extractContactDetailsFromText,
  extractContactLinksFromMarkdown,
  parseBingSearchMarkdown,
} = require("./scraper-helpers");

const SEARCH_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const LINKEDIN_PRIORITY_REGIONS = [
  "India",
  "Bengaluru",
  "Bangalore",
  "Mumbai",
  "Hyderabad",
  "Pune",
  "Chennai",
  "Delhi",
  "Gurugram",
  "Noida",
  "Kolkata",
];
const LINKEDIN_OTHER_REGIONS = [
  "United States",
  "USA",
  "United Kingdom",
  "UK",
  "Canada",
  "Singapore",
  "UAE",
  "Dubai",
  "Middle East",
];
const HR_TERMS = ["HR", "recruiter", "human resources", "talent acquisition", "hiring"];

function linkedinSearchVariants(keyword) {
  const base = keyword.trim();
  const queries = [];
  const seen = new Set();

  const add = (query) => {
    const normalized = query.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    queries.push(normalized);
  };

  for (const region of LINKEDIN_PRIORITY_REGIONS) {
    for (const hrTerm of HR_TERMS) {
      add(`site:linkedin.com/posts "${base}" "${region}" "${hrTerm}" email`);
      add(`site:linkedin.com/feed/update "${base}" "${region}" "${hrTerm}" email`);
      add(`site:linkedin.com/company "${base}" "${region}" "${hrTerm}" email`);
      add(`site:linkedin.com/in "${base}" "${region}" "${hrTerm}" email`);
    }
  }

  for (const region of LINKEDIN_OTHER_REGIONS) {
    for (const hrTerm of HR_TERMS) {
      add(`site:linkedin.com/posts "${base}" "${region}" "${hrTerm}" email`);
      add(`site:linkedin.com/feed/update "${base}" "${region}" "${hrTerm}" email`);
    }
  }

  add(`site:linkedin.com/posts "${base}" hiring email`);
  add(`site:linkedin.com/feed/update "${base}" hiring email`);
  add(`site:linkedin.com/jobs "${base}" email`);
  add(`site:linkedin.com/company "${base}" hiring email`);

  return queries;
}

const SEARCH_VARIANTS = (keyword, source = "public") => {
  if (source === "linkedin") {
    return linkedinSearchVariants(keyword);
  }

  return [keyword, `${keyword} contact`, `${keyword} email`, `${keyword} phone`];
};

function proxyUrl(url) {
  return `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, "")}`;
}

async function fetchProxyText(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(proxyUrl(url), {
      signal: controller.signal,
      headers: {
        "User-Agent": SEARCH_USER_AGENT,
        Accept: "text/plain, text/markdown;q=0.9, */*;q=0.1",
      },
    });

    if (!response.ok) {
      throw new Error(`Proxy fetch failed for ${url} (${response.status})`);
    }

    return response.text();
  } finally {
    clearTimeout(timer);
  }
}

function sameOrigin(urlA, urlB) {
  try {
    return new URL(urlA).origin === new URL(urlB).origin;
  } catch {
    return false;
  }
}

function normalizeWebsiteUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return "";
  }
}

function searchFreshnessParam(maxAgeHours) {
  const hours = Number(maxAgeHours) || 0;
  if (hours <= 0) return "";
  if (hours <= 24) return "&freshness=Day";
  if (hours <= 168) return "&freshness=Week";
  return "&freshness=Month";
}

function inferLinkedInRegion(text) {
  const value = String(text || "").toLowerCase();
  if (!value) return "";
  for (const region of LINKEDIN_PRIORITY_REGIONS) {
    if (value.includes(region.toLowerCase())) return region;
  }
  for (const region of LINKEDIN_OTHER_REGIONS) {
    if (value.includes(region.toLowerCase())) return region;
  }
  return "";
}

function inferExperience(text) {
  const value = String(text || "");
  const rangeMatch = value.match(/\b(\d{1,2})\s*(?:-|-|to)\s*(\d{1,2})\s*(?:years?|yrs?)\b/i);
  if (rangeMatch) return `${rangeMatch[1]}-${rangeMatch[2]} years`;

  const plusMatch = value.match(/\b(\d{1,2})\s*\+\s*(?:years?|yrs?)\b/i);
  if (plusMatch) return `${plusMatch[1]}+ years`;

  const experienceMatch = value.match(/\b(\d{1,2})\s*(?:\+)?\s*(?:years?|yrs?)\s*(?:of\s+)?experience\b/i);
  if (experienceMatch) return `${experienceMatch[1]}+ years`;

  const numericMatch = value.match(/\b(\d{1,2})\s*(?:years?|yrs?)\b/i);
  if (numericMatch) return `${numericMatch[1]} years`;

  if (/\bfresher\b/i.test(value)) return "Fresher";
  return "";
}

function scoreLinkedInResult(result) {
  const text = `${result.title || ""} ${result.snippet || ""} ${result.query || ""}`.toLowerCase();
  let score = 0;
  if (LINKEDIN_PRIORITY_REGIONS.some((region) => text.includes(region.toLowerCase()))) score += 30;
  if (LINKEDIN_OTHER_REGIONS.some((region) => text.includes(region.toLowerCase()))) score += 10;
  if (HR_TERMS.some((term) => text.includes(term.toLowerCase()))) score += 25;
  if (/\bemail\b/i.test(text)) score += 8;
  if (/\bhiring\b/i.test(text)) score += 8;
  if (/\brecruiter\b/i.test(text)) score += 10;
  if (/\bhuman resources\b/i.test(text)) score += 10;
  return score;
}

async function collectSearchResults(keyword, maxSearchPages, source = "public") {
  const results = [];
  const seen = new Set();
  const variants = SEARCH_VARIANTS(keyword, source);
  const pagesPerVariant = Math.max(1, Number(maxSearchPages) || 1);
  let pagesChecked = 0;

  for (const query of variants) {
    for (let pageIndex = 0; pageIndex < pagesPerVariant; pageIndex += 1) {
      const searchUrl =
        pageIndex === 0
          ? `https://www.bing.com/search?q=${encodeURIComponent(query)}`
          : `https://www.bing.com/search?q=${encodeURIComponent(query)}&first=${pageIndex * 10}`;
      const markdown = await fetchProxyText(searchUrl, 20000);
      const parsed = parseBingSearchMarkdown(markdown, query, pageIndex + 1);
      pagesChecked += 1;

      for (const result of parsed) {
        const website = normalizeWebsiteUrl(result.url);
        if (!website || seen.has(website)) continue;
        seen.add(website);
        results.push({ ...result, url: website });
      }
    }
  }

  return { results, pagesChecked };
}

function extractExternalLinksFromMarkdown(markdown, baseUrl, limit = 3) {
  const links = [];
  const seen = new Set();
  const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
  let match;

  while ((match = linkRegex.exec(String(markdown || "")))) {
    try {
      const absolute = new URL(match[2].trim(), baseUrl).href;
      const parsed = new URL(absolute);
      if (!/^https?:$/i.test(parsed.protocol)) continue;
      if (parsed.hostname.toLowerCase().includes("linkedin.com")) continue;
      parsed.hash = "";
      parsed.search = "";
      const normalized = parsed.href;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      links.push(normalized);
      if (links.length >= limit) break;
    } catch {
      // Ignore invalid URLs.
    }
  }

  return links;
}

async function fetchSiteDetails(url, emailFragment, source = "public") {
  const visited = [];
  const details = [];
  const rootMarkdown = await fetchProxyText(url, 20000);
  visited.push(url);

  const rootContactLinks =
    source === "linkedin"
      ? extractExternalLinksFromMarkdown(rootMarkdown, url, 2)
      : extractContactLinksFromMarkdown(rootMarkdown, url).slice(0, 3);
  const pagesToVisit = dedupe([url, ...rootContactLinks]);

  for (const pageUrl of pagesToVisit) {
    if (visited.includes(pageUrl)) {
      const { emails, phones } = extractContactDetailsFromText(rootMarkdown, rootMarkdown, emailFragment);
      if (emails.length || phones.length) {
        details.push({
          pageUrl,
          emails,
          phones,
          sourceText: rootMarkdown,
        });
      }
      continue;
    }

    try {
      const pageText = await fetchProxyText(pageUrl, 15000);
      visited.push(pageUrl);
      const { emails, phones } = extractContactDetailsFromText(pageText, pageText, emailFragment);
      if (emails.length || phones.length) {
        details.push({
          pageUrl,
          emails,
          phones,
          sourceText: pageText,
        });
      }
    } catch {
      // Skip pages the proxy cannot fetch.
    }
  }

  return { visited, details };
}

async function scrapeLeads({
  keyword,
  emailFragment = "",
  maxSearchPages = 1,
  maxWebsites = 3,
  source = "public",
  maxAgeHours = 0,
}) {
  const variants = SEARCH_VARIANTS(keyword, source);
  const searchResults = [];
  const seenSearchResults = new Set();
  let searchPagesChecked = 0;

  for (const query of variants) {
    for (let pageIndex = 0; pageIndex < Math.max(1, Number(maxSearchPages) || 1); pageIndex += 1) {
      const searchUrl =
        pageIndex === 0
          ? `https://www.bing.com/search?q=${encodeURIComponent(query)}${searchFreshnessParam(maxAgeHours)}`
          : `https://www.bing.com/search?q=${encodeURIComponent(query)}&first=${pageIndex * 10}${searchFreshnessParam(maxAgeHours)}`;
      const markdown = await fetchProxyText(searchUrl, 20000);
      const parsed = parseBingSearchMarkdown(markdown, query, pageIndex + 1);
      searchPagesChecked += 1;

      for (const result of parsed) {
        const website = normalizeWebsiteUrl(result.url);
        if (!website || seenSearchResults.has(website)) continue;
        try {
          const origin = new URL(website);
          if (origin.hostname.toLowerCase().includes("bing.com")) continue;
          if (source === "linkedin" && !origin.hostname.toLowerCase().includes("linkedin.com")) continue;
          seenSearchResults.add(website);
          searchResults.push({ ...result, url: website });
        } catch {
          // Skip invalid results.
        }
      }
    }
  }

  if (source === "linkedin") {
    searchResults.sort((left, right) => scoreLinkedInResult(right) - scoreLinkedInResult(left));
  }

  const results = [];
  const seenSites = new Set();
  const seenContacts = new Set();
  let websitesChecked = 0;
  let pagesChecked = 0;

  for (const searchResult of searchResults.slice(0, maxWebsites * 3)) {
    if (results.length >= maxWebsites) break;
    const website = searchResult.url;

    let origin;
    try {
      origin = new URL(website).origin;
    } catch {
      continue;
    }

    if (seenSites.has(origin)) continue;

    seenSites.add(origin);
    websitesChecked += 1;

    try {
      const { visited, details } = await fetchSiteDetails(website, emailFragment, source);
      pagesChecked += visited.length;

      for (const detail of details) {
        for (const email of detail.emails) {
          for (const phone of detail.phones.length ? detail.phones : [""]) {
            const signature = `${origin}|${email}|${phone}|${detail.pageUrl}`;
            if (seenContacts.has(signature)) continue;
            seenContacts.add(signature);
            results.push({
              keyword,
              website: origin,
              title: searchResult.title || "",
              email,
              phone,
              region: inferLinkedInRegion(`${searchResult.title || ""} ${searchResult.snippet || ""}`) || "",
              experience: inferExperience(`${searchResult.title || ""} ${searchResult.snippet || ""} ${detail.sourceText || ""}`) || "",
              sourcePage: detail.pageUrl,
              searchQuery: searchResult.query || keyword,
              searchTitle: searchResult.title || "",
              searchSnippet: searchResult.snippet || "",
              ageHours: maxAgeHours || "",
            });
          }
        }
      }

      if (!results.length) {
        const { emails, phones } = extractContactDetailsFromText(
          details[0]?.sourceText || "",
          details[0]?.sourceText || "",
          emailFragment
        );
        for (const email of emails.slice(0, 3)) {
          const phone = phones[0] || "";
          const signature = `${origin}|${email}|${phone}|${website}`;
          if (seenContacts.has(signature)) continue;
          seenContacts.add(signature);
          results.push({
            keyword,
            website: origin,
            title: searchResult.title || "",
            email,
            phone,
            region: inferLinkedInRegion(`${searchResult.title || ""} ${searchResult.snippet || ""}`) || "",
            experience: inferExperience(`${searchResult.title || ""} ${searchResult.snippet || ""} ${details[0]?.sourceText || ""}`) || "",
            sourcePage: website,
            searchQuery: searchResult.query || keyword,
            searchTitle: searchResult.title || "",
            searchSnippet: searchResult.snippet || "",
            ageHours: maxAgeHours || "",
          });
        }
      }
    } catch {
      // Skip sites that fail to fetch.
    }
  }

  return {
    keyword,
    emailFragment,
    source,
    searchPagesChecked,
    websitesChecked,
    pagesChecked,
    searchSource: source === "linkedin" ? "bing-linkedin" : "bing",
    searchNotice: "",
    results,
  };
}

module.exports = {
  scrapeLeads,
  collectSearchResults,
  fetchSiteDetails,
};
