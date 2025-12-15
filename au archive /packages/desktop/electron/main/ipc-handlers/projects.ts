/**
 * Projects IPC Handlers
 * ADR-046: Updated locid validation from UUID to BLAKE3 16-char hex
 * ADR-049: Updated project_id to unified 16-char hex
 * Handles projects:* IPC channels
 */
import { ipcMain } from 'electron';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { Database } from '../database.types';
import { SQLiteProjectsRepository } from '../../repositories/sqlite-projects-repository';
import { validate, LimitSchema, Blake3IdSchema, ProjectIdSchema } from '../ipc-validation';

export function registerProjectsHandlers(db: Kysely<Database>) {
  const projectsRepo = new SQLiteProjectsRepository(db);

  ipcMain.handle('projects:create', async (_event, input: unknown) => {
    try {
      const ProjectInputSchema = z.object({
        project_name: z.string().min(1),
        description: z.string().nullable().optional(),
        auth_imp: z.string().nullable().optional(),
      });
      const validatedInput = ProjectInputSchema.parse(input);
      return await projectsRepo.create(validatedInput);
    } catch (error) {
      console.error('Error creating project:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('projects:findById', async (_event, project_id: unknown) => {
    try {
      const validatedId = ProjectIdSchema.parse(project_id);
      return await projectsRepo.findById(validatedId);
    } catch (error) {
      console.error('Error finding project:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('projects:findByIdWithLocations', async (_event, project_id: unknown) => {
    try {
      const validatedId = ProjectIdSchema.parse(project_id);
      return await projectsRepo.findByIdWithLocations(validatedId);
    } catch (error) {
      console.error('Error finding project with locations:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('projects:findAll', async () => {
    try {
      return await projectsRepo.findAll();
    } catch (error) {
      console.error('Error finding all projects:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('projects:findRecent', async (_event, limit: unknown = 5) => {
    try {
      const validatedLimit = validate(LimitSchema, limit);
      return await projectsRepo.findRecent(validatedLimit);
    } catch (error) {
      console.error('Error finding recent projects:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('projects:findTopByLocationCount', async (_event, limit: unknown = 5) => {
    try {
      const validatedLimit = validate(LimitSchema, limit);
      return await projectsRepo.findTopByLocationCount(validatedLimit);
    } catch (error) {
      console.error('Error finding top projects:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('projects:findByLocation', async (_event, locid: unknown) => {
    try {
      const validatedId = Blake3IdSchema.parse(locid);
      return await projectsRepo.findByLocation(validatedId);
    } catch (error) {
      console.error('Error finding projects by location:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('projects:update', async (_event, project_id: unknown, updates: unknown) => {
    try {
      const validatedId = ProjectIdSchema.parse(project_id);
      const ProjectUpdateSchema = z.object({
        project_name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
      });
      const validatedUpdates = ProjectUpdateSchema.parse(updates);
      return await projectsRepo.update(validatedId, validatedUpdates);
    } catch (error) {
      console.error('Error updating project:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('projects:delete', async (_event, project_id: unknown) => {
    try {
      const validatedId = ProjectIdSchema.parse(project_id);
      await projectsRepo.delete(validatedId);
    } catch (error) {
      console.error('Error deleting project:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('projects:addLocation', async (_event, project_id: unknown, locid: unknown) => {
    try {
      const validatedProjectId = ProjectIdSchema.parse(project_id);
      const validatedLocId = Blake3IdSchema.parse(locid);
      await projectsRepo.addLocation(validatedProjectId, validatedLocId);
    } catch (error) {
      console.error('Error adding location to project:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('projects:removeLocation', async (_event, project_id: unknown, locid: unknown) => {
    try {
      const validatedProjectId = ProjectIdSchema.parse(project_id);
      const validatedLocId = Blake3IdSchema.parse(locid);
      await projectsRepo.removeLocation(validatedProjectId, validatedLocId);
    } catch (error) {
      console.error('Error removing location from project:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('projects:isLocationInProject', async (_event, project_id: unknown, locid: unknown) => {
    try {
      const validatedProjectId = ProjectIdSchema.parse(project_id);
      const validatedLocId = Blake3IdSchema.parse(locid);
      return await projectsRepo.isLocationInProject(validatedProjectId, validatedLocId);
    } catch (error) {
      console.error('Error checking if location is in project:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });
}
