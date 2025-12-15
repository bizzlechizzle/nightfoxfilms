/**
 * SQLite Repository for Reference Maps
 * Handles CRUD operations for imported map files and their extracted points.
 */

import { Kysely } from 'kysely';
import { generateId } from '../main/ipc-validation';
import type { Database, RefMapsTable, RefMapPointsTable } from '../main/database.types';

export interface RefMap {
  mapId: string;
  mapName: string;
  filePath: string;
  fileType: string;
  pointCount: number;
  importedAt: string;
  importedBy: string | null;
}

export interface RefMapPoint {
  pointId: string;
  mapId: string;
  name: string | null;
  description: string | null;
  lat: number;
  lng: number;
  state: string | null;
  category: string | null;
  rawMetadata: Record<string, unknown> | null;
  // Migration 39: AKA names from merged duplicate pins
  akaNames: string | null;
  // Migration 42: Link to location when GPS enrichment applied
  linkedLocid: string | null;
  linkedAt: string | null;
}

export interface RefMapWithPoints extends RefMap {
  points: RefMapPoint[];
}

/**
 * Convert database row to RefMap domain object
 */
function rowToRefMap(row: RefMapsTable): RefMap {
  return {
    mapId: row.map_id,
    mapName: row.map_name,
    filePath: row.file_path,
    fileType: row.file_type,
    pointCount: row.point_count,
    importedAt: row.imported_at,
    importedBy: row.imported_by
  };
}

/**
 * Convert database row to RefMapPoint domain object
 */
function rowToRefMapPoint(row: RefMapPointsTable): RefMapPoint {
  return {
    pointId: row.point_id,
    mapId: row.map_id,
    name: row.name,
    description: row.description,
    lat: row.lat,
    lng: row.lng,
    state: row.state,
    category: row.category,
    rawMetadata: row.raw_metadata ? JSON.parse(row.raw_metadata) : null,
    akaNames: row.aka_names,
    // Migration 42: Link to location when GPS enrichment applied
    linkedLocid: row.linked_locid,
    linkedAt: row.linked_at,
  };
}

export class SqliteRefMapsRepository {
  constructor(private db: Kysely<Database>) {}

  /**
   * Create a new reference map with its points
   * OPT-005: Uses transaction to ensure all operations succeed or all fail
   */
  async create(input: {
    mapName: string;
    filePath: string;
    fileType: string;
    importedBy?: string | null;
    points: Array<{
      name: string | null;
      description: string | null;
      lat: number;
      lng: number;
      state: string | null;
      category: string | null;
      rawMetadata: Record<string, unknown> | null;
    }>;
  }): Promise<RefMapWithPoints> {
    const mapId = generateId();
    const now = new Date().toISOString();

    // OPT-005: Use transaction to ensure map and all points are created atomically
    const pointRecords: RefMapPoint[] = [];

    await this.db.transaction().execute(async (trx) => {
      // Insert the map record
      await trx
        .insertInto('ref_maps')
        .values({
          map_id: mapId,
          map_name: input.mapName,
          file_path: input.filePath,
          file_type: input.fileType,
          point_count: input.points.length,
          imported_at: now,
          imported_by: input.importedBy || null
        })
        .execute();

      // Insert all points within the same transaction
      for (const point of input.points) {
        const pointId = generateId();
        await trx
          .insertInto('ref_map_points')
          .values({
            point_id: pointId,
            map_id: mapId,
            name: point.name,
            description: point.description,
            lat: point.lat,
            lng: point.lng,
            state: point.state,
            category: point.category,
            raw_metadata: point.rawMetadata ? JSON.stringify(point.rawMetadata) : null
          })
          .execute();

        pointRecords.push({
          pointId,
          mapId,
          name: point.name,
          description: point.description,
          lat: point.lat,
          lng: point.lng,
          state: point.state,
          category: point.category,
          rawMetadata: point.rawMetadata,
          akaNames: null,
          linkedLocid: null,
          linkedAt: null
        });
      }
    });

    return {
      mapId,
      mapName: input.mapName,
      filePath: input.filePath,
      fileType: input.fileType,
      pointCount: input.points.length,
      importedAt: now,
      importedBy: input.importedBy || null,
      points: pointRecords
    };
  }

