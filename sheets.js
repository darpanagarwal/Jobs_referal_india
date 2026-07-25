const { google } = require("googleapis");

function getServiceAccountAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!email || !privateKey) {
    throw new Error(
      "Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"
    );
  }

  return new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function appendRowsToGoogleSheet({ spreadsheetId, rows, sheetName = "Leads" }) {
  if (!spreadsheetId) {
    throw new Error("Missing spreadsheetId");
  }

  const auth = getServiceAccountAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const values = rows.map((row) => [
    row.keyword,
    row.website,
    row.title,
    row.email,
    row.sourcePage,
  ]);
  const headers = [["Keyword", "Website", "Title", "Email", "Source Page"]];

  if (!values.length) {
    return { updatedRows: 0 };
  }

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:E1`,
  });

  if (!existing.data.values || existing.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:E1`,
      valueInputOption: "RAW",
      requestBody: {
        values: headers,
      },
    });
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:E`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values,
    },
  });

  return { updatedRows: values.length };
}

module.exports = {
  appendRowsToGoogleSheet,
};
