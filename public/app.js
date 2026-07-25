const form = document.getElementById("scrapeForm");
const resultsBody = document.getElementById("resultsBody");
const statusEl = document.getElementById("status");
const resultCount = document.getElementById("resultCount");
const searchPagesChecked = document.getElementById("searchPagesChecked");
const websitesChecked = document.getElementById("websitesChecked");
const pagesChecked = document.getElementById("pagesChecked");
const emailsFound = document.getElementById("emailsFound");
const phonesFound = document.getElementById("phonesFound");
const downloadCsv = document.getElementById("downloadCsv");
const downloadExcel = document.getElementById("downloadExcel");
const saveSheets = document.getElementById("saveSheets");

let lastResults = [];
let activePoll = null;

function renderRows(rows) {
  if (!rows.length) {
    resultsBody.innerHTML = '<tr><td colspan="7" class="empty">No results yet.</td></tr>';
    resultCount.textContent = "0 rows";
    return;
  }

  resultsBody.innerHTML = rows
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(row.keyword || "")}</td>
        <td><a href="${escapeAttr(row.website || "#")}" target="_blank" rel="noreferrer">${escapeHtml(row.website || "")}</a></td>
        <td>${escapeHtml(row.title || "")}</td>
        <td><a href="mailto:${escapeAttr(row.email || "")}">${escapeHtml(row.email || "")}</a></td>
        <td>${escapeHtml(row.phone || "")}</td>
        <td>${escapeHtml(row.region || "")}</td>
        <td>${escapeHtml(row.experience || "")}</td>
      </tr>`
    )
    .join("");

  resultCount.textContent = `${rows.length} row${rows.length === 1 ? "" : "s"}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Request failed with ${response.status}`);
  }

  return response;
}

function renderProgress(data) {
  const progress = data.progress || {};
  searchPagesChecked.textContent = String(progress.searchPagesChecked ?? 0);
  websitesChecked.textContent = String(progress.websitesChecked ?? 0);
  pagesChecked.textContent = String(progress.pagesChecked ?? 0);
  emailsFound.textContent = String(progress.resultsCount ?? 0);
  phonesFound.textContent = String(progress.resultsCount ? new Set((data.result?.results || []).map((row) => row.phone).filter(Boolean)).size : 0);
}

async function pollJob(jobId) {
  if (activePoll) {
    clearInterval(activePoll);
    activePoll = null;
  }

  const tick = async () => {
    try {
      const response = await fetch(`/api/scrape/${jobId}`);
      if (!response.ok) {
        throw new Error(`Status request failed with ${response.status}`);
      }
      const data = await response.json();
      renderProgress(data);

      if (data.status === "complete") {
        lastResults = data.result?.results || [];
        renderRows(lastResults);
        const sourceLabel = data.result?.searchSource ? ` via ${data.result.searchSource}` : "";
        const notice = data.result?.searchNotice ? ` ${data.result.searchNotice}` : "";
        statusEl.textContent = `Finished${sourceLabel}. Found ${lastResults.length} email${lastResults.length === 1 ? "" : "s"}.${notice}`;
        downloadCsv.disabled = lastResults.length === 0;
        downloadExcel.disabled = lastResults.length === 0;
        saveSheets.disabled = lastResults.length === 0;
        clearInterval(activePoll);
        activePoll = null;
      } else if (data.status === "error") {
        statusEl.textContent = data.error || "Scrape failed.";
        clearInterval(activePoll);
        activePoll = null;
      } else {
        statusEl.textContent = `Working... checked ${data.progress?.websitesChecked ?? 0} websites, ${data.progress?.pagesChecked ?? 0} pages, ${data.progress?.resultsCount ?? 0} contacts so far.`;
      }
    } catch (error) {
      statusEl.textContent = error.message;
      clearInterval(activePoll);
      activePoll = null;
    }
  };

  await tick();
  activePoll = setInterval(tick, 1200);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.textContent = "Starting scrape job...";
  downloadCsv.disabled = true;
  downloadExcel.disabled = true;
  saveSheets.disabled = true;

  const payload = {
    keyword: document.getElementById("keyword").value.trim(),
    emailFragment: document.getElementById("emailFragment").value.trim(),
    spreadsheetId: document.getElementById("spreadsheetId").value.trim(),
    source: document.getElementById("source").value,
    maxSearchPages: Number(document.getElementById("maxSearchPages").value || 1),
    maxWebsites: Number(document.getElementById("maxWebsites").value || 3),
    maxAgeHours: Number(document.getElementById("maxAgeHours").value || 12),
  };

  try {
    const response = await postJson("/api/scrape", payload);
    const data = await response.json();
    if (!data.jobId) {
      throw new Error(data.error || "Scrape job did not start.");
    }
    statusEl.textContent = "Scrape job started.";
    await pollJob(data.jobId);
  } catch (error) {
    statusEl.textContent = error.message;
  }
});

downloadCsv.addEventListener("click", async () => {
  if (!lastResults.length) return;

  const response = await postJson("/api/export/csv", { rows: lastResults });
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "webscrapper-results.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
});

downloadExcel.addEventListener("click", async () => {
  if (!lastResults.length) return;

  const response = await postJson("/api/export/excel", { rows: lastResults });
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "webscrapper-results.xlsx";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
});

saveSheets.addEventListener("click", async () => {
  if (!lastResults.length) return;
  try {
    const response = await postJson("/api/export/sheets", {
      rows: lastResults,
      spreadsheetId: document.getElementById("spreadsheetId").value.trim(),
    });
    const data = await response.json();
    statusEl.textContent = `Saved ${data.updatedRows || 0} row${(data.updatedRows || 0) === 1 ? "" : "s"} to Google Sheets.`;
  } catch (error) {
    statusEl.textContent = error.message;
  }
});
