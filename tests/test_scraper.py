import unittest
from unittest.mock import patch

import scraper


class ScraperTests(unittest.TestCase):
    def test_decode_bing_redirect(self):
        url = "https://www.bing.com/ck/a?!&&p=x&u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS8=&&ntb=1"
        self.assertEqual(scraper.decode_bing_redirect(url), "https://example.com/")

    def test_parse_bing_search_markdown(self):
        markdown = "\n".join(
            [
                "1.   ## [**Example Site**](https://www.bing.com/ck/a?!&&p=x&u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS8=&&ntb=1)",
                "",
                "A snippet about example.",
                "",
                "2.   ## [**Second Site**](https://www.bing.com/ck/a?!&&p=y&u=a1aHR0cHM6Ly9zZWNvbmQuY29tLw==&&ntb=1)",
                "",
                "Another snippet.",
            ]
        )
        results = scraper.parse_bing_search_markdown(markdown, "real estate", 1)
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]["title"], "Example Site")
        self.assertEqual(results[0]["url"], "https://example.com/")

    def test_extract_emails_and_phones(self):
        emails = scraper.extract_emails("Contact press@example.com or hero.jpg", "")
        phones = scraper.extract_phones("Call us at (555) 123-4567 or +1 555 987 6543.")
        self.assertEqual(emails, ["press@example.com"])
        self.assertIn("(555) 123-4567", phones)
        self.assertIn("+1 555 987 6543", phones)

    def test_scrape_leads_uses_search_and_contact_details(self):
        fake_search = {
            "results": [
                {
                    "rank": 1,
                    "title": "Example Real Estate",
                    "url": "https://example.com/",
                    "snippet": "Contact us",
                    "query": "real estate",
                    "pageIndex": 1,
                }
            ],
            "pagesChecked": 1,
        }
        fake_details = {
            "visited": ["https://example.com/"],
            "details": [
                {
                    "pageUrl": "https://example.com/contact",
                    "emails": ["info@example.com"],
                    "phones": ["(555) 123-4567"],
                    "sourceText": "Contact",
                }
            ],
        }

        def fake_collect_search_results(keyword, max_search_pages, source="public"):
            yield {
                "type": "search_progress",
                "searchPagesChecked": 1,
                "searchQuery": keyword,
                "pageIndex": 1,
                "resultCount": 0,
            }
            yield {
                "type": "search_done",
                "results": fake_search["results"],
                "pagesChecked": fake_search["pagesChecked"],
            }

        with patch.object(scraper, "collect_search_results", side_effect=fake_collect_search_results), patch.object(
            scraper, "fetch_site_details", return_value=fake_details
        ):
            data = None
            for event in scraper.scrape_leads("real estate", "", 1, 3):
                if event.get("type") == "done":
                    data = event

        self.assertIsNotNone(data)
        self.assertEqual(data["searchPagesChecked"], 1)
        self.assertEqual(data["websitesChecked"], 1)
        self.assertEqual(data["results"][0]["email"], "info@example.com")
        self.assertEqual(data["results"][0]["phone"], "(555) 123-4567")

    def test_linkedin_search_queries_and_results_filter(self):
        queries = scraper.search_queries("python developer", "linkedin")
        self.assertTrue(any("linkedin.com" in query for query in queries))

        markdown = "\n".join(
            [
                "1.   ## [**LinkedIn Hiring Post**](https://www.bing.com/ck/a?!&&p=x&u=a1aHR0cHM6Ly93d3cubGlua2VkaW4uY29tL3Bvc3RzL3ZpZXcvMTIzNDU2Nzg5Lw==&&ntb=1)",
                "",
                "Hiring now. Contact hiring@example.com",
            ]
        )
        results = scraper.parse_bing_search_markdown(markdown, "python developer", 1)
        self.assertEqual(len(results), 1)
        self.assertIn("linkedin.com", scraper.decode_bing_redirect(results[0]["url"]))


if __name__ == "__main__":
    unittest.main()
