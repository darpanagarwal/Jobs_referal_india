const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_REGEX =
  /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{2,4})?/g;

function normalizeEmail(value) {
  let email = String(value).trim();
  while (/^[<({["'`]+/.test(email)) {
    email = email.slice(1).trim();
  }
  while (/[>)}\]"'`]+$/.test(email)) {
    email = email.slice(0, -1).trim();
  }
  return email;
}

function dedupe(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function matchesFragment(email, fragment) {
  if (!fragment) return true;
  return String(email).toLowerCase().includes(String(fragment).toLowerCase());
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function rowsToCsv(rows) {
  const headers = ["Keyword", "Website", "Title", "Email", "Phone", "Region", "Experience"];
  const lines = [headers.map(csvEscape).join(",")];

  for (const row of rows) {
    lines.push([row.keyword, row.website, row.title, row.email, row.phone, row.region, row.experience].map(csvEscape).join(","));
  }

  return lines.join("\r\n");
}

function extractEmailsFromText(text, html, fragment) {
  const rawEmails = [
    ...new Set([...(String(text || "").match(EMAIL_REGEX) || []), ...(String(html || "").match(EMAIL_REGEX) || [])]),
  ];
  return rawEmails
    .map(normalizeEmail)
    .filter((email) => matchesFragment(email, fragment))
    .filter((email) => {
      const domain = email.split("@")[1] || "";
      return !/\.(?:jpg|jpeg|png|gif|webp|svg|ico)$/i.test(domain);
    });
}

function normalizePhone(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/[^\d+]/g, "");
  const numericCount = digits.replace(/\D/g, "").length;
  if (numericCount < 10 || numericCount > 15) return "";
  if (!/[+().\-\s]/.test(raw)) return "";
  return raw.replace(/\s+/g, " ").replace(/[\u00a0]/g, " ").trim();
}

function extractPhonesFromText(text) {
  const matches = String(text || "").match(PHONE_REGEX) || [];
  return dedupe(matches.map(normalizePhone).filter(Boolean));
}

function extractContactDetailsFromText(text, html, fragment) {
  return {
    emails: extractEmailsFromText(text, html, fragment),
    phones: extractPhonesFromText(`${text || ""}\n${html || ""}`),
  };
}

function decodeBingRedirect(url) {
  try {
    const parsed = new URL(url);
    const encodedTarget = parsed.searchParams.get("u");
    if (!encodedTarget || !encodedTarget.startsWith("a1")) return url;
    const decoded = Buffer.from(encodedTarget.slice(2), "base64").toString("utf8");
    if (/^https?:\/\//i.test(decoded)) return decoded;
  } catch {
    return url;
  }
  return url;
}

function parseBingSearchMarkdown(markdown, query, pageIndex = 1) {
  const lines = String(markdown || "").split(/\r?\n/);
  const results = [];
  let current = null;

  for (const line of lines) {
    const headerMatch = line.match(/^\s*(\d+)\.\s+##\s+\[(.+?)\]\((.+?)\)\s*$/);
    if (headerMatch) {
      if (current) results.push(current);
      current = {
        rank: Number(headerMatch[1]),
        title: headerMatch[2].replace(/\*\*/g, "").trim(),
        url: decodeBingRedirect(headerMatch[3].trim()),
        snippet: "",
        query,
        pageIndex,
      };
      continue;
    }

    if (!current) continue;
    if (!line.trim()) {
      if (current.snippet) {
        results.push(current);
        current = null;
      }
      continue;
    }

    const snippetLine = line
      .replace(/^\s*[-*]\s+/, "")
      .replace(/\*\*/g, "")
      .trim();

    if (!current.snippet) {
      current.snippet = snippetLine;
    } else {
      current.snippet += ` ${snippetLine}`;
    }
  }

  if (current) results.push(current);
  return results.filter((item) => /^https?:\/\//i.test(item.url));
}

function extractContactLinksFromMarkdown(markdown, baseUrl) {
  const links = [];
  const seen = new Set();
  const patterns = [
    "contact",
    "contact-us",
    "contactus",
    "about",
    "team",
    "support",
    "reach",
    "reach-us",
    "locations",
    "location",
    "office",
    "impressum",
  ];

  const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = linkRegex.exec(String(markdown || "")))) {
    const label = `${match[1] || ""} ${match[2] || ""}`.toLowerCase();
    if (!patterns.some((pattern) => label.includes(pattern))) continue;
    try {
      const absolute = new URL(match[2].trim(), baseUrl).href;
      if (seen.has(absolute)) continue;
      seen.add(absolute);
      links.push(absolute);
    } catch {
      // Ignore invalid URLs.
    }
  }

  return links;
}

module.exports = {
  EMAIL_REGEX,
  PHONE_REGEX,
  normalizeEmail,
  dedupe,
  matchesFragment,
  csvEscape,
  rowsToCsv,
  extractEmailsFromText,
  normalizePhone,
  extractPhonesFromText,
  extractContactDetailsFromText,
  decodeBingRedirect,
  parseBingSearchMarkdown,
  extractContactLinksFromMarkdown,
};
