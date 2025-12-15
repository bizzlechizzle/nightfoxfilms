#!/usr/bin/env python3
"""
Web Text Extraction Script
OPT-109: Extracts clean text content from web pages

Uses Trafilatura (primary) with BeautifulSoup fallback for robust extraction.
Outputs JSON with title, author, date, content, and HTML.

Usage:
    python3 extract-text.py <url>

Output (JSON):
    {
        "title": "Article Title",
        "author": "Author Name",
        "date": "2024-01-15",
        "content": "Clean extracted text...",
        "html": "<article>...</article>"
    }
"""

import sys
import json
import re
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

# Try to import trafilatura (primary extractor)
try:
    import trafilatura
    HAS_TRAFILATURA = True
except ImportError:
    HAS_TRAFILATURA = False

# Try to import beautifulsoup (fallback)
try:
    from bs4 import BeautifulSoup
    HAS_BS4 = True
except ImportError:
    HAS_BS4 = False


def fetch_url(url: str, timeout: int = 30) -> str:
    """Fetch URL content with a reasonable user agent."""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
    }
    request = Request(url, headers=headers)
    with urlopen(request, timeout=timeout) as response:
        return response.read().decode('utf-8', errors='replace')


def extract_with_trafilatura(html: str, url: str) -> dict:
    """Extract content using Trafilatura."""
    if not HAS_TRAFILATURA:
        return None

    # Extract with metadata
    result = trafilatura.extract(
        html,
        url=url,
        include_comments=False,
        include_tables=True,
        include_images=False,
        include_links=False,
        output_format='txt',
        with_metadata=True,
    )

    if not result:
        return None

    # Get metadata
    metadata = trafilatura.extract_metadata(html, url=url)

    # Also get HTML version
    html_result = trafilatura.extract(
        html,
        url=url,
        include_comments=False,
        include_tables=True,
        output_format='html',
    )

    return {
        'title': metadata.title if metadata else None,
        'author': metadata.author if metadata else None,
        'date': metadata.date if metadata else None,
        'content': result,
        'html': html_result or '',
    }


def extract_with_beautifulsoup(html: str) -> dict:
    """Extract content using BeautifulSoup (fallback)."""
    if not HAS_BS4:
        return None

    soup = BeautifulSoup(html, 'html.parser')

    # Remove scripts, styles, and other non-content elements
    for tag in soup.find_all(['script', 'style', 'nav', 'header', 'footer',
                              'aside', 'form', 'iframe', 'noscript']):
        tag.decompose()

    # Try to find main content area
    main_content = (
        soup.find('main') or
        soup.find('article') or
        soup.find('div', {'class': re.compile(r'content|article|post|entry', re.I)}) or
        soup.find('div', {'id': re.compile(r'content|article|post|entry', re.I)}) or
        soup.body
    )

    if not main_content:
        return None

    # Extract text
    text = main_content.get_text(separator='\n', strip=True)
    # Clean up whitespace
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r' {2,}', ' ', text)

    # Extract title
    title = None
    title_tag = soup.find('h1')
    if title_tag:
        title = title_tag.get_text(strip=True)
    elif soup.title:
        title = soup.title.get_text(strip=True)

    # Extract author (various common patterns)
    author = None
    author_tag = (
        soup.find('meta', {'name': 'author'}) or
        soup.find('meta', {'property': 'article:author'}) or
        soup.find('a', {'rel': 'author'}) or
        soup.find('span', {'class': re.compile(r'author|byline', re.I)})
    )
    if author_tag:
        if author_tag.name == 'meta':
            author = author_tag.get('content')
        else:
            author = author_tag.get_text(strip=True)

    # Extract date
    date = None
    date_tag = (
        soup.find('meta', {'property': 'article:published_time'}) or
        soup.find('meta', {'name': 'date'}) or
        soup.find('time')
    )
    if date_tag:
        if date_tag.name == 'meta':
            date = date_tag.get('content')
        else:
            date = date_tag.get('datetime') or date_tag.get_text(strip=True)

    return {
        'title': title,
        'author': author,
        'date': date,
        'content': text,
        'html': str(main_content) if main_content else '',
    }


def extract_basic(html: str) -> dict:
    """Basic extraction without any libraries (last resort)."""
    # Remove all tags
    text = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL | re.I)
    text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL | re.I)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'&nbsp;', ' ', text)
    text = re.sub(r'&amp;', '&', text)
    text = re.sub(r'&lt;', '<', text)
    text = re.sub(r'&gt;', '>', text)
    text = re.sub(r'\s+', ' ', text)
    text = text.strip()

    # Try to extract title from HTML
    title_match = re.search(r'<title[^>]*>([^<]+)</title>', html, re.I)
    title = title_match.group(1).strip() if title_match else None

    return {
        'title': title,
        'author': None,
        'date': None,
        'content': text,
        'html': '',
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'URL required'}), file=sys.stderr)
        sys.exit(1)

    url = sys.argv[1]

    try:
        # Fetch the page
        html = fetch_url(url)

        # Try extraction methods in order of preference
        result = None

        # 1. Try Trafilatura (best quality)
        if HAS_TRAFILATURA:
            result = extract_with_trafilatura(html, url)

        # 2. Fall back to BeautifulSoup
        if not result and HAS_BS4:
            result = extract_with_beautifulsoup(html)

        # 3. Last resort: basic regex extraction
        if not result:
            result = extract_basic(html)

        # Output JSON
        print(json.dumps(result, ensure_ascii=False))

    except HTTPError as e:
        print(json.dumps({'error': f'HTTP {e.code}: {e.reason}'}), file=sys.stderr)
        sys.exit(1)
    except URLError as e:
        print(json.dumps({'error': f'URL error: {e.reason}'}), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({'error': str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
