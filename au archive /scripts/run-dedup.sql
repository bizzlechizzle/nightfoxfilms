-- Migration 39: GPS-based Deduplication for ref_map_points
-- Run with: sqlite3 packages/desktop/data/au-archive.db < scripts/run-dedup.sql

-- First check if aka_names column exists, add if not
SELECT CASE
  WHEN COUNT(*) = 0 THEN 'Adding aka_names column...'
  ELSE 'aka_names column already exists'
END FROM pragma_table_info('ref_map_points') WHERE name='aka_names';

-- Create temp table to store dedup results
CREATE TEMP TABLE IF NOT EXISTS dedup_analysis AS
WITH RoundedPoints AS (
  SELECT
    point_id,
    name,
    map_id,
    ROUND(lat, 4) as rounded_lat,
    ROUND(lng, 4) as rounded_lng
  FROM ref_map_points
),
DuplicateGroups AS (
  SELECT
    rounded_lat,
    rounded_lng,
    COUNT(*) as point_count,
    GROUP_CONCAT(point_id, '|') as point_ids,
    GROUP_CONCAT(COALESCE(name, ''), '|') as all_names
  FROM RoundedPoints
  GROUP BY rounded_lat, rounded_lng
  HAVING COUNT(*) > 1
)
SELECT * FROM DuplicateGroups;

-- Show analysis
SELECT 'Duplicate groups found: ' || COUNT(*) FROM dedup_analysis;
SELECT 'Total points in duplicate groups: ' || SUM(point_count) FROM dedup_analysis;

-- Show sample of what will be merged (first 10)
SELECT 'Sample merges:' as info;
SELECT
  '  (' || rounded_lat || ', ' || rounded_lng || ') - ' || point_count || ' points: ' || all_names
FROM dedup_analysis
LIMIT 10;

DROP TABLE dedup_analysis;
