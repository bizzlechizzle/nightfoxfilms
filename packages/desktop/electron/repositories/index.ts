/**
 * Repository Exports
 *
 * Central export for all database repositories.
 */

export { settingsRepository, SettingsRepository } from './settings-repository';
export { camerasRepository, CamerasRepository } from './cameras-repository';
export { cameraPatternsRepository, CameraPatternsRepository } from './camera-patterns-repository';
export { couplesRepository, CouplesRepository } from './couples-repository';
export { filesRepository, FilesRepository, type FileCreateInput, type FileFilters } from './files-repository';
export { scenesRepository, ScenesRepository, type SceneCreateInput, type SceneUpdateInput } from './scenes-repository';
export { jobsRepository, JobsRepository, type JobCreateInput } from './jobs-repository';
export {
  weddingsRepository,
  WeddingsRepository,
  type Wedding,
  type WeddingStatus,
  type WeddingStatusHistory,
  type CreateWeddingInput,
  type UpdateWeddingInput,
  type WeddingFilters,
  type DashboardStats,
  type MonthlyStats,
  type YearlyStats,
} from './weddings-repository';
