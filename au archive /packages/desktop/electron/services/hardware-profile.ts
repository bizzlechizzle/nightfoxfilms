/**
 * Hardware Profile Detection
 *
 * Detects system capabilities and returns AGGRESSIVE scaling profile.
 * macOS can handle it - memory compression, fast swap, QoS scheduler.
 *
 * Philosophy: Smack that bitch around. The system can handle it.
 *
 * @module services/hardware-profile
 */

import os from 'os';

/**
 * Hardware profile with scaled worker allocations
 */
export interface HardwareProfile {
  cpuCores: number;
  totalMemoryGB: number;
  isAppleSilicon: boolean;
  tier: 'beast' | 'high' | 'medium' | 'low';

  // Scaled worker allocation - Per-file jobs
  hashWorkers: number;
  copyWorkers: number;
  copyWorkersNetwork: number;
  exifToolWorkers: number;
  ffprobeWorkers: number;
  thumbnailWorkers: number;
  videoProxyWorkers: number;

  // Scaled worker allocation - Per-location jobs
  gpsEnrichmentWorkers: number;
  livePhotoWorkers: number;
  srtTelemetryWorkers: number;
  locationStatsWorkers: number;
  bagitWorkers: number;

  // Queue settings
  pollIntervalMs: number;
  pollIntervalIdleMs: number;
}

/**
 * Detect hardware and return AGGRESSIVE scaling profile
 * macOS can handle it - memory compression, fast swap, QoS scheduler
 */
export function detectHardwareProfile(): HardwareProfile {
  const cpuCores = os.cpus().length;
  const totalMemGB = os.totalmem() / 1024 / 1024 / 1024;
  const isAppleSilicon = os.arch() === 'arm64' && process.platform === 'darwin';

  // Determine tier based on cores and memory
  let tier: 'beast' | 'high' | 'medium' | 'low';
  if (cpuCores >= 20 && totalMemGB >= 48) {
    tier = 'beast';      // M2 Ultra, Mac Pro, high-end workstation
  } else if (cpuCores >= 10 && totalMemGB >= 16) {
    tier = 'high';       // M1/M2 Pro/Max, decent desktop
  } else if (cpuCores >= 4 && totalMemGB >= 8) {
    tier = 'medium';     // M1/M2 base, older Intel
  } else {
    tier = 'low';        // Potato
  }

  // AGGRESSIVE scaling based on tier
  const profiles: Record<typeof tier, Omit<HardwareProfile, 'cpuCores' | 'totalMemoryGB' | 'isAppleSilicon' | 'tier'>> = {
    beast: {
      // M2 Ultra (24 cores, 64GB+): GO NUCLEAR
      // Per-file jobs
      hashWorkers: cpuCores - 2,                    // 22 workers
      copyWorkers: 24,                               // Saturate local I/O
      copyWorkersNetwork: 1,                         // SMB SEQUENTIAL - concurrent ops crash connections
      exifToolWorkers: Math.floor(cpuCores * 0.5),  // 12 workers
      ffprobeWorkers: Math.floor(cpuCores * 0.25),  // 6 workers
      thumbnailWorkers: Math.floor(cpuCores * 0.5), // 12 workers
      videoProxyWorkers: 4,                          // CPU-heavy but we can handle it
      // Per-location jobs (lighter, run after file jobs)
      gpsEnrichmentWorkers: 4,                       // Network-bound (geocoding)
      livePhotoWorkers: 8,                           // DB + metadata comparison
      srtTelemetryWorkers: 4,                        // File parsing + DB update
      locationStatsWorkers: 8,                       // DB aggregation
      bagitWorkers: 4,                               // File I/O for manifests
      pollIntervalMs: 25,                            // FAST
      pollIntervalIdleMs: 100,
    },
    high: {
      // M1/M2 Pro/Max (10-12 cores, 16-32GB): Still aggressive
      // Per-file jobs
      hashWorkers: cpuCores - 2,
      copyWorkers: 16,
      copyWorkersNetwork: 1,                         // SMB SEQUENTIAL - concurrent ops crash connections
      exifToolWorkers: Math.floor(cpuCores * 0.4),
      ffprobeWorkers: Math.floor(cpuCores * 0.2),
      thumbnailWorkers: Math.floor(cpuCores * 0.4),
      videoProxyWorkers: 2,
      // Per-location jobs
      gpsEnrichmentWorkers: 2,
      livePhotoWorkers: 4,
      srtTelemetryWorkers: 2,
      locationStatsWorkers: 4,
      bagitWorkers: 2,
      pollIntervalMs: 50,
      pollIntervalIdleMs: 150,
    },
    medium: {
      // Base M1/M2, older Intel (4-8 cores, 8-16GB): Moderate
      // Per-file jobs
      hashWorkers: Math.max(2, cpuCores - 2),
      copyWorkers: 8,
      copyWorkersNetwork: 1,                         // SMB SEQUENTIAL - concurrent ops crash connections
      exifToolWorkers: Math.max(2, Math.floor(cpuCores * 0.3)),
      ffprobeWorkers: 2,
      thumbnailWorkers: Math.max(2, Math.floor(cpuCores * 0.3)),
      videoProxyWorkers: 1,
      // Per-location jobs
      gpsEnrichmentWorkers: 1,
      livePhotoWorkers: 2,
      srtTelemetryWorkers: 1,
      locationStatsWorkers: 2,
      bagitWorkers: 1,
      pollIntervalMs: 100,
      pollIntervalIdleMs: 300,
    },
    low: {
      // Potato mode: Be gentle
      // Per-file jobs
      hashWorkers: Math.max(1, cpuCores - 1),
      copyWorkers: 4,
      copyWorkersNetwork: 1,                         // SMB SEQUENTIAL - concurrent ops crash connections
      exifToolWorkers: 2,
      ffprobeWorkers: 1,
      thumbnailWorkers: 2,
      videoProxyWorkers: 1,
      // Per-location jobs
      gpsEnrichmentWorkers: 1,
      livePhotoWorkers: 1,
      srtTelemetryWorkers: 1,
      locationStatsWorkers: 1,
      bagitWorkers: 1,
      pollIntervalMs: 200,
      pollIntervalIdleMs: 500,
    },
  };

  const profile = profiles[tier];

  console.log(`[HardwareProfile] Detected: ${tier} tier`);
  console.log(`[HardwareProfile] ${cpuCores} cores, ${totalMemGB.toFixed(1)}GB RAM, Apple Silicon: ${isAppleSilicon}`);
  console.log(`[HardwareProfile] Hash: ${profile.hashWorkers}, Copy: ${profile.copyWorkers}, ExifTool: ${profile.exifToolWorkers}`);

  return {
    cpuCores,
    totalMemoryGB: totalMemGB,
    isAppleSilicon,
    tier,
    ...profile,
  };
}

// Singleton - detect once at startup
let cachedProfile: HardwareProfile | null = null;

/**
 * Get the cached hardware profile (detects once at startup)
 */
export function getHardwareProfile(): HardwareProfile {
  if (!cachedProfile) {
    cachedProfile = detectHardwareProfile();
  }
  return cachedProfile;
}

/**
 * Reset the cached profile (for testing)
 */
export function resetHardwareProfile(): void {
  cachedProfile = null;
}
