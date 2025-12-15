#!/usr/bin/env python3
"""
Backfill Image Processing Jobs

Finds images missing ExifTool metadata, thumbnails, or RAM++ tags and queues
processing jobs for them.

Per docs/plans/unified-image-processing-pipeline.md:
- Ensures ALL images receive standard processing regardless of import source
- Queues: ExifTool, Thumbnail, Image Tagging jobs
- Queues location-level jobs once per affected location

Usage:
    python scripts/backfill-image-processing.py              # Apply changes
    python scripts/backfill-image-processing.py --dry-run    # Preview only
    python scripts/backfill-image-processing.py --web-only   # Only web-sourced images
    python scripts/backfill-image-processing.py --limit 100  # Process max 100 images
"""

import argparse
import json
import os
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path


def generate_id() -> str:
    """Generate a BLAKE3-style 16-char hex ID (using UUID for simplicity)."""
    return uuid.uuid4().hex[:16]


def get_db_path() -> Path:
    """Find the database file."""
    # Check common locations
    candidates = [
        Path("packages/desktop/data/au-archive.db"),
        Path("data/au-archive.db"),
        Path.home() / "Library/Application Support/auarchive/auarchive.db",
    ]

    for path in candidates:
        if path.exists():
            return path

    raise FileNotFoundError("Database not found. Run from project root or specify path.")


def find_images_needing_processing(
    conn: sqlite3.Connection,
    web_only: bool = False,
    limit: int | None = None,
) -> list[dict]:
    """Find images missing ExifTool, thumbnails, or tags."""

    query = """
        SELECT
            imghash,
            imgloc,
            locid,
            subid,
            meta_exiftool,
            thumb_path_sm,
            auto_tags,
            extracted_from_web
        FROM imgs
        WHERE hidden = 0
          AND (
              meta_exiftool IS NULL
              OR thumb_path_sm IS NULL
              OR auto_tags IS NULL
          )
    """

    if web_only:
        query += " AND extracted_from_web = 1"

    query += " ORDER BY imgadd DESC"

    if limit:
        query += f" LIMIT {limit}"

    cursor = conn.execute(query)
    columns = [desc[0] for desc in cursor.description]

    results = []
    for row in cursor:
        results.append(dict(zip(columns, row)))

    return results


def get_affected_locations(images: list[dict]) -> set[tuple[str, str | None]]:
    """Get unique (locid, subid) pairs from image list."""
    return {(img["locid"], img["subid"]) for img in images if img["locid"]}


