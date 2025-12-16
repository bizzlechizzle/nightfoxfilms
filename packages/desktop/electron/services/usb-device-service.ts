/**
 * USB Device Service
 *
 * Detects and registers cameras connected via USB.
 * Uses Volume UUID as primary identifier (more reliable than USB serial for JVC).
 * Allows associating physical serial numbers from camera body labels.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

const execAsync = promisify(exec);

// =============================================================================
// TYPES
// =============================================================================

export interface VolumeInfo {
  name: string;
  mountPoint: string;
  volumeUUID: string;
  capacity: number;
  freeSpace: number;
  fileSystem: string;
}

export interface USBDevice {
  vendorId: number;
  productId: number;
  vendorName: string;
  productName: string;
  usbSerial: string | null;
  locationId: string;
  volumes: VolumeInfo[];
  // Primary identifier - Volume UUID of main storage (more reliable than USB serial)
  primaryVolumeUUID: string | null;
}

export interface RegisteredCamera {
  id: string;
  name: string;
  // USB identifiers
  usbSerial: string | null;
  volumeUUID: string | null;  // Primary identifier for JVC and similar
  vendorId: number | null;
  productId: number | null;
  // Camera info
  make: string;
  model: string;
  physicalSerial: string | null;  // Serial number from camera body label
  // Metadata
  registeredAt: string;
  lastSeen: string | null;
  notes: string | null;
}

export interface CameraRegistry {
  cameras: RegisteredCamera[];
  version: number;
}

// =============================================================================
// KNOWN USB VENDOR IDS
// =============================================================================

const USB_VENDORS: Record<number, string> = {
  1265: 'JVC',           // JVC Kenwood Corporation (0x04f1)
  1356: 'Sony',          // Sony Corporation
  1193: 'Canon',         // Canon Inc.
  1112: 'Panasonic',     // Panasonic (Matsushita)
  1133: 'Nikon',         // Nikon Corporation
  2996: 'GoPro',         // GoPro Inc.
  10007: 'DJI',          // SZ DJI Technology
  1452: 'Apple',         // Apple Inc. (for iPhone video)
};

// =============================================================================
// USB DEVICE DETECTION (macOS)
// =============================================================================

/**
 * Get all connected USB devices with volume information
 * Uses system_profiler on macOS
 */
export async function getConnectedUSBDevices(): Promise<USBDevice[]> {
  try {
    const { stdout } = await execAsync('system_profiler SPUSBDataType -json');
    const data = JSON.parse(stdout);

    const devices: USBDevice[] = [];
    parseUSBTree(data.SPUSBDataType, devices);

    return devices;
  } catch (error) {
    console.error('[USBDevice] Failed to get USB devices:', error);
    return [];
  }
}

/**
 * Recursively parse USB device tree from system_profiler
 * Extracts volume UUIDs for reliable camera identification
 */
function parseUSBTree(items: any[], devices: USBDevice[]): void {
  if (!Array.isArray(items)) return;

  for (const item of items) {
    // Check if this item has vendor/product IDs (is a device)
    if (item.vendor_id && item.product_id) {
      const vendorId = parseHexId(item.vendor_id);
      const productId = parseHexId(item.product_id);

      // Extract all volumes from Media array
      const volumes: VolumeInfo[] = [];
      if (item.Media && Array.isArray(item.Media)) {
        for (const media of item.Media) {
          if (media.volumes && Array.isArray(media.volumes)) {
            for (const vol of media.volumes) {
              volumes.push({
                name: vol._name || 'Unknown',
                mountPoint: vol.mount_point || '',
                volumeUUID: vol.volume_uuid || '',
                capacity: vol.size_in_bytes || 0,
                freeSpace: vol.free_space_in_bytes || 0,
                fileSystem: vol.file_system || '',
              });
            }
          }
        }
      }

      // Use first volume's UUID as primary identifier
      // For JVC, this is the internal HDD which has a unique UUID per camera
      const primaryVolumeUUID = volumes.length > 0 ? volumes[0].volumeUUID : null;

      devices.push({
        vendorId,
        productId,
        vendorName: USB_VENDORS[vendorId] || item.manufacturer || 'Unknown',
        productName: item._name || 'Unknown Device',
        usbSerial: item.serial_num || null,
        locationId: item.location_id || '',
        volumes,
        primaryVolumeUUID,
      });
    }

    // Recurse into nested items (USB hubs have _items)
    if (item._items) {
      parseUSBTree(item._items, devices);
    }
  }
}

/**
 * Parse hex vendor/product ID string
 * system_profiler returns "0x04f1" or "0x04f1  (Company Name)" format
 */
