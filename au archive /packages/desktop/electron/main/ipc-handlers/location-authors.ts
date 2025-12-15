/**
 * Location Authors IPC Handlers
 * Migration 25 - Phase 3: Author Attribution
 * ADR-046: Updated locid validation from UUID to BLAKE3 16-char hex
 * ADR-049: Updated user_id validation to unified 16-char hex
 *
 * Handles location-authors:* IPC channels for tracking
 * who has contributed to documenting each location.
 */
import { ipcMain } from 'electron';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { Database } from '../database.types';
import { SQLiteLocationAuthorsRepository } from '../../repositories/sqlite-location-authors-repository';
import { Blake3IdSchema, UserIdSchema } from '../ipc-validation';

export function registerLocationAuthorsHandlers(db: Kysely<Database>) {
  const authorsRepo = new SQLiteLocationAuthorsRepository(db);

  /**
   * Add an author to a location
   */
  ipcMain.handle('location-authors:add', async (_event, input: unknown) => {
    try {
      const AddAuthorSchema = z.object({
        locid: Blake3IdSchema,
        user_id: UserIdSchema,
        role: z.enum(['creator', 'documenter', 'contributor']),
      });
      const validatedInput = AddAuthorSchema.parse(input);
      await authorsRepo.addAuthor(validatedInput);
      return { success: true };
    } catch (error) {
      console.error('Error adding author:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Remove an author from a location
   */
  ipcMain.handle('location-authors:remove', async (_event, locid: unknown, user_id: unknown) => {
    try {
      const validatedLocid = Blake3IdSchema.parse(locid);
      const validatedUserId = UserIdSchema.parse(user_id);
      await authorsRepo.removeAuthor(validatedLocid, validatedUserId);
      return { success: true };
    } catch (error) {
      console.error('Error removing author:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Get all authors for a location
   */
  ipcMain.handle('location-authors:findByLocation', async (_event, locid: unknown) => {
    try {
      const validatedLocid = Blake3IdSchema.parse(locid);
      return await authorsRepo.findByLocation(validatedLocid);
    } catch (error) {
      console.error('Error finding authors by location:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Get all locations a user has contributed to
   */
  ipcMain.handle('location-authors:findByUser', async (_event, user_id: unknown) => {
    try {
      const validatedUserId = UserIdSchema.parse(user_id);
      return await authorsRepo.findByUser(validatedUserId);
    } catch (error) {
      console.error('Error finding locations by user:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Get the creator of a location
   */
  ipcMain.handle('location-authors:findCreator', async (_event, locid: unknown) => {
    try {
      const validatedLocid = Blake3IdSchema.parse(locid);
      return await authorsRepo.findCreator(validatedLocid);
    } catch (error) {
      console.error('Error finding creator:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Get count of locations by role for a user
   */
  ipcMain.handle('location-authors:countByUserAndRole', async (_event, user_id: unknown) => {
    try {
      const validatedUserId = UserIdSchema.parse(user_id);
      return await authorsRepo.countByUserAndRole(validatedUserId);
    } catch (error) {
      console.error('Error counting by user and role:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Get count of contributors to a location
   */
  ipcMain.handle('location-authors:countByLocation', async (_event, locid: unknown) => {
    try {
      const validatedLocid = Blake3IdSchema.parse(locid);
      return await authorsRepo.countByLocation(validatedLocid);
    } catch (error) {
      console.error('Error counting by location:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Track a user's contribution (auto-adds/upgrades author role)
   */
  ipcMain.handle('location-authors:trackContribution', async (
    _event,
    locid: unknown,
    user_id: unknown,
    action: unknown
  ) => {
    try {
      const validatedLocid = Blake3IdSchema.parse(locid);
      const validatedUserId = UserIdSchema.parse(user_id);
      const validatedAction = z.enum(['create', 'import', 'edit']).parse(action);
      await authorsRepo.trackUserContribution(validatedLocid, validatedUserId, validatedAction);
      return { success: true };
    } catch (error) {
      console.error('Error tracking contribution:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  return authorsRepo;
}