def queue_image_jobs(
    conn: sqlite3.Connection,
    image: dict,
    dry_run: bool = False,
) -> dict:
    """Queue processing jobs for a single image."""

    jobs_queued = []
    now = datetime.utcnow().isoformat() + "Z"

    needs_exiftool = image["meta_exiftool"] is None
    needs_thumbnail = image["thumb_path_sm"] is None
    needs_tagging = image["auto_tags"] is None

    base_payload = {
        "hash": image["imghash"],
        "mediaType": "image",
        "archivePath": image["imgloc"],
        "locid": image["locid"],
        "subid": image["subid"],
    }

    exif_job_id = None

    # 1. ExifTool job
    if needs_exiftool:
        exif_job_id = generate_id()
        job = {
            "job_id": exif_job_id,
            "queue": "exiftool",
            "priority": 50,  # HIGH
            "status": "pending",
            "payload": json.dumps(base_payload),
            "depends_on": None,
            "attempts": 0,
            "max_attempts": 3,
            "error": None,
            "result": None,
            "created_at": now,
            "started_at": None,
            "completed_at": None,
            "locked_by": None,
            "locked_at": None,
            "retry_after": None,
            "last_error": None,
        }

        if not dry_run:
            conn.execute("""
                INSERT INTO jobs (
                    job_id, queue, priority, status, payload, depends_on,
                    attempts, max_attempts, error, result, created_at,
                    started_at, completed_at, locked_by, locked_at,
                    retry_after, last_error
                ) VALUES (
                    :job_id, :queue, :priority, :status, :payload, :depends_on,
                    :attempts, :max_attempts, :error, :result, :created_at,
                    :started_at, :completed_at, :locked_by, :locked_at,
                    :retry_after, :last_error
                )
            """, job)

        jobs_queued.append("exiftool")

    # 2. Thumbnail job
    if needs_thumbnail:
        thumb_job_id = generate_id()
        job = {
            "job_id": thumb_job_id,
            "queue": "thumbnail",
            "priority": 10,  # NORMAL
            "status": "pending",
            "payload": json.dumps(base_payload),
            "depends_on": exif_job_id,
            "attempts": 0,
            "max_attempts": 3,
            "error": None,
            "result": None,
            "created_at": now,
            "started_at": None,
            "completed_at": None,
            "locked_by": None,
            "locked_at": None,
            "retry_after": None,
            "last_error": None,
        }

        if not dry_run:
            conn.execute("""
                INSERT INTO jobs (
                    job_id, queue, priority, status, payload, depends_on,
                    attempts, max_attempts, error, result, created_at,
                    started_at, completed_at, locked_by, locked_at,
                    retry_after, last_error
                ) VALUES (
                    :job_id, :queue, :priority, :status, :payload, :depends_on,
                    :attempts, :max_attempts, :error, :result, :created_at,
                    :started_at, :completed_at, :locked_by, :locked_at,
                    :retry_after, :last_error
                )
            """, job)

        jobs_queued.append("thumbnail")

    # 3. Image tagging job
    if needs_tagging:
        tag_job_id = generate_id()
        tag_payload = {
            "imghash": image["imghash"],
            "imagePath": image["imgloc"],
            "locid": image["locid"],
            "subid": image["subid"],
        }
        job = {
            "job_id": tag_job_id,
            "queue": "image-tagging",
            "priority": 0,  # BACKGROUND
            "status": "pending",
            "payload": json.dumps(tag_payload),
            "depends_on": exif_job_id,
            "attempts": 0,
            "max_attempts": 3,
            "error": None,
            "result": None,
            "created_at": now,
            "started_at": None,
            "completed_at": None,
            "locked_by": None,
            "locked_at": None,
            "retry_after": None,
            "last_error": None,
        }

        if not dry_run:
            conn.execute("""
                INSERT INTO jobs (
                    job_id, queue, priority, status, payload, depends_on,
                    attempts, max_attempts, error, result, created_at,
                    started_at, completed_at, locked_by, locked_at,
                    retry_after, last_error
                ) VALUES (
                    :job_id, :queue, :priority, :status, :payload, :depends_on,
                    :attempts, :max_attempts, :error, :result, :created_at,
                    :started_at, :completed_at, :locked_by, :locked_at,
                    :retry_after, :last_error
                )
            """, job)

        jobs_queued.append("image-tagging")

    return {
        "imghash": image["imghash"][:8],
        "jobs": jobs_queued,
        "exif_job_id": exif_job_id,
    }


def queue_location_jobs(
    conn: sqlite3.Connection,
    locid: str,
    subid: str | None,
    last_exif_job_id: str | None,
    dry_run: bool = False,
) -> list[str]:
    """Queue location-level post-processing jobs."""

    jobs_queued = []
    now = datetime.utcnow().isoformat() + "Z"

    location_payload = {"locid": locid}
    location_with_sub_payload = {"locid": locid, "subid": subid}

    # GPS Enrichment
    gps_job_id = generate_id()
    if not dry_run:
        conn.execute("""
            INSERT INTO jobs (
                job_id, queue, priority, status, payload, depends_on,
                attempts, max_attempts, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            gps_job_id, "gps-enrichment", 10, "pending",
            json.dumps(location_with_sub_payload), last_exif_job_id, 0, 3, now
        ))
    jobs_queued.append("gps-enrichment")

    # Location Stats
    stats_job_id = generate_id()
    if not dry_run:
        conn.execute("""
            INSERT INTO jobs (
                job_id, queue, priority, status, payload, depends_on,
                attempts, max_attempts, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            stats_job_id, "location-stats", 0, "pending",
            json.dumps(location_with_sub_payload), gps_job_id, 0, 3, now
        ))
    jobs_queued.append("location-stats")

    # BagIt Manifest
    bagit_job_id = generate_id()
    if not dry_run:
        conn.execute("""
            INSERT INTO jobs (
                job_id, queue, priority, status, payload, depends_on,
                attempts, max_attempts, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            bagit_job_id, "bagit", 0, "pending",
            json.dumps(location_with_sub_payload), gps_job_id, 0, 3, now
        ))
    jobs_queued.append("bagit")

    # Location Tag Aggregation
    tag_agg_job_id = generate_id()
    if not dry_run:
        conn.execute("""
            INSERT INTO jobs (
                job_id, queue, priority, status, payload, depends_on,
                attempts, max_attempts, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            tag_agg_job_id, "location-tag-aggregation", 0, "pending",
            json.dumps({"locid": locid, "applyType": True, "applyEra": True}),
            gps_job_id, 0, 3, now
        ))
    jobs_queued.append("location-tag-aggregation")

    return jobs_queued