function parseHexId(idString: string): number {
  if (typeof idString === 'number') return idString;
  if (typeof idString !== 'string') return 0;

  const match = idString.match(/0x([0-9a-fA-F]+)/);
  return match ? parseInt(match[1], 16) : 0;
}

/**
 * Get USB devices that look like cameras
 * Filters by known camera vendor IDs
 */
export async function getConnectedCameras(): Promise<USBDevice[]> {
  const allDevices = await getConnectedUSBDevices();

  // Filter to known camera vendors
  const cameraVendorIds = [1265, 1356, 1193, 1112, 1133, 2996, 10007];

  return allDevices.filter(
    (device) =>
      cameraVendorIds.includes(device.vendorId) ||
      device.productName.toLowerCase().includes('camera') ||
      device.productName.toLowerCase().includes('camcorder') ||
      device.productName.toLowerCase().includes('everio') ||
      device.productName.toLowerCase().includes('gz-')
  );
}

/**
 * Get JVC devices specifically
 */
export async function getConnectedJVCDevices(): Promise<USBDevice[]> {
  const allDevices = await getConnectedUSBDevices();
  return allDevices.filter((device) => device.vendorId === 1265);
}

// =============================================================================
// CAMERA REGISTRY - Persistent storage for registered cameras
// =============================================================================

const REGISTRY_VERSION = 2;  // Bumped for volumeUUID and physicalSerial fields
let registry: CameraRegistry | null = null;

/**
 * Get registry file path
 */
function getRegistryPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'camera-registry.json');
}

/**
 * Load camera registry from disk
 */
export function loadCameraRegistry(): CameraRegistry {
  if (registry) return registry;

  const registryPath = getRegistryPath();

  try {
    if (fs.existsSync(registryPath)) {
      const data = fs.readFileSync(registryPath, 'utf-8');
      const loaded = JSON.parse(data);

      // Migrate old registry format if needed
      if (loaded && loaded.cameras) {
        // Add missing fields from v2
        for (const cam of loaded.cameras) {
          if (cam.volumeUUID === undefined) cam.volumeUUID = null;
          if (cam.physicalSerial === undefined) cam.physicalSerial = null;
        }
        loaded.version = REGISTRY_VERSION;
        registry = loaded;
      } else {
        registry = { cameras: [], version: REGISTRY_VERSION };
      }
    } else {
      registry = { cameras: [], version: REGISTRY_VERSION };
    }
  } catch (error) {
    console.error('[USBDevice] Failed to load registry:', error);
    registry = { cameras: [], version: REGISTRY_VERSION };
  }

  return registry!;
}

/**
 * Save camera registry to disk
 */
function saveRegistry(): void {
  if (!registry) return;

  const registryPath = getRegistryPath();
  try {
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
    console.log('[USBDevice] Registry saved:', registryPath);
  } catch (error) {
    console.error('[USBDevice] Failed to save registry:', error);
  }
}

/**
 * Register a camera with Volume UUID and optional physical serial
 */
