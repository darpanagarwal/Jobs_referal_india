const express = require("express");
const path = require("path");
const XLSX = require("xlsx");
require("dotenv").config();

const { rowsToCsv } = require("./scraper-helpers");
const { appendRowsToGoogleSheet } = require("./sheets");
const { scrapeLeads } = require("./scraper");
const { normalizeExportRows } = require("./export-utils");

const app = express();
const port = Number(process.env.PORT || 3000);
const jobs = new Map();

function createJobId() {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function startScrapeJob(payload) {
  const jobId = createJobId();
  const job = {
    id: jobId,
    status: "running",
    progress: {
      searchPagesChecked: 0,
      websitesChecked: 0,
      pagesChecked: 0,
      resultsCount: 0,
      searchSource: "bing",
      searchNotice: "",
    },
    result: null,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };

  jobs.set(jobId, job);

  const timeout = setTimeout(() => {
    if (job.status !== "running") {
      return;
    }
    job.status = "error";
    job.error = "Scrape timed out.";
    job.finishedAt = new Date().toISOString();
  }, 120000);

  (async () => {
    try {
      const parsed = await scrapeLeads(payload);
      if (job.status !== "running") {
        return;
      }
      job.status = "complete";
      job.result = parsed;
      job.progress.searchPagesChecked = parsed.searchPagesChecked ?? job.progress.searchPagesChecked;
      job.progress.websitesChecked = parsed.websitesChecked ?? job.progress.websitesChecked;
      job.progress.pagesChecked = parsed.pagesChecked ?? job.progress.pagesChecked;
      job.progress.resultsCount = Array.isArray(parsed.results) ? parsed.results.length : job.progress.resultsCount;
      job.progress.searchSource = parsed.searchSource || job.progress.searchSource;
      job.progress.searchNotice = parsed.searchNotice || "";
    } catch (error) {
      if (job.status !== "running") {
        return;
      }
      job.status = "error";
      job.error = error.message || "Scrape failed.";
    } finally {
      clearTimeout(timeout);
      if (!job.finishedAt) {
        job.finishedAt = new Date().toISOString();
      }
    }
  })();

  return jobId;
}

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/scrape", async (req, res) => {
  try {
    const keyword = String(req.body.keyword || "").trim();
    const emailFragment =
      req.body.emailFragment === undefined || req.body.emailFragment === null
        ? ""
        : String(req.body.emailFragment).trim();
    const source = String(req.body.source || "public").trim().toLowerCase() === "linkedin" ? "linkedin" : "public";
    const maxSearchPages = Number(
      req.body.maxSearchPages || req.body.maxGooglePages || process.env.MAX_SEARCH_PAGES || 1
    );
    const maxWebsites = Number(
      req.body.maxWebsites || (source === "linkedin" ? 200 : process.env.MAX_WEBSITES || 3)
    );
    const maxAgeHours = Number(req.body.maxAgeHours || process.env.MAX_AGE_HOURS || 0);

    if (!keyword) {
      return res.status(400).json({ error: "Keyword is required." });
    }

    const jobId = startScrapeJob({
      keyword,
      emailFragment,
      maxSearchPages,
      maxWebsites,
      source,
      maxAgeHours,
    });

    res.json({
      ok: true,
      jobId,
      status: "running",
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Scrape failed." });
  }
});

app.get("/api/scrape/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Job not found." });
  }

  res.json({
    ok: true,
    id: job.id,
    status: job.status,
    progress: job.progress,
    result: job.result,
    error: job.error,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  });
});

app.post("/api/export/excel", (req, res) => {
  try {
    const rows = normalizeExportRows(req.body.rows);
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Leads");

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    res.setHeader(
      "Content-Disposition",
      'attachment; filename="webscrapper-results.xlsx"'
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: error.message || "Excel export failed." });
  }
});

app.post("/api/export/csv", (req, res) => {
  try {
    const rows = normalizeExportRows(req.body.rows);
    const csv = rowsToCsv(rows);

    res.setHeader("Content-Disposition", 'attachment; filename="webscrapper-results.csv"');
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.send(`\ufeff${csv}`);
  } catch (error) {
    res.status(500).json({ error: error.message || "CSV export failed." });
  }
});

app.post("/api/export/sheets", async (req, res) => {
  try {
    const rows = normalizeExportRows(req.body.rows);
    const spreadsheetId =
      req.body.spreadsheetId || process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    const sheetName = String(req.body.sheetName || "Leads");

    const result = await appendRowsToGoogleSheet({
      spreadsheetId,
      rows,
      sheetName,
    });

    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message || "Google Sheets export failed." });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Webscrapper running on http://localhost:${port}`);
});
