import { Kysely } from 'kysely';
import { generateId } from '../main/ipc-validation';
import type { Database, ImportsTable } from '../main/database.types';

export interface ImportRecord {
  import_id: string;
  locid: string | null;
  import_date: string;
  auth_imp: string | null;
  img_count: number;
  vid_count: number;
  doc_count: number;
  map_count: number;
  notes: string | null;
  // Joined location data
  locnam?: string;
  address_state?: string;
  // Hero thumbnail for dashboard display
  heroThumbPath?: string;
}

export interface ImportInput {
  locid: string | null;
  auth_imp: string | null;
  img_count?: number;
  vid_count?: number;
  doc_count?: number;
  map_count?: number;
  notes?: string | null;
}

export class SQLiteImportRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async create(input: ImportInput): Promise<ImportRecord> {
    const import_id = generateId();
    const import_date = new Date().toISOString();

    const record: ImportsTable = {
      import_id,
      locid: input.locid,
      import_date,
      auth_imp: input.auth_imp,
      img_count: input.img_count || 0,
      vid_count: input.vid_count || 0,
      doc_count: input.doc_count || 0,
      map_count: input.map_count || 0,
      notes: input.notes || null,
    };

    await this.db.insertInto('imports').values(record).execute();

    return this.findById(import_id);
  }

  async findById(import_id: string): Promise<ImportRecord> {
    const row = await this.db
      .selectFrom('imports')
      .leftJoin('locs', 'imports.locid', 'locs.locid')
      .selectAll('imports')
      .select(['locs.locnam', 'locs.address_state'])
      .where('imports.import_id', '=', import_id)
      .executeTakeFirstOrThrow();

    return {
      ...row,
      locnam: row.locnam ?? undefined,
      address_state: row.address_state ?? undefined,
    };
  }

  async findRecent(limit: number = 5): Promise<ImportRecord[]> {
    // Get the most recent import for each unique location
    // This prevents showing the same location multiple times in Recent Imports
    const rows = await this.db
      .selectFrom('imports')
      .leftJoin('locs', 'imports.locid', 'locs.locid')
      .select([
        (eb) => eb.fn.max('imports.import_id').as('import_id'),
        'imports.locid',
        (eb) => eb.fn.max('imports.import_date').as('import_date'),
        (eb) => eb.fn.max('imports.auth_imp').as('auth_imp'),
        // Sum up all media counts for the location
        (eb) => eb.fn.sum<number>('imports.img_count').as('img_count'),
        (eb) => eb.fn.sum<number>('imports.vid_count').as('vid_count'),
        (eb) => eb.fn.sum<number>('imports.doc_count').as('doc_count'),
        (eb) => eb.fn.sum<number>('imports.map_count').as('map_count'),
        (eb) => eb.fn.max('imports.notes').as('notes'),
        'locs.locnam',
        'locs.address_state',
        'locs.hero_imghash',
      ])
      .groupBy(['imports.locid', 'locs.locnam', 'locs.address_state', 'locs.hero_imghash'])
      .orderBy('import_date', 'desc')
      .limit(limit)
      .execute();

    // Get hero thumbnail paths for each unique hero_imghash
    const heroHashes = rows
      .map(r => (r as any).hero_imghash)
      .filter((hash): hash is string => !!hash);

    const thumbMap = new Map<string, string>();
    if (heroHashes.length > 0) {
      const thumbRows = await this.db
        .selectFrom('imgs')
        .select(['imghash', 'thumb_path_sm', 'thumb_path_lg', 'thumb_path'])
        .where('imghash', 'in', heroHashes)
        .execute();

      for (const thumb of thumbRows) {
        const path = thumb.thumb_path_sm || thumb.thumb_path_lg || thumb.thumb_path;
        if (path) {
          thumbMap.set(thumb.imghash, path);
        }
      }
    }

    // Map to ensure proper types
    return rows.map(row => ({
      import_id: row.import_id as string,
      locid: row.locid,
      import_date: row.import_date as string,
      auth_imp: row.auth_imp as string | null,
      img_count: Number(row.img_count) || 0,
      vid_count: Number(row.vid_count) || 0,
      doc_count: Number(row.doc_count) || 0,
      map_count: Number(row.map_count) || 0,
      notes: row.notes as string | null,
      locnam: row.locnam ?? undefined,
      address_state: row.address_state ?? undefined,
      heroThumbPath: (row as any).hero_imghash ? thumbMap.get((row as any).hero_imghash) : undefined,
    }));
  }

  async findByLocation(locid: string): Promise<ImportRecord[]> {
    const rows = await this.db
      .selectFrom('imports')
      .leftJoin('locs', 'imports.locid', 'locs.locid')
      .selectAll('imports')
      .select(['locs.locnam', 'locs.address_state'])
      .where('imports.locid', '=', locid)
      .orderBy('imports.import_date', 'desc')
      .execute();

    return rows.map(row => ({
      ...row,
      locnam: row.locnam ?? undefined,
      address_state: row.address_state ?? undefined,
    }));
  }

  async findAll(): Promise<ImportRecord[]> {
    const rows = await this.db
      .selectFrom('imports')
      .leftJoin('locs', 'imports.locid', 'locs.locid')
      .selectAll('imports')
      .select(['locs.locnam', 'locs.address_state'])
      .orderBy('imports.import_date', 'desc')
      .execute();

    return rows.map(row => ({
      ...row,
      locnam: row.locnam ?? undefined,
      address_state: row.address_state ?? undefined,
    }));
  }

  async getTotalMediaCount(): Promise<{ images: number; videos: number; documents: number; maps: number }> {
    const result = await this.db
      .selectFrom('imports')
      .select((eb) => [
        eb.fn.sum<number>('img_count').as('total_images'),
        eb.fn.sum<number>('vid_count').as('total_videos'),
        eb.fn.sum<number>('doc_count').as('total_documents'),
        eb.fn.sum<number>('map_count').as('total_maps'),
      ])
      .executeTakeFirst();

    return {
      images: Number(result?.total_images || 0),
      videos: Number(result?.total_videos || 0),
      documents: Number(result?.total_documents || 0),
      maps: Number(result?.total_maps || 0),
    };
  }
}