  /**
   * Find all reference maps (without points for performance)
   */
  async findAll(): Promise<RefMap[]> {
    const rows = await this.db
      .selectFrom('ref_maps')
      .selectAll()
      .orderBy('imported_at', 'desc')
      .execute();

    return rows.map(rowToRefMap);
  }

  /**
   * Find a reference map by ID
   */
  async findById(mapId: string): Promise<RefMap | null> {
    const row = await this.db
      .selectFrom('ref_maps')
      .selectAll()
      .where('map_id', '=', mapId)
      .executeTakeFirst();

    return row ? rowToRefMap(row) : null;
  }

  /**
   * Find a reference map with all its points
   */
  async findByIdWithPoints(mapId: string): Promise<RefMapWithPoints | null> {
    const mapRow = await this.db
      .selectFrom('ref_maps')
      .selectAll()
      .where('map_id', '=', mapId)
      .executeTakeFirst();

    if (!mapRow) return null;

    const pointRows = await this.db
      .selectFrom('ref_map_points')
      .selectAll()
      .where('map_id', '=', mapId)
      .execute();

    return {
      ...rowToRefMap(mapRow),
      points: pointRows.map(rowToRefMapPoint)
    };
  }

  /**
   * Get all unlinked points from all maps (for Atlas display)
   * OPT-049: Filters linked points in SQL and applies limit for performance
   * @param limit Maximum points to return (default 5000)
   */
  async getAllPoints(limit: number = 5000): Promise<RefMapPoint[]> {
    const rows = await this.db
      .selectFrom('ref_map_points')
      .selectAll()
      .where('linked_locid', 'is', null)  // Filter linked points in SQL, not JS
      .limit(limit)
      .execute();

    return rows.map(rowToRefMapPoint);
  }

  /**
   * Get points for a specific map
   */
  async getPointsByMapId(mapId: string): Promise<RefMapPoint[]> {
    const rows = await this.db
      .selectFrom('ref_map_points')
      .selectAll()
      .where('map_id', '=', mapId)
      .execute();

    return rows.map(rowToRefMapPoint);
  }

  /**
   * Get points filtered by state
   */
  async getPointsByState(state: string): Promise<RefMapPoint[]> {
    const rows = await this.db
      .selectFrom('ref_map_points')
      .selectAll()
      .where('state', '=', state)
      .execute();

    return rows.map(rowToRefMapPoint);
  }

  /**
   * Get points filtered by category
   */
  async getPointsByCategory(category: string): Promise<RefMapPoint[]> {
    const rows = await this.db
      .selectFrom('ref_map_points')
      .selectAll()
      .where('category', '=', category)
      .execute();

    return rows.map(rowToRefMapPoint);
  }

  /**
   * Update a reference map's name
   */
  async update(mapId: string, updates: { mapName?: string }): Promise<RefMap | null> {
    const updateValues: Partial<RefMapsTable> = {};
    if (updates.mapName !== undefined) {
      updateValues.map_name = updates.mapName;
    }

    if (Object.keys(updateValues).length === 0) {
      return this.findById(mapId);
    }

    await this.db
      .updateTable('ref_maps')
      .set(updateValues)
      .where('map_id', '=', mapId)
      .execute();

    return this.findById(mapId);
  }

  /**
   * Delete a reference map and all its points (cascade)
   */
  async delete(mapId: string): Promise<void> {
    // Points will be deleted automatically via ON DELETE CASCADE
    await this.db
      .deleteFrom('ref_maps')
      .where('map_id', '=', mapId)
      .execute();
  }

  /**
   * Count total reference maps
   */
  async count(): Promise<number> {
    const result = await this.db
      .selectFrom('ref_maps')
      .select(({ fn }) => fn.count<number>('map_id').as('count'))
      .executeTakeFirst();

    return result?.count ?? 0;
  }

  /**
   * Count total points across all maps
   */
  async countPoints(): Promise<number> {
    const result = await this.db
      .selectFrom('ref_map_points')
      .select(({ fn }) => fn.count<number>('point_id').as('count'))
      .executeTakeFirst();

    return result?.count ?? 0;
  }

