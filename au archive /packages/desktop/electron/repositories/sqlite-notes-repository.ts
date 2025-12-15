import { Kysely } from 'kysely';
import { generateId } from '../main/ipc-validation';
import type { Database, NotesTable } from '../main/database.types';

export interface NoteInput {
  locid: string;
  note_text: string;
  auth_imp?: string | null;
  note_type?: string;
}

export interface NoteUpdate {
  note_text?: string;
  note_type?: string;
}

export interface Note {
  note_id: string;
  locid: string;
  note_text: string;
  note_date: string;
  auth_imp: string | null;
  note_type: string;
  // Joined fields from locs table
  locnam?: string;
}

/**
 * Repository for managing location notes
 */
export class SQLiteNotesRepository {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * Create a new note
   */
  async create(input: NoteInput): Promise<Note> {
    const note_id = generateId();
    const note_date = new Date().toISOString();

    const note: NotesTable = {
      note_id,
      locid: input.locid,
      note_text: input.note_text,
      note_date,
      auth_imp: input.auth_imp || null,
      note_type: input.note_type || 'general',
    };

    await this.db.insertInto('notes').values(note).execute();

    return this.findById(note_id);
  }

  /**
   * Find a note by ID
   */
  async findById(note_id: string): Promise<Note> {
    const result = await this.db
      .selectFrom('notes')
      .leftJoin('locs', 'notes.locid', 'locs.locid')
      .selectAll('notes')
      .select('locs.locnam')
      .where('notes.note_id', '=', note_id)
      .executeTakeFirstOrThrow();

    return result as Note;
  }

  /**
   * Find all notes for a specific location
   * Returns notes in reverse chronological order (newest first)
   */
  async findByLocation(locid: string): Promise<Note[]> {
    const results = await this.db
      .selectFrom('notes')
      .leftJoin('locs', 'notes.locid', 'locs.locid')
      .selectAll('notes')
      .select('locs.locnam')
      .where('notes.locid', '=', locid)
      .orderBy('notes.note_date', 'desc')
      .execute();

    return results as Note[];
  }

  /**
   * Find recent notes across all locations
   */
  async findRecent(limit: number = 10): Promise<Note[]> {
    const results = await this.db
      .selectFrom('notes')
      .leftJoin('locs', 'notes.locid', 'locs.locid')
      .selectAll('notes')
      .select('locs.locnam')
      .orderBy('notes.note_date', 'desc')
      .limit(limit)
      .execute();

    return results as Note[];
  }

  /**
   * Update a note
   */
  async update(note_id: string, updates: NoteUpdate): Promise<Note> {
    await this.db
      .updateTable('notes')
      .set(updates)
      .where('note_id', '=', note_id)
      .execute();

    return this.findById(note_id);
  }

  /**
   * Delete a note
   */
  async delete(note_id: string): Promise<void> {
    await this.db.deleteFrom('notes').where('note_id', '=', note_id).execute();
  }

  /**
   * Get total note count for a location
   */
  async countByLocation(locid: string): Promise<number> {
    const result = await this.db
      .selectFrom('notes')
      .select((eb) => eb.fn.count<number>('note_id').as('count'))
      .where('locid', '=', locid)
      .executeTakeFirstOrThrow();

    return result.count;
  }

  /**
   * Get notes by type for a location
   */
  async findByLocationAndType(locid: string, note_type: string): Promise<Note[]> {
    const results = await this.db
      .selectFrom('notes')
      .leftJoin('locs', 'notes.locid', 'locs.locid')
      .selectAll('notes')
      .select('locs.locnam')
      .where('notes.locid', '=', locid)
      .where('notes.note_type', '=', note_type)
      .orderBy('notes.note_date', 'desc')
      .execute();

    return results as Note[];
  }
}
