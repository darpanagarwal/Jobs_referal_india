function toExportRow(row) {
  return {
    keyword: row.keyword || "",
    website: row.website || "",
    title: row.title || "",
    email: row.email || "",
    phone: row.phone || "",
    region: row.region || "",
    experience: row.experience || "",
  };
}

function normalizeExportRows(rows) {
  return Array.isArray(rows) ? rows.map(toExportRow) : [];
}

module.exports = {
  toExportRow,
  normalizeExportRows,
};
