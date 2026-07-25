const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeEmail,
  rowsToCsv,
  extractEmailsFromText,
  extractPhonesFromText,
  decodeBingRedirect,
  parseBingSearchMarkdown,
} = require("../scraper-helpers");

test("normalizeEmail trims wrapper punctuation", () => {
  assert.equal(normalizeEmail(' <info@example.com> '), "info@example.com");
});

test("extractEmailsFromText filters by fragment", () => {
  const emails = extractEmailsFromText(
    "Contact info@example.com or sales@other.com",
    "",
    "info@"
  );

  assert.deepEqual(emails, ["info@example.com"]);
});

test("rowsToCsv escapes commas and quotes", () => {
  const csv = rowsToCsv([
    {
      keyword: "real estate",
      website: "https://example.com",
      title: 'Best "Homes", LLC',
      email: "info@example.com",
      phone: "+1 555-123-4567",
      sourcePage: "https://example.com/contact",
      searchQuery: "real estate contact",
    },
  ]);

  assert.match(csv, /"Best ""Homes"", LLC"/);
  assert.match(csv, /real estate/);
  assert.match(csv, /info@example.com/);
  assert.match(csv, /555-123-4567/);
});

test("extractPhonesFromText returns phone-like values", () => {
  const phones = extractPhonesFromText("Call us at (555) 123-4567 or +1 555 987 6543.");
  assert.deepEqual(phones, ["(555) 123-4567", "+1 555 987 6543"]);
});

test("decodeBingRedirect unwraps the target url", () => {
  const url =
    "https://www.bing.com/ck/a?!&&p=x&u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS8=&&ntb=1";
  assert.equal(decodeBingRedirect(url), "https://example.com/");
});

test("parseBingSearchMarkdown extracts results", () => {
  const markdown = [
    "1.   ## [**Example Site**](https://www.bing.com/ck/a?!&&p=x&u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS8=&&ntb=1)",
    "",
    "A snippet about example.",
    "",
    "2.   ## [**Second Site**](https://www.bing.com/ck/a?!&&p=y&u=a1aHR0cHM6Ly9zZWNvbmQuY29tLw==&&ntb=1)",
    "",
    "Another snippet.",
  ].join("\n");

  const results = parseBingSearchMarkdown(markdown, "real estate", 1);
  assert.equal(results.length, 2);
  assert.equal(results[0].title, "Example Site");
  assert.equal(results[0].url, "https://example.com/");
});
