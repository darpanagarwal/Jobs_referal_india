# Webscrapper

A small lead-finding tool that:

1. Searches Bing through a text proxy for keyword-led contact results
2. Supports a LinkedIn public-post mode for hiring searches
3. Visits public websites and contact pages
4. Extracts public email addresses and phone numbers
5. Shows how many search pages, websites, and pages were checked
6. Exports the results to CSV, Excel, or Google Sheets

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

Use the `Source` dropdown to switch between:

- `LinkedIn public posts` for hiring-post discovery
- `Public websites` for the original broad lead search

The scraper engine runs in Node and only needs the npm dependencies above.

## Google Sheets export

To use the Google Sheets button, set these environment variables:

```bash
GOOGLE_SHEETS_SPREADSHEET_ID=your-spreadsheet-id
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@email.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n..."
```

Share the sheet with the service account email before trying the export.

## Search tips

- Leave the email fragment blank to collect any public contact address.
- Use a fragment like `info@`, `sales@`, or `contact@` if you want to narrow the output.
- Run `python -m unittest discover -s tests` to check the Python scraper tests.

## Notes

- The scraper is limited by `MAX_SEARCH_PAGES` and `MAX_WEBSITES`.
- It targets public business contact emails only.
- Google can block automated requests, so results may vary by keyword and site.
- Run `npm test` to check the parsing and CSV helpers.

## Deployment

### Oracle Cloud Always Free

1. Create an always-free compute VM on Oracle Cloud.
2. Install Docker or Node.js 22 on the VM.
3. Clone this repository on the VM.
4. Run `docker build -t webscrapper .` and `docker run -p 3000:3000 webscrapper`.
5. Open port `3000` in the VM firewall or put Nginx in front of it.

### Daily runs

- The GitHub Actions workflow in `.github/workflows/daily-scrape.yml` runs twice a day.
- It writes a timestamped Excel workbook from `scripts/run-scrape.js`.
- The workflow uploads the workbook as an artifact.

### Excel export

- The app exports clean rows with `keyword`, `website`, `title`, `email`, `phone`, `region`, and `experience`.
- The daily runner writes the same schema to `.xlsx` files under `exports/`.
