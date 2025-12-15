#!/usr/bin/env python3
"""
Fix video paths in database to match actual file locations on disk.
Uses SHA256 hash to match videos - the hash is in the filename.

Usage:
    python3 scripts/fix-video-paths.py              # Dry run (shows what would change)
    python3 scripts/fix-video-paths.py --apply      # Actually apply changes

Per lilbits.md: Keep scripts under 300 LOC, one focused function.
"""
import sqlite3
import os
import sys
from pathlib import Path

DB_PATH = 'packages/desktop/data/au-archive.db'

def get_archive_path(conn: sqlite3.Connection) -> str:
    """Get archive path from settings table."""
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM settings WHERE key = 'archive_folder'")
    result = cursor.fetchone()
    if not result:
        raise ValueError("Archive folder not configured in settings")
    return result[0]

def find_video_by_hash(archive_path: str, vidsha: str, ext: str) -> str | None:
    """Search for video file by hash in the archive locations directory."""
    locations_dir = Path(archive_path) / 'locations'
    filename = f"{vidsha}{ext}"

    if not locations_dir.exists():
        return None

    # Recursive search for the file
    for video_file in locations_dir.rglob(filename):
        return str(video_file)

    return None

def main():
    dry_run = '--apply' not in sys.argv

    if dry_run:
        print("=" * 60)
        print("DRY RUN - No changes will be made")
        print("Run with --apply to actually update the database")
        print("=" * 60)
        print()

    # Connect to database
    if not os.path.exists(DB_PATH):
        print(f"Error: Database not found at {DB_PATH}")
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Get archive path
    try:
        archive_path = get_archive_path(conn)
        print(f"Archive path: {archive_path}")
    except ValueError as e:
        print(f"Error: {e}")
        sys.exit(1)

    if not os.path.exists(archive_path):
        print(f"Error: Archive path does not exist: {archive_path}")
        sys.exit(1)

    # Get all videos
    cursor.execute('SELECT vidsha, vidloc FROM vids')
    videos = cursor.fetchall()
    print(f"Found {len(videos)} videos in database")
    print()

    fixed = 0
    already_ok = 0
    not_found = 0

    for vidsha, vidloc in videos:
        # Check if current path exists
        if os.path.exists(vidloc):
            already_ok += 1
            continue

        # Search for file by hash in archive
        ext = Path(vidloc).suffix
        found_path = find_video_by_hash(archive_path, vidsha, ext)

        if found_path:
            print(f"FIXING: {vidsha[:12]}...")
            print(f"  Old: {vidloc}")
            print(f"  New: {found_path}")

            if not dry_run:
                cursor.execute(
                    'UPDATE vids SET vidloc = ? WHERE vidsha = ?',
                    (found_path, vidsha)
                )
            fixed += 1
        else:
            print(f"NOT FOUND: {vidsha[:12]}")
            print(f"  Missing: {vidloc}")
            not_found += 1

    if not dry_run:
        conn.commit()

    conn.close()

    print()
    print("=" * 60)
    print(f"Results:")
    print(f"  Already OK:  {already_ok}")
    print(f"  Fixed:       {fixed}")
    print(f"  Not found:   {not_found}")
    print("=" * 60)

    if dry_run and fixed > 0:
        print()
        print("Run with --apply to actually update the database")

if __name__ == '__main__':
    main()
