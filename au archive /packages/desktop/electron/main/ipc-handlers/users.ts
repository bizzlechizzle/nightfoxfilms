/**
 * Users IPC Handlers
 * Handles users:* IPC channels
 * Migration 24: Added PIN authentication methods
 * ADR-049: Updated user_id validation from UUID to 16-char hex
 */
import { ipcMain } from 'electron';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { Database } from '../database.types';
import { SQLiteUsersRepository } from '../../repositories/sqlite-users-repository';
import { UserIdSchema } from '../ipc-validation';

export function registerUsersHandlers(db: Kysely<Database>) {
  const usersRepo = new SQLiteUsersRepository(db);

  // ==================== User CRUD ====================

  ipcMain.handle('users:create', async (_event, input: unknown) => {
    try {
      const UserInputSchema = z.object({
        username: z.string().min(1),
        display_name: z.string().nullable().optional(),
        pin: z.string().min(4).max(6).regex(/^\d+$/).nullable().optional(),
      });
      const validatedInput = UserInputSchema.parse(input);
      return await usersRepo.create(validatedInput);
    } catch (error) {
      console.error('Error creating user:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('users:findAll', async () => {
    try {
      return await usersRepo.findAll();
    } catch (error) {
      console.error('Error finding users:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('users:findById', async (_event, user_id: unknown) => {
    try {
      const validatedId = UserIdSchema.parse(user_id);
      return await usersRepo.findById(validatedId);
    } catch (error) {
      console.error('Error finding user by id:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('users:findByUsername', async (_event, username: unknown) => {
    try {
      const validatedUsername = z.string().parse(username);
      return await usersRepo.findByUsername(validatedUsername);
    } catch (error) {
      console.error('Error finding user by username:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('users:update', async (_event, user_id: unknown, updates: unknown) => {
    try {
      const validatedId = UserIdSchema.parse(user_id);
      const UpdateSchema = z.object({
        username: z.string().min(1).optional(),
        display_name: z.string().nullable().optional(),
      });
      const validatedUpdates = UpdateSchema.parse(updates);
      return await usersRepo.update(validatedId, validatedUpdates);
    } catch (error) {
      console.error('Error updating user:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('users:delete', async (_event, user_id: unknown) => {
    try {
      const validatedId = UserIdSchema.parse(user_id);
      await usersRepo.delete(validatedId);
    } catch (error) {
      console.error('Error deleting user:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // ==================== Authentication ====================

  ipcMain.handle('users:verifyPin', async (_event, user_id: unknown, pin: unknown) => {
    try {
      const validatedId = UserIdSchema.parse(user_id);
      const validatedPin = z.string().min(4).max(6).regex(/^\d+$/).parse(pin);
      const isValid = await usersRepo.verifyPin(validatedId, validatedPin);

      if (isValid) {
        // Update last login on successful verification
        await usersRepo.updateLastLogin(validatedId);
      }

      return { success: isValid };
    } catch (error) {
      console.error('Error verifying PIN:', error);
      return { success: false, error: 'Invalid PIN format' };
    }
  });

  ipcMain.handle('users:setPin', async (_event, user_id: unknown, pin: unknown) => {
    try {
      const validatedId = UserIdSchema.parse(user_id);
      const validatedPin = z.string().min(4).max(6).regex(/^\d+$/).parse(pin);
      await usersRepo.setPin(validatedId, validatedPin);
      return { success: true };
    } catch (error) {
      console.error('Error setting PIN:', error);
      if (error instanceof z.ZodError) {
        throw new Error('PIN must be 4-6 digits');
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('users:clearPin', async (_event, user_id: unknown) => {
    try {
      const validatedId = UserIdSchema.parse(user_id);
      await usersRepo.clearPin(validatedId);
      return { success: true };
    } catch (error) {
      console.error('Error clearing PIN:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('users:hasPin', async (_event, user_id: unknown) => {
    try {
      const validatedId = UserIdSchema.parse(user_id);
      return await usersRepo.hasPin(validatedId);
    } catch (error) {
      console.error('Error checking PIN:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('users:anyUserHasPin', async () => {
    try {
      return await usersRepo.anyUserHasPin();
    } catch (error) {
      console.error('Error checking if any user has PIN:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('users:updateLastLogin', async (_event, user_id: unknown) => {
    try {
      const validatedId = UserIdSchema.parse(user_id);
      await usersRepo.updateLastLogin(validatedId);
      return { success: true };
    } catch (error) {
      console.error('Error updating last login:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });
}
