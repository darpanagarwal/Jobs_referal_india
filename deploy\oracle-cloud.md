# Oracle Cloud Deployment

This repo is set up for a simple free deployment on an Oracle Cloud Always Free VM.

## What you need

- An Oracle Cloud Always Free compute instance
- A public SSH key
- Docker installed on the VM, or Node.js 22 if you prefer running it directly

## Quick start with Docker

```bash
git clone <your-repo-url>
cd webscrapper
docker build -t webscrapper .
docker run -d --restart unless-stopped -p 3000:3000 --name webscrapper webscrapper
```

Open port `3000` in the Oracle security list or place Nginx in front of the app.

## Environment variables

Set these if you want Google Sheets export:

```bash
GOOGLE_SHEETS_SPREADSHEET_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=
```

Set these if you want to change the daily scrape defaults:

```bash
SCRAPE_KEYWORD=hiring
SCRAPE_SOURCE=linkedin
SCRAPE_MAX_AGE_HOURS=12
SCRAPE_MAX_SEARCH_PAGES=3
SCRAPE_MAX_WEBSITES=200
```

## Daily scraping

Use the GitHub Actions workflow in `.github/workflows/daily-scrape.yml` for the twice-daily scrape.
It runs the Node scraper and uploads an Excel workbook artifact.

## Notes

- The app only scrapes public pages.
- LinkedIn can still rate-limit or block automated access.
- If LinkedIn blocks a request, rerun later or reduce the search volume.