def main():
    parser = argparse.ArgumentParser(
        description="Backfill image processing jobs for images missing metadata/thumbnails/tags"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview changes without applying them",
    )
    parser.add_argument(
        "--web-only",
        action="store_true",
        help="Only process web-sourced images (extracted_from_web=1)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum number of images to process",
    )
    parser.add_argument(
        "--db",
        type=str,
        default=None,
        help="Path to database file",
    )
    args = parser.parse_args()

    # Find database
    if args.db:
        db_path = Path(args.db)
    else:
        db_path = get_db_path()

    print(f"Using database: {db_path}")

    if args.dry_run:
        print("\n=== DRY RUN MODE - No changes will be made ===\n")

    # Connect to database
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    try:
        # Find images needing processing
        print("Scanning for images needing processing...")
        images = find_images_needing_processing(
            conn,
            web_only=args.web_only,
            limit=args.limit,
        )

        if not images:
            print("No images found needing processing.")
            return

        # Count by processing type
        needs_exiftool = sum(1 for img in images if img["meta_exiftool"] is None)
        needs_thumbnail = sum(1 for img in images if img["thumb_path_sm"] is None)
        needs_tagging = sum(1 for img in images if img["auto_tags"] is None)
        web_images = sum(1 for img in images if img["extracted_from_web"] == 1)

        print(f"\nFound {len(images)} images needing processing:")
        print(f"  - Missing ExifTool: {needs_exiftool}")
        print(f"  - Missing Thumbnails: {needs_thumbnail}")
        print(f"  - Missing Tags: {needs_tagging}")
        print(f"  - Web-sourced: {web_images}")

        # Get affected locations
        affected_locations = get_affected_locations(images)
        print(f"  - Affected locations: {len(affected_locations)}")

        # Queue jobs for each image
        print("\nQueuing image processing jobs...")
        total_jobs = 0
        last_exif_job_ids = {}  # Track last exif job per location for dependencies

        for i, image in enumerate(images):
            result = queue_image_jobs(conn, image, dry_run=args.dry_run)
            total_jobs += len(result["jobs"])

            # Track last exif job for this location
            loc_key = (image["locid"], image["subid"])
            if result["exif_job_id"]:
                last_exif_job_ids[loc_key] = result["exif_job_id"]

            if (i + 1) % 100 == 0 or i == len(images) - 1:
                print(f"  Processed {i + 1}/{len(images)} images...")

        print(f"\nQueued {total_jobs} per-image jobs")

        # Queue location-level jobs
        print("\nQueuing location-level jobs...")
        location_jobs = 0

        for locid, subid in affected_locations:
            last_exif = last_exif_job_ids.get((locid, subid))
            jobs = queue_location_jobs(conn, locid, subid, last_exif, dry_run=args.dry_run)
            location_jobs += len(jobs)

        print(f"Queued {location_jobs} location-level jobs")

        # Commit changes
        if not args.dry_run:
            conn.commit()
            print(f"\n=== COMMITTED: {total_jobs + location_jobs} total jobs queued ===")
        else:
            print(f"\n=== DRY RUN: Would queue {total_jobs + location_jobs} total jobs ===")

        # Show queue status
        cursor = conn.execute("""
            SELECT queue, status, COUNT(*) as count
            FROM jobs
            GROUP BY queue, status
            ORDER BY queue, status
        """)

        print("\nCurrent job queue status:")
        for row in cursor:
            print(f"  {row['queue']}: {row['status']} = {row['count']}")

    finally:
        conn.close()


if __name__ == "__main__":
    main()
