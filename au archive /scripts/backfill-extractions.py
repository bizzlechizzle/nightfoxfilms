#!/usr/bin/env python3
"""
Backfill Extraction Queue (OPT-120)

Queues all web sources with extracted_text for LLM processing.
Also runs auto-tagger on all locations without tags.

Usage:
    python3 scripts/backfill-extractions.py
    python3 scripts/backfill-extractions.py --dry-run   # Preview only
"""

import sqlite3
import uuid
import argparse
from pathlib import Path
from datetime import datetime

# Database locations
DEV_DB = Path(__file__).parent.parent / "packages/desktop/data/au-archive.db"
PROD_DB = Path.home() / "Library/Application Support/@au-archive/desktop/au-archive.db"

def get_db_path():
    """Find the database with actual data."""
    if PROD_DB.exists() and PROD_DB.stat().st_size > 0:
        return PROD_DB
    if DEV_DB.exists() and DEV_DB.stat().st_size > 0:
        return DEV_DB
    raise FileNotFoundError("No database found with data")

def generate_id():
    """Generate 16-char hex ID like the app does."""
    return uuid.uuid4().hex[:16]

def queue_web_sources(conn, dry_run=False):
    """Queue web sources that have extracted_text but no smart_title."""
    cursor = conn.cursor()

    # Find web sources needing extraction
    cursor.execute("""
        SELECT source_id, locid, title, LENGTH(extracted_text) as text_len
        FROM web_sources
        WHERE extracted_text IS NOT NULL
          AND LENGTH(extracted_text) > 50
          AND (smart_title IS NULL OR extraction_status != 'completed')
    """)

    sources = cursor.fetchall()
    print(f"\n📄 Web Sources Needing Extraction: {len(sources)}")

    if not sources:
        print("   ✓ All web sources already processed")
        return 0

    for source_id, locid, title, text_len in sources:
        short_title = (title[:50] + '...') if title and len(title) > 50 else title
        print(f"   - {source_id}: {short_title} ({text_len} chars)")

    if dry_run:
        print("\n   [DRY RUN] Would queue these for extraction")
        return len(sources)

    # Queue each source
    queued = 0
    for source_id, locid, title, text_len in sources:
        queue_id = generate_id()
        tasks = '["dates", "entities", "title", "summary"]'

        try:
            cursor.execute("""
                INSERT OR REPLACE INTO extraction_queue
                (queue_id, source_type, source_id, locid, tasks, status, priority, attempts, max_attempts, created_at)
                VALUES (?, 'web_source', ?, ?, ?, 'pending', 0, 0, 3, datetime('now'))
            """, (queue_id, source_id, locid, tasks))
            queued += 1
        except Exception as e:
            print(f"   ⚠ Failed to queue {source_id}: {e}")

    conn.commit()
    print(f"\n   ✓ Queued {queued} web sources for extraction")
    return queued