export function registerCamera(
  name: string,
  make: string,
  model: string,
  volumeUUID?: string | null,
  usbSerial?: string | null,
  vendorId?: number | null,
  productId?: number | null,
  physicalSerial?: string | null,
  notes?: string | null
): RegisteredCamera {
  loadCameraRegistry();

  // Check if camera with this volumeUUID already exists
  if (volumeUUID) {
    const existing = registry!.cameras.find((c) => c.volumeUUID === volumeUUID);
    if (existing) {
      console.log(`[USBDevice] Camera with volumeUUID ${volumeUUID} already registered as "${existing.name}"`);
      // Update existing camera instead
      existing.name = name;
      existing.physicalSerial = physicalSerial || existing.physicalSerial;
      existing.notes = notes || existing.notes;
      existing.lastSeen = new Date().toISOString();
      saveRegistry();
      return existing;
    }
  }

  // Generate unique ID
  const id = `cam-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const camera: RegisteredCamera = {
    id,
    name,
    volumeUUID: volumeUUID || null,
    usbSerial: usbSerial || null,
    vendorId: vendorId || null,
    productId: productId || null,
    make,
    model,
    physicalSerial: physicalSerial || null,
    registeredAt: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    notes: notes || null,
  };

  registry!.cameras.push(camera);
  saveRegistry();

  console.log(`[USBDevice] Registered camera: ${name} (${make} ${model}) - Volume UUID: ${volumeUUID}`);
  return camera;
}

/**
 * Update camera's last seen timestamp
 */
export function updateCameraLastSeen(cameraId: string): void {
  loadCameraRegistry();

  const camera = registry!.cameras.find((c) => c.id === cameraId);
  if (camera) {
    camera.lastSeen = new Date().toISOString();
    saveRegistry();
  }
}

/**
 * Find camera by Volume UUID (primary method for JVC)
 */
export function findCameraByVolumeUUID(volumeUUID: string): RegisteredCamera | null {
  loadCameraRegistry();
  return registry!.cameras.find((c) => c.volumeUUID === volumeUUID) || null;
}

/**
 * Find camera by USB serial number (fallback)
 */
export function findCameraByUSBSerial(serial: string): RegisteredCamera | null {
  loadCameraRegistry();
  return registry!.cameras.find((c) => c.usbSerial === serial) || null;
}

/**
 * Find camera by physical serial number
 */
export function findCameraByPhysicalSerial(serial: string): RegisteredCamera | null {
  loadCameraRegistry();
  return registry!.cameras.find((c) => c.physicalSerial === serial) || null;
}

/**
 * Find camera by name
 */
export function findCameraByName(name: string): RegisteredCamera | null {
  loadCameraRegistry();
  return registry!.cameras.find((c) => c.name.toLowerCase() === name.toLowerCase()) || null;
}

/**
 * Get all registered cameras
 */
export function getRegisteredCameras(): RegisteredCamera[] {
  loadCameraRegistry();
  return [...registry!.cameras];
}

/**
 * Update camera details
 */
export function updateCamera(
  cameraId: string,
  updates: Partial<Pick<RegisteredCamera, 'name' | 'notes' | 'physicalSerial' | 'volumeUUID'>>
): RegisteredCamera | null {
  loadCameraRegistry();

  const camera = registry!.cameras.find((c) => c.id === cameraId);
  if (!camera) return null;

  if (updates.name !== undefined) camera.name = updates.name;
  if (updates.notes !== undefined) camera.notes = updates.notes;
  if (updates.physicalSerial !== undefined) camera.physicalSerial = updates.physicalSerial;
  if (updates.volumeUUID !== undefined) camera.volumeUUID = updates.volumeUUID;

  saveRegistry();
  return camera;
}

/**
 * Delete a registered camera
 */
export function deleteRegisteredCamera(cameraId: string): boolean {
  loadCameraRegistry();

  const index = registry!.cameras.findIndex((c) => c.id === cameraId);
  if (index === -1) return false;

  registry!.cameras.splice(index, 1);
  saveRegistry();
  return true;
}

/**
 * Check connected devices against registry and identify them
 */
export async function syncConnectedCameras(): Promise<{
  connected: Array<{ device: USBDevice; camera: RegisteredCamera }>;
  unregistered: USBDevice[];
}> {
  const connectedDevices = await getConnectedCameras();
  loadCameraRegistry();

  const connected: Array<{ device: USBDevice; camera: RegisteredCamera }> = [];
  const unregistered: USBDevice[] = [];

  for (const device of connectedDevices) {
    // Try to find by Volume UUID first (most reliable for JVC)
    let camera: RegisteredCamera | null = null;

    if (device.primaryVolumeUUID) {
      camera = findCameraByVolumeUUID(device.primaryVolumeUUID);
    }

    // Fall back to USB serial if no Volume UUID match
    if (!camera && device.usbSerial) {
      camera = findCameraByUSBSerial(device.usbSerial);
    }

    if (camera) {
      updateCameraLastSeen(camera.id);
      connected.push({ device, camera });
    } else {
      unregistered.push(device);
    }
  }

  return { connected, unregistered };
}

/**
 * Register a currently connected USB device as a camera
 */
export async function registerConnectedDevice(
  volumeUUID: string,
  cameraName: string,
  physicalSerial?: string,
  notes?: string
): Promise<RegisteredCamera | null> {
  const devices = await getConnectedCameras();

  // Find device by volume UUID
  const device = devices.find((d) => d.primaryVolumeUUID === volumeUUID);

  if (!device) {
    console.error('[USBDevice] Device not found with volumeUUID:', volumeUUID);
    return null;
  }

  return registerCamera(
    cameraName,
    device.vendorName,
    device.productName,
    device.primaryVolumeUUID,
    device.usbSerial,
    device.vendorId,
    device.productId,
    physicalSerial || null,
    notes || null
  );
}

/**
 * Find camera for a given mount point (useful during import)
 */
export async function findCameraForMountPoint(mountPoint: string): Promise<RegisteredCamera | null> {
  const devices = await getConnectedCameras();

  for (const device of devices) {
    for (const volume of device.volumes) {
      if (volume.mountPoint === mountPoint || mountPoint.startsWith(volume.mountPoint)) {
        // Found the device, now check if it's registered
        if (device.primaryVolumeUUID) {
          const camera = findCameraByVolumeUUID(device.primaryVolumeUUID);
          if (camera) return camera;
        }
      }
    }
  }

  return null;
}