  /**
   * Get unique categories across all points
   */
  async getCategories(): Promise<string[]> {
    const rows = await this.db
      .selectFrom('ref_map_points')
      .select('category')
      .distinct()
      .where('category', 'is not', null)
      .execute();

    return rows.map(r => r.category).filter((c): c is string => c !== null);
  }

  /**
   * Get unique states across all points
   */
  async getStates(): Promise<string[]> {
    const rows = await this.db
      .selectFrom('ref_map_points')
      .select('state')
      .distinct()
      .where('state', 'is not', null)
      .execute();

    return rows.map(r => r.state).filter((s): s is string => s !== null);
  }

  /**
   * Search points by name (for future auto-matching)
   */
  async searchPoints(query: string, limit = 100): Promise<RefMapPoint[]> {
    const rows = await this.db
      .selectFrom('ref_map_points')
      .selectAll()
      .where('name', 'like', `%${query}%`)
      .limit(limit)
      .execute();

    return rows.map(rowToRefMapPoint);
  }

  /**
   * OPT-037: Get points within map viewport bounds
   * Spatial query for Atlas - only loads visible reference points
   * Excludes linked points (already associated with locations)
   * @param bounds Map viewport bounds (north, south, east, west)
   * @param limit Maximum points to return (default 1000)
   * @returns Reference points within bounds
   */
  async getPointsInBounds(bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  }, limit: number = 1000): Promise<RefMapPoint[]> {
    let query = this.db
      .selectFrom('ref_map_points')
      .selectAll()
      .where('lat', '<=', bounds.north)
      .where('lat', '>=', bounds.south)
      .where('linked_locid', 'is', null); // Exclude linked points

    if (bounds.east >= bounds.west) {
      // Normal case
      query = query
        .where('lng', '<=', bounds.east)
        .where('lng', '>=', bounds.west);
    } else {
      // Date line crossing
      query = query.where((eb) =>
        eb.or([
          eb('lng', '>=', bounds.west),
          eb('lng', '<=', bounds.east),
        ])
      );
    }

    query = query.limit(limit);

    const rows = await query.execute();
    return rows.map(rowToRefMapPoint);
  }

  /**
   * OPT-037: Count reference points in viewport
   */
  async countPointsInBounds(bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  }): Promise<number> {
    let query = this.db
      .selectFrom('ref_map_points')
      .select(({ fn }) => fn.count<number>('point_id').as('count'))
      .where('lat', '<=', bounds.north)
      .where('lat', '>=', bounds.south)
      .where('linked_locid', 'is', null);

    if (bounds.east >= bounds.west) {
      query = query
        .where('lng', '<=', bounds.east)
        .where('lng', '>=', bounds.west);
    } else {
      query = query.where((eb) =>
        eb.or([
          eb('lng', '>=', bounds.west),
          eb('lng', '<=', bounds.east),
        ])
      );
    }

    const result = await query.executeTakeFirst();
    return result?.count ?? 0;
  }

  /**
   * Migration 38: Delete a single ref_map_point after conversion to location
   * ADR: ADR-pin-conversion-duplicate-prevention.md
   *
   * Original map file (ref_maps) is preserved - only the point is deleted.
   * This removes the pin from the map while keeping the source file reference.
   */
  async deletePoint(pointId: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('ref_map_points')
      .where('point_id', '=', pointId)
      .execute();

    const deleted = (result[0]?.numDeletedRows ?? 0) > 0;
    if (deleted) {
      console.log(`[RefMaps] Deleted ref_map_point: ${pointId}`);
    }
    return deleted;
  }

  /**
   * Migration 38: Delete multiple ref_map_points
   * Used for bulk conversion cleanup
   */
  async deletePoints(pointIds: string[]): Promise<number> {
    if (pointIds.length === 0) return 0;

    const result = await this.db
      .deleteFrom('ref_map_points')
      .where('point_id', 'in', pointIds)
      .execute();

    const deleted = Number(result[0]?.numDeletedRows ?? 0);
    console.log(`[RefMaps] Deleted ${deleted} ref_map_points`);
    return deleted;
  }
}