def tag_locations(conn, dry_run=False):
    """Auto-tag locations missing location_type or era."""
    cursor = conn.cursor()

    # Location type keywords (simplified for SQL LIKE matching)
    type_keywords = {
        'golf-course': ['golf', 'country club', 'fairway', 'clubhouse'],
        'factory': ['factory', 'manufacturing', 'industrial', 'plant', 'mill'],
        'hospital': ['hospital', 'medical', 'clinic'],
        'school': ['school', 'academy', 'college', 'university'],
        'church': ['church', 'cathedral', 'chapel'],
        'theater': ['theater', 'theatre', 'cinema'],
        'hotel': ['hotel', 'motel', 'inn', 'resort'],
        'mall': ['mall', 'shopping', 'plaza'],
        'prison': ['prison', 'jail', 'correctional'],
        'asylum': ['asylum', 'psychiatric', 'mental'],
        'military': ['military', 'army', 'base', 'fort'],
        'power-plant': ['power plant', 'generating', 'reactor'],
        'warehouse': ['warehouse', 'storage', 'depot'],
        'residential': ['house', 'mansion', 'estate', 'home'],
        'farm': ['farm', 'ranch', 'barn'],
        'mine': ['mine', 'mining', 'quarry'],
    }

    # Find locations needing tags
    cursor.execute("""
        SELECT l.locid, l.locnam, l.category, l.built_year, l.location_type, l.era,
               GROUP_CONCAT(ws.extracted_text, ' ') as web_text
        FROM locs l
        LEFT JOIN web_sources ws ON ws.locid = l.locid
        WHERE l.location_type IS NULL OR l.era IS NULL
        GROUP BY l.locid
    """)

    locs = cursor.fetchall()
    print(f"\n🏢 Locations Needing Tags: {len(locs)}")

    if not locs:
        print("   ✓ All locations already tagged")
        return 0

    tagged = 0
    for locid, locnam, category, built_year, loc_type, era, web_text in locs:
        # Combine all text for matching
        all_text = ' '.join(filter(None, [locnam, category, web_text or ''])).lower()

        # Detect location type
        detected_type = None
        if not loc_type:
            for type_name, keywords in type_keywords.items():
                for kw in keywords:
                    if kw in all_text:
                        detected_type = type_name
                        break
                if detected_type:
                    break
            if not detected_type:
                detected_type = 'other'

        # Detect era from built_year
        detected_era = None
        if not era and built_year:
            try:
                year = int(str(built_year)[:4])
                if year < 1900:
                    detected_era = 'pre-1900'
                elif year < 1930:
                    detected_era = '1900-1930'
                elif year < 1960:
                    detected_era = '1930-1960'
                elif year < 1990:
                    detected_era = '1960-1990'
                else:
                    detected_era = '1990-present'
            except:
                pass

        print(f"   - {locnam}")
        print(f"     Type: {loc_type or detected_type or 'unknown'}, Era: {era or detected_era or 'unknown'}")

        if dry_run:
            continue

        # Update if we detected something new
        updates = []
        params = []
        if detected_type and not loc_type:
            updates.append("location_type = ?")
            params.append(detected_type)
        if detected_era and not era:
            updates.append("era = ?")
            params.append(detected_era)

        if updates:
            params.append(locid)
            cursor.execute(f"""
                UPDATE locs SET {', '.join(updates)} WHERE locid = ?
            """, params)
            tagged += 1

    if not dry_run:
        conn.commit()
        print(f"\n   ✓ Tagged {tagged} locations")
    else:
        print(f"\n   [DRY RUN] Would tag {len(locs)} locations")

    return tagged

def show_queue_status(conn):
    """Show current extraction queue status."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
            SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
        FROM extraction_queue
    """)
    total, pending, processing, completed, failed = cursor.fetchone()

    print(f"\n📊 Extraction Queue Status:")
    print(f"   Total: {total or 0}")
    print(f"   Pending: {pending or 0}")
    print(f"   Processing: {processing or 0}")
    print(f"   Completed: {completed or 0}")
    print(f"   Failed: {failed or 0}")

def main():
    parser = argparse.ArgumentParser(description='Backfill extraction queue')
    parser.add_argument('--dry-run', action='store_true', help='Preview without making changes')
    args = parser.parse_args()

    db_path = get_db_path()
    print(f"🗄️  Database: {db_path}")

    if args.dry_run:
        print("🔍 DRY RUN MODE - No changes will be made\n")

    conn = sqlite3.connect(db_path)

    try:
        # Queue web sources for extraction
        queue_web_sources(conn, args.dry_run)

        # Auto-tag locations
        tag_locations(conn, args.dry_run)

        # Show final status
        show_queue_status(conn)

        print("\n" + "="*50)
        if args.dry_run:
            print("To apply changes, run without --dry-run")
        else:
            print("✅ Backfill complete!")
            print("\nNext steps:")
            print("1. Start the app (pnpm dev)")
            print("2. The extraction queue will process automatically")
            print("3. Check extraction:queue:status in DevTools")

    finally:
        conn.close()

if __name__ == '__main__':
    main()
