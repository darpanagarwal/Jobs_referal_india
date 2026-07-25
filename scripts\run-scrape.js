const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
require("dotenv").config();

const { scrapeLeads } = require("../scraper");
const { normalizeExportRows } = require("../export-utils");

function parseArgs(argv) {
  const args = {
    keyword: process.env.SCRAPE_KEYWORD || "hiring",
    source: process.env.SCRAPE_SOURCE || "linkedin",
    emailFragment: process.env.SCRAPE_EMAIL_FRAGMENT || "",
    maxSearchPages: Number(process.env.SCRAPE_MAX_SEARCH_PAGES || 3),
    maxWebsites: Number(process.env.SCRAPE_MAX_WEBSITES || 200),
    maxAgeHours: Number(process.env.SCRAPE_MAX_AGE_HOURS || 12),
    output: process.env.SCRAPE_OUTPUT || "",
  };

  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (current === "--keyword" && next) args.keyword = next;
    if (current === "--source" && next) args.source = next;
    if (current === "--email-fragment" && next) args.emailFragment = next;
    if (current === "--max-search-pages" && next) args.maxSearchPages = Number(next);
    if (current === "--max-websites" && next) args.maxWebsites = Number(next);
    if (current === "--max-age-hours" && next) args.maxAgeHours = Number(next);
    if (current === "--output" && next) args.output = next;
  }

  return args;
}

function createTimestampedFileName(keyword, source) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeKeyword = String(keyword || "scrape").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  const safeSource = String(source || "public").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  return `${safeKeyword || "scrape"}_${safeSource || "public"}_${stamp}.xlsx`;
}

async function main() {
  const options = parseArgs(process.argv);
  const result = await scrapeLeads({
    keyword: options.keyword,
    emailFragment: options.emailFragment,
    maxSearchPages: options.maxSearchPages,
    maxWebsites: options.maxWebsites,
    source: options.source,
    maxAgeHours: options.maxAgeHours,
  });

  const rows = normalizeExportRows(result.results);
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Leads");

  const outputPath = path.resolve(
    options.output || path.join(process.cwd(), "exports", createTimestampedFileName(options.keyword, options.source))
  );
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  XLSX.writeFile(workbook, outputPath);

  console.log(
    JSON.stringify(
      {
        outputPath,
        rows: rows.length,
        searchPagesChecked: result.searchPagesChecked,
        websitesChecked: result.websitesChecked,
        pagesChecked: result.pagesChecked,
        searchSource: result.searchSource,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
