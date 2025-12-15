#!/usr/bin/env python3
"""
OPT-110: Text extraction script for AU Archive web sources.
Uses Trafilatura for main content extraction with BeautifulSoup fallback.

Usage: python extract-text.py <url> <output_path>
Output: JSON with title, author, date, content, wordCount, hash

This script provides better text extraction than browser-based extraction
by using specialized libraries that understand article structure and
can filter out navigation, ads, and boilerplate content.

Dependencies:
    pip install trafilatura beautifulsoup4 requests

Per CLAUDE.md/lilbits.md: Scripts under 300 LOC, single focused purpose.
"""

import sys
import json
import hashlib
import html
import re
from datetime import datetime
from typing import Optional, Dict, Any

# Try importing optional dependencies with graceful fallback
try:
    import trafilatura
    HAS_TRAFILATURA = True
except ImportError:
    HAS_TRAFILATURA = False

try:
    from bs4 import BeautifulSoup
    import requests
    HAS_BEAUTIFULSOUP = True
except ImportError:
    HAS_BEAUTIFULSOUP = False


def decode_html_entities(text: str) -> str:
    """Decode HTML entities like &#x2014; to actual characters."""
    if not text:
        return text
    # Decode named and numeric entities
    decoded = html.unescape(text)
    return decoded


def clean_text(text: str) -> str:
    """Clean and normalize extracted text."""
    if not text:
        return ''
    # Decode HTML entities
    text = decode_html_entities(text)
    # Normalize whitespace
    text = re.sub(r'\s+', ' ', text)
    # Remove leading/trailing whitespace
    text = text.strip()
    return text


def extract_with_trafilatura(url: str) -> Optional[Dict[str, Any]]:
    """Extract content using Trafilatura (preferred method)."""
    if not HAS_TRAFILATURA:
        return None

    try:
        downloaded = trafilatura.fetch_url(url)
        if not downloaded:
            return None

        # Extract with full metadata
        result = trafilatura.extract(
            downloaded,
            include_comments=False,
            include_tables=True,
            no_fallback=False,
            favor_precision=True,
            output_format='json'
        )

        if not result:
            return None

        data = json.loads(result)
        content = clean_text(data.get('text', ''))

        return {
            'title': clean_text(data.get('title')),
            'author': clean_text(data.get('author')),
            'date': data.get('date'),
            'content': content,
            'wordCount': len(content.split()) if content else 0,
            'method': 'trafilatura'
        }
    except Exception as e:
        print(f"Trafilatura error: {e}", file=sys.stderr)
        return None


def extract_with_beautifulsoup(url: str) -> Optional[Dict[str, Any]]:
    """Fallback extraction using BeautifulSoup."""
    if not HAS_BEAUTIFULSOUP:
        return None

    try:
        response = requests.get(url, timeout=30, headers={
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (compatible; AUArchive/1.0)'
        })
        response.raise_for_status()

        soup = BeautifulSoup(response.text, 'html.parser')

        # Remove script, style, nav, footer, sidebar elements
        for tag in soup(['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript']):
            tag.decompose()

        # Remove common ad/navigation class patterns
        for element in soup.find_all(class_=re.compile(r'(sidebar|menu|nav|ad|cookie|popup|modal|share|social)', re.I)):
            element.decompose()

        # Try to find main content using semantic hierarchy
        main_content = (
            soup.find('article') or
            soup.find('main') or
            soup.find(class_=re.compile(r'(content|post-content|entry-content|article-body)', re.I)) or
            soup.find(id=re.compile(r'(content|main|article)', re.I)) or
            soup.find('body')
        )

        if not main_content:
            return None

        content = clean_text(main_content.get_text(separator=' ', strip=True))

        # Extract metadata
        title = None
        title_tag = soup.find('title')
        if title_tag:
            title = clean_text(title_tag.get_text(strip=True))

        # Try og:title if regular title looks like site name
        og_title = soup.find('meta', property='og:title')
        if og_title and og_title.get('content'):
            og_title_text = clean_text(og_title['content'])
            if og_title_text and (not title or len(og_title_text) > len(title)):
                title = og_title_text

        author = None
        author_meta = soup.find('meta', attrs={'name': 'author'})
        if author_meta:
            author = clean_text(author_meta.get('content'))

        date = None
        # Try multiple date meta tags
        for prop in ['article:published_time', 'datePublished', 'date']:
            date_meta = soup.find('meta', attrs={'property': prop}) or soup.find('meta', attrs={'name': prop})
            if date_meta and date_meta.get('content'):
                date = date_meta['content']
                break

        return {
            'title': title,
            'author': author,
            'date': date,
            'content': content,
            'wordCount': len(content.split()) if content else 0,
            'method': 'beautifulsoup'
        }
    except Exception as e:
        print(f"BeautifulSoup error: {e}", file=sys.stderr)
        return None


def calculate_hash(content: str) -> str:
    """
    Calculate content hash for integrity verification.
    Uses first 16 hex chars to match BLAKE3 format used elsewhere in app.
    """
    return hashlib.sha256(content.encode('utf-8')).hexdigest()[:16]


def main():
    if len(sys.argv) < 3:
        print("Usage: extract-text.py <url> <output_path>", file=sys.stderr)
        sys.exit(1)

    url = sys.argv[1]
    output_path = sys.argv[2]

    # Try Trafilatura first (better quality), then BeautifulSoup
    result = extract_with_trafilatura(url)
    if not result:
        result = extract_with_beautifulsoup(url)

    if not result:
        # Return empty result on failure
        result = {
            'title': None,
            'author': None,
            'date': None,
            'content': '',
            'wordCount': 0,
            'method': 'failed'
        }

    # Add metadata
    result['hash'] = calculate_hash(result.get('content', ''))
    result['extractedAt'] = datetime.utcnow().isoformat() + 'Z'
    result['url'] = url

    # Write output to file
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    # Also print to stdout for Node.js to capture
    print(json.dumps(result))


if __name__ == '__main__':
    main()
