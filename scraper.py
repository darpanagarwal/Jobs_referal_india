import base64
import json
import re
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from html import unescape


USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)

EMAIL_RE = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.I)
PHONE_RE = re.compile(
    r"(?:\+?\d{1,3}[\s.\-]?)?(?:\(?\d{2,4}\)?[\s.\-]?)?\d{3,4}[\s.\-]?\d{3,4}(?:[\s.\-]?\d{2,4})?"
)


def _clean_url(url: str) -> str:
    try:
        parsed = urllib.parse.urlsplit(url)
        parsed = parsed._replace(fragment="")
        return urllib.parse.urlunsplit(parsed)
    except Exception:
        return url.strip()


def _proxy_url(url: str) -> str:
    url = url.strip()
    if url.startswith("https://"):
        return "https://r.jina.ai/http://" + url[len("https://") :]
    if url.startswith("http://"):
        return "https://r.jina.ai/http://" + url[len("http://") :]
    return "https://r.jina.ai/http://" + url


def fetch_proxy_text(url: str, timeout: int = 12) -> str:
    last_error = None
    for attempt in range(4):
        req = urllib.request.Request(
            _proxy_url(url),
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/plain, text/markdown;q=0.9, */*;q=0.1",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code != 429:
                raise
            time.sleep(0.6 * (attempt + 1))
        except urllib.error.URLError as exc:
            last_error = exc
            if attempt == 3:
                raise
            time.sleep(0.4 * (attempt + 1))

    raise last_error if last_error else RuntimeError("Proxy fetch failed")


def decode_bing_redirect(url: str) -> str:
    try:
        parsed = urllib.parse.urlsplit(url)
        params = urllib.parse.parse_qs(parsed.query)
        encoded = params.get("u", [""])[0]
        if encoded.startswith("a1"):
            payload = encoded[2:]
            payload += "=" * ((4 - len(payload) % 4) % 4)
            decoded = base64.b64decode(payload).decode("utf-8", errors="replace")
            if decoded.startswith(("http://", "https://")):
                return _clean_url(decoded)
    except Exception:
        pass
    return _clean_url(url)


def parse_bing_search_markdown(markdown: str, query: str, page_index: int):
    results = []
    current = None

    for raw_line in markdown.splitlines():
        line = raw_line.rstrip()
        match = re.match(r"^\s*(\d+)\.\s+##\s+\[(.+?)\]\((.+?)\)\s*$", line)
        if match:
            if current:
                results.append(current)
            current = {
                "rank": int(match.group(1)),
                "title": unescape(re.sub(r"\*\*", "", match.group(2))).strip(),
                "url": decode_bing_redirect(match.group(3).strip()),
                "snippet": "",
                "query": query,
                "pageIndex": page_index,
            }
            continue

        if not current:
            continue

        if not line.strip():
            if current.get("snippet"):
                results.append(current)
                current = None
            continue

        snippet_line = re.sub(r"^\s*[-*]\s+", "", re.sub(r"\*\*", "", line)).strip()
        if current["snippet"]:
            current["snippet"] += " " + snippet_line
        else:
            current["snippet"] = snippet_line

    if current:
        results.append(current)

    return [item for item in results if item["url"].startswith(("http://", "https://"))]


def extract_emails(text: str, fragment: str = ""):
    values = []
    for email in EMAIL_RE.findall(text or ""):
        email = email.strip("<>()[]{}\"'` ")
        if fragment and fragment.lower() not in email.lower():
            continue
        domain = email.split("@", 1)[-1]
        if re.search(r"\.(?:jpg|jpeg|png|gif|webp|svg|ico)$", domain, re.I):
            continue
        values.append(email)
    return sorted(set(values))


def extract_phones(text: str):
    phones = []
    for phone in PHONE_RE.findall(text or ""):
        phone = re.sub(r"\s+", " ", phone.replace("\xa0", " ")).strip()
        digits = re.sub(r"\D", "", phone)
        if len(digits) < 10 or len(digits) > 15:
            continue
        if not re.search(r"[+().\-\s]", phone):
            continue
        phones.append(phone)
    return sorted(set(phones))


def extract_contact_links(markdown: str, base_url: str):
    keywords = (
        "contact",
        "contact-us",
        "contactus",
        "about",
        "team",
        "support",
        "reach",
        "locations",
        "location",
        "office",
        "impressum",
    )
    links = []
    seen = set()
    for label, href in re.findall(r"\[([^\]]*)\]\(([^)]+)\)", markdown or ""):
        candidate = f"{label} {href}".lower()
        if not any(word in candidate for word in keywords):
            continue
        try:
            absolute = urllib.parse.urljoin(base_url, href.strip())
            if absolute not in seen:
                seen.add(absolute)
                links.append(absolute)
        except Exception:
            continue
    return links


def extract_external_links(markdown: str, base_url: str, limit: int = 3):
    links = []
    seen = set()
    for _label, href in re.findall(r"\[([^\]]*)\]\(([^)]+)\)", markdown or ""):
        try:
            absolute = urllib.parse.urljoin(base_url, href.strip())
            parsed = urllib.parse.urlsplit(absolute)
            if parsed.scheme not in ("http", "https"):
                continue
            if "linkedin.com" in parsed.netloc.lower():
                continue
            cleaned = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
            if cleaned in seen:
                continue
            seen.add(cleaned)
            links.append(cleaned)
            if len(links) >= limit:
                break
        except Exception:
            continue
    return links


def search_queries(keyword: str, source: str = "public"):
    keyword = keyword.strip()
    if source == "linkedin":
        return [
            f'site:linkedin.com/posts "{keyword}" hiring email',
            f'site:linkedin.com/feed/update "{keyword}" hiring email',
            f'site:linkedin.com/jobs "{keyword}" email',
            f'site:linkedin.com/company "{keyword}" hiring email',
        ]

    return [
        keyword,
        f"{keyword} contact",
        f"{keyword} email",
    ]


def collect_search_results(keyword: str, max_search_pages: int, source: str = "public"):
    results = []
    seen = set()
    pages_checked = 0

    for query in search_queries(keyword, source):
        for page_index in range(max_search_pages):
            url = f"https://www.bing.com/search?q={urllib.parse.quote(query)}"
            if page_index > 0:
                url += f"&first={page_index * 10}"

            try:
                markdown = fetch_proxy_text(url, timeout=10)
            except urllib.error.HTTPError as exc:
                if exc.code == 429:
                    yield {
                        "type": "search_rate_limited",
                        "searchPagesChecked": pages_checked,
                        "searchQuery": query,
                        "pageIndex": page_index + 1,
                    }
                    continue
                raise
            parsed = parse_bing_search_markdown(markdown, query, page_index + 1)
            pages_checked += 1
            yield {
                "type": "search_progress",
                "searchPagesChecked": pages_checked,
                "searchQuery": query,
                "pageIndex": page_index + 1,
                "resultCount": len(results),
            }
            for item in parsed:
                clean_url = _clean_url(item["url"])
                try:
                    origin = urllib.parse.urlsplit(clean_url)
                    if origin.scheme not in ("http", "https"):
                        continue
                    if "bing.com" in origin.netloc.lower():
                        continue
                    if source == "linkedin" and "linkedin.com" not in origin.netloc.lower():
                        continue
                    normalized = urllib.parse.urlunsplit((origin.scheme, origin.netloc, origin.path, "", ""))
                    if normalized in seen:
                        continue
                    seen.add(normalized)
                    results.append({**item, "url": normalized})
                except Exception:
                    continue

    yield {
        "type": "search_done",
        "results": results,
        "pagesChecked": pages_checked,
    }


def fetch_site_details(url: str, fragment: str = "", source: str = "public"):
    visited = []
    details = []
    try:
        root_text = fetch_proxy_text(url, timeout=10)
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            return {"visited": visited, "details": [], "notice": "rate_limited"}
        raise
    visited.append(url)
    if source == "linkedin":
        candidate_pages = [url] + extract_external_links(root_text, url, limit=2)
    else:
        candidate_pages = [url] + extract_contact_links(root_text, url)[:3]

    for page_url in candidate_pages:
        try:
            if page_url == url:
                page_text = root_text
            else:
                page_text = fetch_proxy_text(page_url, timeout=8)
            if page_url != url:
                visited.append(page_url)
            emails = extract_emails(page_text, fragment)
            phones = extract_phones(page_text)
            if emails or phones:
                details.append(
                    {
                        "pageUrl": page_url,
                        "emails": emails,
                        "phones": phones,
                        "sourceText": page_text,
                    }
                )
        except Exception:
            continue

    return {"visited": visited, "details": details}


def scrape_leads(
    keyword: str,
    email_fragment: str = "",
    max_search_pages: int = 1,
    max_websites: int = 3,
    source: str = "public",
):
    search_results = []
    search_pages_checked = 0
    for event in collect_search_results(keyword, max_search_pages, source):
        if isinstance(event, dict) and event.get("type") == "search_progress":
            search_pages_checked = event.get("searchPagesChecked", search_pages_checked)
            continue
        if isinstance(event, dict) and event.get("type") == "search_done":
            search_results = event["results"]
            search_pages_checked = event.get("pagesChecked", search_pages_checked)

    results = []
    seen_sites = set()
    seen_contacts = set()
    websites_checked = 0
    pages_checked = 0
    search_notice = ""

    for search_result in search_results[: max_websites * 3]:
        if len(results) >= max_websites:
            break
        website = search_result["url"]
        try:
            origin = urllib.parse.urlsplit(website)
            site_key = urllib.parse.urlunsplit((origin.scheme, origin.netloc, "", "", ""))
        except Exception:
            continue
        if site_key in seen_sites:
            continue
        seen_sites.add(site_key)
        websites_checked += 1

        try:
            details = fetch_site_details(website, email_fragment, source)
            pages_checked += len(details["visited"])
            if details.get("notice") == "rate_limited":
                search_notice = "Some pages were rate limited, so results may be incomplete."
            yield {
                "type": "site_progress",
                "websitesChecked": websites_checked,
                "pagesChecked": pages_checked,
                "resultsCount": len(results),
                "currentWebsite": site_key,
            }
            for detail in details["details"]:
                emails = detail["emails"] or [""]
                phones = detail["phones"] or [""]
                for email in emails:
                    for phone in phones:
                        signature = f"{site_key}|{email}|{phone}|{detail['pageUrl']}"
                        if signature in seen_contacts:
                            continue
                        seen_contacts.add(signature)
                        results.append(
                            {
                                "keyword": keyword,
                                "website": site_key,
                                "title": search_result.get("title", ""),
                                "email": email,
                                "phone": phone,
                                "sourcePage": detail["pageUrl"],
                                "searchQuery": search_result.get("query", keyword),
                                "searchTitle": search_result.get("title", ""),
                                "searchSnippet": search_result.get("snippet", ""),
                            }
                        )
                        yield {
                            "type": "result_progress",
                            "websitesChecked": websites_checked,
                            "pagesChecked": pages_checked,
                            "resultsCount": len(results),
                            "latest": results[-1],
                        }
        except Exception:
            continue

    yield {
        "type": "done",
        "keyword": keyword,
        "emailFragment": email_fragment,
        "source": source,
        "searchPagesChecked": search_pages_checked,
        "websitesChecked": websites_checked,
        "pagesChecked": pages_checked,
        "searchSource": "bing-linkedin" if source == "linkedin" else "bing-python",
        "searchNotice": search_notice,
        "results": results,
    }


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    keyword = str(payload.get("keyword", "")).strip()
    if not keyword:
        raise SystemExit(json.dumps({"error": "Keyword is required."}))

    data = None
    for event in scrape_leads(
        keyword=keyword,
        email_fragment=str(payload.get("emailFragment", "")).strip(),
        max_search_pages=int(payload.get("maxSearchPages", 1) or 1),
        max_websites=int(payload.get("maxWebsites", 3) or 3),
        source=str(payload.get("source", "public")).strip().lower() or "public",
    ):
        if event.get("type") == "done":
            data = event
            continue
        sys.stderr.write(json.dumps(event) + "\n")
        sys.stderr.flush()
    sys.stdout.write(json.dumps(data or {"error": "No result produced"}))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        sys.stdout.write(json.dumps({"error": str(exc)}))
        sys.exit(1)
