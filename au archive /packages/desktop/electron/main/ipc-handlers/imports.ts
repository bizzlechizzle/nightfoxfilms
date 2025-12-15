/**
 * Imports IPC Handlers
 * Handles imports:* IPC channels
 * ADR-046: Updated locid validation from UUID to BLAKE3 16-char hex
 */
import { ipcMain } from 'electron';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { Database } from '../database.types';
import { SQLiteImportRepository } from '../../repositories/sqlite-import-repository';
import { validate, LimitSchema, Blake3IdSchema } from '../ipc-validation';

export function registerImportsHandlers(db: Kysely<Database>) {
  const importRepo = new SQLiteImportRepository(db);

  ipcMain.handle('imports:create', async (_event, input: unknown) => {
    try {
      const ImportInputSchema = z.object({
        locid: Blake3IdSchema.nullable(),
        auth_imp: z.string().nullable(),
        img_count: z.number().int().min(0).optional(),
        vid_count: z.number().int().min(0).optional(),
        doc_count: z.number().int().min(0).optional(),
        map_count: z.number().int().min(0).optional(),
        notes: z.string().nullable().optional(),
      });

      const validatedInput = ImportInputSchema.parse(input);
      return await importRepo.create(validatedInput);
    } catch (error) {
      console.error('Error creating import record:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('imports:findRecent', async (_event, limit: unknown = 5) => {
    try {
      const validatedLimit = validate(LimitSchema, limit);
      return await importRepo.findRecent(validatedLimit);
    } catch (error) {
      console.error('Error finding recent imports:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('imports:findByLocation', async (_event, locid: unknown) => {
    try {
      const validatedId = Blake3IdSchema.parse(locid);
      return await importRepo.findByLocation(validatedId);
    } catch (error) {
      console.error('Error finding imports by location:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('imports:findAll', async () => {
    try {
      return await importRepo.findAll();
    } catch (error) {
      console.error('Error finding all imports:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('imports:getTotalMediaCount', async () => {
    try {
      return await importRepo.getTotalMediaCount();
    } catch (error) {
      console.error('Error getting total media count:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  return importRepo;
}
