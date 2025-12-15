#!/usr/bin/env python3
"""
Migration 39: GPS-based Deduplication for ref_map_points

This script:
1. Creates a backup before running
2. Finds duplicate pins by GPS proximity (~10m = 4 decimal places)
3. Merges duplicates, keeping best name, storing alternates in aka_names

Usage: python3 scripts/run-dedup.py
"""

import sqlite3
import re
import shutil
from pathlib import Path
from datetime import datetime

DB_PATH = Path(__file__).parent.parent / "packages/desktop/data/au-archive.db"
BACKUP_DIR = Path(__file__).parent.parent / "packages/desktop/data/backups"


def score_name(name: str | None) -> int:
    """Score a name for quality - higher is better."""
    if not name:
        return 0

    score = len(name)

    # Penalize coordinate-style names
    if re.match(r'^-?\d+\.\d+,-?\d+\.\d+$', name):
        score = 1

    # Penalize very short names
    if len(name) < 5:
        score -= 10

    # Penalize generic names
    generic_patterns = [
        r'^house$', r'^building$', r'^place$',
        r'^location$', r'^point$', r'^site$',
    ]
    for pattern in generic_patterns:
        if re.match(pattern, name, re.IGNORECASE):
            score -= 20

    # Bonus for proper nouns
    proper_nouns = re.findall(r'[A-Z][a-z]+', name)
    score += len(proper_nouns) * 5

    # Bonus for descriptive suffixes
    descriptive_suffixes = [
        r'factory', r'hospital', r'school', r'church',
        r'theater', r'theatre', r'mill', r'farm',
        r'brewery', r'county', r'poorhouse',
    ]
    for suffix in descriptive_suffixes:
        if re.search(suffix, name, re.IGNORECASE):
            score += 10

    return score


def pick_best_name(names: list[str | None]) -> str | None:
    """Pick the name with highest score."""
    valid_names = [n for n in names if n and n.strip()]
    if not valid_names:
        return None

    best_name = valid_names[0]
    best_score = score_name(best_name)

    for name in valid_names[1:]:
        score = score_name(name)
        if score > best_score:
            best_name = name
            best_score = score

    return best_name


def collect_aka_names(names: list[str | None], primary_name: str | None) -> str | None:
    """Collect alternate names, excluding primary and coordinates."""
    valid_names = [
        n for n in names
        if n and n.strip() and n != primary_name
        and not re.match(r'^-?\d+\.\d+,-?\d+\.\d+$', n)
    ]

    # Remove duplicates (case-insensitive)
    seen = set()
    unique_names = []
    for name in valid_names:
        lower = name.lower()
        if lower not in seen:
            seen.add(lower)
            unique_names.append(name)

    if not unique_names:
        return None
    return ' | '.join(unique_names)


def main():
    print('=' * 60)
    print('Migration 39: GPS-based Deduplication for ref_map_points')
    print('=' * 60)

    # Check database exists
    if not DB_PATH.exists():
        print(f"Database not found at: {DB_PATH}")
        return

    # Create backup
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
    backup_path = BACKUP_DIR / f"au-archive-dedup-{timestamp}.db"
    print(f"\nCreating backup: {backup_path}")
    shutil.copy2(DB_PATH, backup_path)
    print("Backup created successfully.")

    # Connect to database
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    cursor = conn.cursor()

    # Check if aka_names column exists
    cursor.execute("SELECT COUNT(*) FROM pragma_table_info('ref_map_points') WHERE name='aka_names'")
    aka_exists = cursor.fetchone()[0] > 0

    if not aka_exists:
        print("\nAdding aka_names column...")
        cursor.execute("ALTER TABLE ref_map_points ADD COLUMN aka_names TEXT")
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_ref_map_points_gps_rounded
            ON ref_map_points(ROUND(lat, 4), ROUND(lng, 4))
        """)
        conn.commit()
        print("Column added.")
    else:
        print("\naka_names column already exists.")

    # Get all points
    print("\nAnalyzing ref_map_points...")
    cursor.execute("""
        SELECT point_id, name, map_id, description, lat, lng
        FROM ref_map_points
    """)
    points = cursor.fetchall()
    print(f"Total points: {len(points)}")

    # Group by rounded GPS
    groups: dict[tuple, list] = {}
    for row in points:
        point_id, name, map_id, description, lat, lng = row
        rounded_lat = round(lat, 4)
        rounded_lng = round(lng, 4)
        key = (rounded_lat, rounded_lng)

        if key not in groups:
            groups[key] = []
        groups[key].append({
            'point_id': point_id,
            'name': name,
            'map_id': map_id,
            'description': description,
        })

    # Filter to duplicates only
    duplicate_groups = [(k, v) for k, v in groups.items() if len(v) > 1]
    print(f"Duplicate groups found: {len(duplicate_groups)}")

    if not duplicate_groups:
        print("\nNo duplicates to clean up. Database is clean!")
        conn.close()
        return

    # Process each group
    points_removed = 0
    points_with_aka = 0

    print("\nProcessing duplicate groups...\n")

    for (rounded_lat, rounded_lng), group_points in duplicate_groups:
        names = [p['name'] for p in group_points]
        best_name = pick_best_name(names)
        aka_names = collect_aka_names(names, best_name)

        # Find point to keep (best score)
        keep_point = group_points[0]
        keep_score = score_name(keep_point['name'])

        for point in group_points[1:]:
            score = score_name(point['name'])
            if score > keep_score:
                keep_point = point
                keep_score = score

        # Update keeper
        cursor.execute(
            "UPDATE ref_map_points SET name = ?, aka_names = ? WHERE point_id = ?",
            (best_name, aka_names, keep_point['point_id'])
        )

        if aka_names:
            points_with_aka += 1

        # Delete duplicates
        delete_ids = [p['point_id'] for p in group_points if p['point_id'] != keep_point['point_id']]
        for point_id in delete_ids:
            cursor.execute("DELETE FROM ref_map_points WHERE point_id = ?", (point_id,))

        points_removed += len(delete_ids)

        print(f"Merged {len(group_points)} pins at ({rounded_lat}, {rounded_lng})")
        print(f"  Kept: \"{best_name}\"")
        if aka_names:
            print(f"  AKA: \"{aka_names}\"")

    conn.commit()
    conn.close()

    # Summary
    print('\n' + '=' * 60)
    print('DEDUPLICATION COMPLETE')
    print('=' * 60)
    print(f"Total points before: {len(points)}")
    print(f"Points removed: {points_removed}")
    print(f"Unique locations remaining: {len(points) - points_removed}")
    print(f"Points with AKA names: {points_with_aka}")
    print(f"Backup saved to: {backup_path}")


if __name__ == '__main__':
    main()
