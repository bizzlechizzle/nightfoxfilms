import { Kysely } from 'kysely';
import { createHash } from 'crypto';
import { generateId } from '../main/ipc-validation';
import type { Database, UsersTable } from '../main/database.types';

export interface UserInput {
  username: string;
  display_name?: string | null;
  pin?: string | null;
}

export interface User {
  user_id: string;
  username: string;
  display_name: string | null;
  created_date: string;
  has_pin: boolean;
  is_active: boolean;
  last_login: string | null;
}

/**
 * Hash a PIN using SHA256
 * For local desktop app security - sufficient for protecting against casual access
 */
function hashPin(pin: string): string {
  return createHash('sha256').update(pin).digest('hex');
}

/**
 * Transform database row to User interface
 */
function toUser(row: UsersTable): User {
  return {
    user_id: row.user_id,
    username: row.username,
    display_name: row.display_name,
    created_date: row.created_date,
    has_pin: row.pin_hash !== null,
    is_active: row.is_active === 1,
    last_login: row.last_login,
  };
}

/**
 * Repository for managing users
 */
export class SQLiteUsersRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async create(input: UserInput): Promise<User> {
    const user_id = generateId();
    const created_date = new Date().toISOString();

    const user: UsersTable = {
      user_id,
      username: input.username,
      display_name: input.display_name || null,
      created_date,
      pin_hash: input.pin ? hashPin(input.pin) : null,
      is_active: 1,
      last_login: null,
    };

    await this.db.insertInto('users').values(user).execute();
    return this.findById(user_id);
  }

  async findById(user_id: string): Promise<User> {
    const row = await this.db
      .selectFrom('users')
      .selectAll()
      .where('user_id', '=', user_id)
      .executeTakeFirstOrThrow();
    return toUser(row);
  }

  async findByUsername(username: string): Promise<User | null> {
    const row = await this.db
      .selectFrom('users')
      .selectAll()
      .where('username', '=', username)
      .executeTakeFirst();
    return row ? toUser(row) : null;
  }

  async findAll(): Promise<User[]> {
    const rows = await this.db
      .selectFrom('users')
      .selectAll()
      .where('is_active', '=', 1)
      .orderBy('username', 'asc')
      .execute();
    return rows.map(toUser);
  }

  async findAllIncludingInactive(): Promise<User[]> {
    const rows = await this.db
      .selectFrom('users')
      .selectAll()
      .orderBy('username', 'asc')
      .execute();
    return rows.map(toUser);
  }

  async delete(user_id: string): Promise<void> {
    // Soft delete - mark as inactive
    await this.db
      .updateTable('users')
      .set({ is_active: 0 })
      .where('user_id', '=', user_id)
      .execute();
  }

  async hardDelete(user_id: string): Promise<void> {
    await this.db.deleteFrom('users').where('user_id', '=', user_id).execute();
  }

  // ==================== Authentication Methods ====================

  /**
   * Verify a user's PIN
   * Returns true if PIN matches, false otherwise
   */
  async verifyPin(user_id: string, pin: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('users')
      .select(['pin_hash'])
      .where('user_id', '=', user_id)
      .where('is_active', '=', 1)
      .executeTakeFirst();

    if (!row || !row.pin_hash) {
      return false;
    }

    return row.pin_hash === hashPin(pin);
  }

  /**
   * Set or update a user's PIN
   */
  async setPin(user_id: string, pin: string): Promise<void> {
    await this.db
      .updateTable('users')
      .set({ pin_hash: hashPin(pin) })
      .where('user_id', '=', user_id)
      .execute();
  }

  /**
   * Clear a user's PIN (removes PIN requirement)
   */
  async clearPin(user_id: string): Promise<void> {
    await this.db
      .updateTable('users')
      .set({ pin_hash: null })
      .where('user_id', '=', user_id)
      .execute();
  }

  /**
   * Check if a user has a PIN set
   */
  async hasPin(user_id: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('users')
      .select(['pin_hash'])
      .where('user_id', '=', user_id)
      .executeTakeFirst();

    return row?.pin_hash !== null && row?.pin_hash !== undefined;
  }

  /**
   * Update last login timestamp
   */
  async updateLastLogin(user_id: string): Promise<void> {
    await this.db
      .updateTable('users')
      .set({ last_login: new Date().toISOString() })
      .where('user_id', '=', user_id)
      .execute();
  }

  /**
   * Update user profile (username, display_name)
   */
  async update(user_id: string, updates: { username?: string; display_name?: string | null }): Promise<User> {
    await this.db
      .updateTable('users')
      .set(updates)
      .where('user_id', '=', user_id)
      .execute();
    return this.findById(user_id);
  }

  /**
   * Check if any users have PINs set (for login requirement)
   */
  async anyUserHasPin(): Promise<boolean> {
    const row = await this.db
      .selectFrom('users')
      .select(['user_id'])
      .where('is_active', '=', 1)
      .where('pin_hash', 'is not', null)
      .executeTakeFirst();

    return row !== undefined;
  }
}
