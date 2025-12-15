import { Kysely } from 'kysely';
import { generateId } from '../main/ipc-validation';
import type { Database, ProjectsTable, ProjectLocationsTable } from '../main/database.types';

export interface ProjectInput {
  project_name: string;
  description?: string | null;
  auth_imp?: string | null;
}

export interface ProjectUpdate {
  project_name?: string;
  description?: string | null;
}

export interface Project {
  project_id: string;
  project_name: string;
  description: string | null;
  created_date: string;
  auth_imp: string | null;
  location_count?: number;
}

export interface ProjectWithLocations extends Project {
  locations: Array<{
    locid: string;
    locnam: string;
    address_state: string | null;
    added_date: string;
  }>;
}

/**
 * Repository for managing projects
 */
export class SQLiteProjectsRepository {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * Create a new project
   */
  async create(input: ProjectInput): Promise<Project> {
    const project_id = generateId();
    const created_date = new Date().toISOString();

    const project: ProjectsTable = {
      project_id,
      project_name: input.project_name,
      description: input.description || null,
      created_date,
      auth_imp: input.auth_imp || null,
    };

    await this.db.insertInto('projects').values(project).execute();

    return this.findById(project_id);
  }

  /**
   * Find a project by ID
   */
  async findById(project_id: string): Promise<Project> {
    const project = await this.db
      .selectFrom('projects')
      .selectAll()
      .where('project_id', '=', project_id)
      .executeTakeFirstOrThrow();

    const locationCount = await this.countLocations(project_id);

    return {
      ...project,
      location_count: locationCount,
    };
  }

  /**
   * Find a project with its associated locations
   */
  async findByIdWithLocations(project_id: string): Promise<ProjectWithLocations> {
    const project = await this.findById(project_id);

    const locations = await this.db
      .selectFrom('project_locations')
      .innerJoin('locs', 'project_locations.locid', 'locs.locid')
      .select([
        'locs.locid',
        'locs.locnam',
        'locs.address_state',
        'project_locations.added_date',
      ])
      .where('project_locations.project_id', '=', project_id)
      .orderBy('locs.locnam', 'asc')
      .execute();

    return {
      ...project,
      locations,
    };
  }

  /**
   * Find all projects
   */
  async findAll(): Promise<Project[]> {
    const projects = await this.db
      .selectFrom('projects')
      .selectAll()
      .orderBy('project_name', 'asc')
      .execute();

    // Add location count to each project
    const projectsWithCounts = await Promise.all(
      projects.map(async (project) => ({
        ...project,
        location_count: await this.countLocations(project.project_id),
      }))
    );

    return projectsWithCounts;
  }

  /**
   * Find recent projects
   */
  async findRecent(limit: number = 5): Promise<Project[]> {
    const projects = await this.db
      .selectFrom('projects')
      .selectAll()
      .orderBy('created_date', 'desc')
      .limit(limit)
      .execute();

    // Add location count to each project
    const projectsWithCounts = await Promise.all(
      projects.map(async (project) => ({
        ...project,
        location_count: await this.countLocations(project.project_id),
      }))
    );

    return projectsWithCounts;
  }

  /**
   * Find top projects by location count
   */
  async findTopByLocationCount(limit: number = 5): Promise<Project[]> {
    const projectsWithCounts = await this.db
      .selectFrom('projects')
      .leftJoin('project_locations', 'projects.project_id', 'project_locations.project_id')
      .select([
        'projects.project_id',
        'projects.project_name',
        'projects.description',
        'projects.created_date',
        'projects.auth_imp',
        (eb) => eb.fn.count<number>('project_locations.locid').as('location_count'),
      ])
      .groupBy('projects.project_id')
      .orderBy('location_count', 'desc')
      .orderBy('projects.project_name', 'asc')
      .limit(limit)
      .execute();

    return projectsWithCounts;
  }

  /**
   * Update a project
   */
  async update(project_id: string, updates: ProjectUpdate): Promise<Project> {
    await this.db
      .updateTable('projects')
      .set(updates)
      .where('project_id', '=', project_id)
      .execute();

    return this.findById(project_id);
  }

  /**
   * Delete a project
   */
  async delete(project_id: string): Promise<void> {
    await this.db.deleteFrom('projects').where('project_id', '=', project_id).execute();
  }

  /**
   * Add a location to a project
   */
  async addLocation(project_id: string, locid: string): Promise<void> {
    const added_date = new Date().toISOString();

    const projectLocation: ProjectLocationsTable = {
      project_id,
      locid,
      added_date,
    };

    await this.db
      .insertInto('project_locations')
      .values(projectLocation)
      .onConflict((oc) => oc.columns(['project_id', 'locid']).doNothing())
      .execute();
  }

  /**
   * Remove a location from a project
   */
  async removeLocation(project_id: string, locid: string): Promise<void> {
    await this.db
      .deleteFrom('project_locations')
      .where('project_id', '=', project_id)
      .where('locid', '=', locid)
      .execute();
  }

  /**
   * Get all projects for a specific location
   */
  async findByLocation(locid: string): Promise<Project[]> {
    const projects = await this.db
      .selectFrom('projects')
      .innerJoin('project_locations', 'projects.project_id', 'project_locations.project_id')
      .selectAll('projects')
      .where('project_locations.locid', '=', locid)
      .orderBy('projects.project_name', 'asc')
      .execute();

    // Add location count to each project
    const projectsWithCounts = await Promise.all(
      projects.map(async (project) => ({
        ...project,
        location_count: await this.countLocations(project.project_id),
      }))
    );

    return projectsWithCounts;
  }

  /**
   * Count locations in a project
   */
  async countLocations(project_id: string): Promise<number> {
    const result = await this.db
      .selectFrom('project_locations')
      .select((eb) => eb.fn.count<number>('locid').as('count'))
      .where('project_id', '=', project_id)
      .executeTakeFirstOrThrow();

    return result.count;
  }

  /**
   * Check if a location is in a project
   */
  async isLocationInProject(project_id: string, locid: string): Promise<boolean> {
    const result = await this.db
      .selectFrom('project_locations')
      .select('project_id')
      .where('project_id', '=', project_id)
      .where('locid', '=', locid)
      .executeTakeFirst();

    return !!result;
  }
}
