#!/usr/bin/env python3
"""
Backfill web page timeline events for existing websources
Run with: python3 scripts/backfill-timeline.py
"""
import sqlite3
import uuid
import re
from datetime import datetime
from pathlib import Path

# Database path - production location
db_path = Path.home() / 'Library/Application Support/@au-archive/desktop/au-archive.db'

print(f'Opening database: {db_path}')
conn = sqlite3.connect(str(db_path))
conn.row_factory = sqlite3.Row
cursor = conn.cursor()

# Enable foreign keys
cursor.execute('PRAGMA foreign_keys = ON')

def parse_date(input_str):
    """Parse date string into components"""
    if not input_str:
        return None

    # Try ISO date (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)
    iso_match = re.match(r'^(\d{4})-(\d{2})-(\d{2})', input_str)
    if iso_match:
        year, month, day = iso_match.groups()
        return {
            'date_start': f'{year}-{month}-{day}',
            'date_end': None,
            'precision': 'exact',
            'display': f'{year}-{month}-{day}',
            'edtf': f'{year}-{month}-{day}',
            'date_sort': int(f'{year}{month}{day}')
        }

    # Try year-month (YYYY-MM)
    month_match = re.match(r'^(\d{4})-(\d{2})$', input_str)
    if month_match:
        year, month = month_match.groups()
        return {
            'date_start': f'{year}-{month}-01',
            'date_end': None,
            'precision': 'month',
            'display': f'{year}-{month}',
            'edtf': f'{year}-{month}',
            'date_sort': int(f'{year}{month}15')
        }

    # Try year only (YYYY)
    year_match = re.match(r'^(\d{4})$', input_str)
    if year_match:
        year = year_match.group(1)
        return {
            'date_start': f'{year}-01-01',
            'date_end': None,
            'precision': 'year',
            'display': year,
            'edtf': year,
            'date_sort': int(f'{year}0701')
        }

    return None

def generate_id():
    """Generate a 16-character hex ID"""
    return uuid.uuid4().hex[:16]

# Find websources with extracted_date
cursor.execute('''
    SELECT source_id, locid, subid, extracted_date, title, extracted_title
    FROM web_sources
    WHERE extracted_date IS NOT NULL
      AND locid IS NOT NULL
''')
websources = cursor.fetchall()

print(f'Found {len(websources)} websources with dates')

created = 0
skipped = 0
errors = 0

for ws in websources:
    try:
        source_id = ws['source_id']

        # Check if timeline event already exists
        cursor.execute('''
            SELECT event_id FROM location_timeline
            WHERE source_ref = ?
              AND event_type = 'custom'
              AND event_subtype = 'web_page'
        ''', (source_id,))
        existing = cursor.fetchone()

        if existing:
            skipped += 1
            continue

        # Parse the date
        parsed = parse_date(ws['extracted_date'])
        if not parsed:
            print(f'  Could not parse date for {source_id}: {ws["extracted_date"]}')
            errors += 1
            continue

        # Create timeline event
        event_id = generate_id()
        now = datetime.utcnow().isoformat() + 'Z'
        title = ws['extracted_title'] or ws['title'] or 'Web Page'
        trunc_title = title[:47] + '...' if len(title) > 50 else title

        cursor.execute('''
            INSERT INTO location_timeline (
                event_id, locid, subid, event_type, event_subtype,
                date_start, date_end, date_precision, date_display, date_edtf, date_sort,
                source_type, source_ref, notes, created_at
            ) VALUES (?, ?, ?, 'custom', 'web_page', ?, ?, ?, ?, ?, ?, 'web', ?, ?, ?)
        ''', (
            event_id,
            ws['locid'],
            ws['subid'],
            parsed['date_start'],
            parsed['date_end'],
            parsed['precision'],
            parsed['display'],
            parsed['edtf'],
            parsed['date_sort'],
            source_id,
            title,
            now
        ))

        created += 1
        print(f'  Created event for: {trunc_title} ({parsed["display"]})')

    except Exception as e:
        print(f'  Error for {ws["source_id"]}: {e}')
        errors += 1

# Commit changes
conn.commit()
conn.close()

print(f'\nBackfill complete:')
print(f'  Created: {created}')
print(f'  Skipped: {skipped}')
print(f'  Errors: {errors}')
