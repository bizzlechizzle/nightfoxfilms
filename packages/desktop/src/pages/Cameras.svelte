<script lang="ts">
  import { getAPI, getMediumName } from '../lib/api';
  import type { CameraWithPatterns, CameraInput, Medium } from '../lib/types';
  import type { USBDevice, RegisteredCamera } from '../lib/api';

  const api = getAPI();

  let cameras = $state<CameraWithPatterns[]>([]);
  let loading = $state(true);
  let showCreateModal = $state(false);
  let showTrainModal = $state(false);
  let showEditModal = $state(false);
  let editingCamera = $state<CameraWithPatterns | null>(null);

  // USB Device Registration State
  let connectedDevices = $state<USBDevice[]>([]);
  let registeredCameras = $state<RegisteredCamera[]>([]);
  let recognizedDevices = $state<Array<{ device: USBDevice; camera: RegisteredCamera }>>([]);
  let showRegisterModal = $state(false);
  let deviceToRegister = $state<USBDevice | null>(null);
  let registerName = $state('');
  let registerPhysicalSerial = $state('');
  let registerNotes = $state('');
  let scanningUSB = $state(false);

  // Camera form state (for create)
  let formName = $state('');
  let formMedium = $state<Medium>('modern');
  let formMake = $state('');
  let formModel = $state('');
  let formNotes = $state('');
  let formDeinterlace = $state(false);

  // Edit form state
  let editName = $state('');
  let editNickname = $state('');
  let editMedium = $state<Medium>('modern');
  let editMake = $state('');
  let editModel = $state('');
  let editSerialNumber = $state('');
  let editColorProfile = $state('');
  let editColor = $state('');
  let editNotes = $state('');
  let editDeinterlace = $state(false);
  let editLutPath = $state('');
  let editIsActive = $state(true);

  // Training state
  interface TrainingFile {
    path: string;
    filename: string;
    metadata: unknown;
    error: string | null;
  }
  interface TrainingSession {
    id: string;
    files: TrainingFile[];
    status: 'collecting' | 'analyzing' | 'ready' | 'error';
    minimumFiles: number;
    error: string | null;
  }
  interface CameraIdentity {
    make: string | null;
    model: string | null;
    normalizedName: string;
    confidence: 'high' | 'medium' | 'low' | 'none';
    source: 'exif' | 'brand' | 'xml' | 'unknown';
  }
  interface TechnicalSpecs {
    width: number | null;
    height: number | null;
    frameRate: number | null;
    codec: string | null;
    bitrate: number | null;
  }
  interface SupplementaryInfo {
    lens: string | null;
    gamma: string | null;
    serial: string | null;
  }
  interface TrainingResult {
    success: boolean;
    fingerprint: any;
    suggestedName: string;
    suggestedMedium: Medium;
    signature: any;
    filesAnalyzed: number;
    errors: string[];
    // Optional fields for UI display (may come from fingerprint)
    identity?: { make?: string; model?: string; confidence?: string; source?: string } | null;
    supplementary?: { serial?: string; lens?: string; gamma?: string } | null;
    specs?: { codec?: string; width?: number; height?: number; frameRate?: number } | null;
  }

  let trainingSession = $state<TrainingSession | null>(null);
  let trainingResult = $state<TrainingResult | null>(null);
  let trainingError = $state<string | null>(null);
  let isAnalyzing = $state(false);
  let isDragOver = $state(false);

  // Editable result fields (training)
  let editedName = $state('');
  let editedMedium = $state<Medium>('modern');

  $effect(() => {
    loadCameras();
    scanUSBDevices();
  });

  async function loadCameras() {
    loading = true;
    try {
      cameras = await api.cameras.findAll();
    } catch (error) {
      console.error('Failed to load cameras:', error);
    } finally {
      loading = false;
    }
  }

  // USB Device Functions
  async function scanUSBDevices() {
    scanningUSB = true;
    try {
      const result = await api.usb.syncCameras();
      recognizedDevices = result.connected;
      connectedDevices = result.unregistered;
      registeredCameras = await api.cameraRegistry.getAll();
    } catch (error) {
      console.error('Failed to scan USB devices:', error);
    } finally {
      scanningUSB = false;
    }
  }

  function openRegisterModal(device: USBDevice) {
    deviceToRegister = device;
    registerName = '';
    registerPhysicalSerial = '';
    registerNotes = '';
    showRegisterModal = true;
  }

  function closeRegisterModal() {
    showRegisterModal = false;
    deviceToRegister = null;
  }

  async function registerDevice() {
    if (!deviceToRegister || !registerName || !deviceToRegister.primaryVolumeUUID) return;

    try {
      await api.cameraRegistry.registerConnected({
        volumeUUID: deviceToRegister.primaryVolumeUUID,
        cameraName: registerName,
        physicalSerial: registerPhysicalSerial || undefined,
        notes: registerNotes || undefined,
      });
      closeRegisterModal();
      await scanUSBDevices();
    } catch (error) {
      console.error('Failed to register device:', error);
    }
  }

  async function deleteRegisteredCamera(cameraId: string) {
    if (!confirm('Are you sure you want to unregister this camera?')) return;

    try {
      await api.cameraRegistry.delete(cameraId);
      await scanUSBDevices();
    } catch (error) {
      console.error('Failed to delete registered camera:', error);
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }

  async function createCamera() {
    if (!formName) return;

    try {
      const input: CameraInput = {
        name: formName,
        medium: formMedium,
        make: formMake || null,
        model: formModel || null,
        notes: formNotes || null,
        deinterlace: formDeinterlace,
      };
      await api.cameras.create(input);
      closeCreateModal();
      await loadCameras();
    } catch (error) {
      console.error('Failed to create camera:', error);
    }
  }

  async function updateCamera() {
    if (!editingCamera || !editName) return;

    try {
      const input: Partial<CameraInput> = {
        name: editName,
        nickname: editNickname || null,
        medium: editMedium,
        make: editMake || null,
        model: editModel || null,
        serial_number: editSerialNumber || null,
        color_profile: editColorProfile || null,
        color: editColor || null,
        notes: editNotes || null,
        deinterlace: editMedium === 'dadcam' ? editDeinterlace : false,
        lut_path: editLutPath || null,
        is_active: editIsActive,
      };
      await api.cameras.update(editingCamera.id, input);
      closeEditModal();
      await loadCameras();
    } catch (error) {
      console.error('Failed to update camera:', error);
    }
  }

  async function deleteCamera(id: number) {
    if (!confirm('Are you sure you want to delete this camera profile?')) return;

    try {
      await api.cameras.delete(id);
      await loadCameras();
    } catch (error) {
      console.error('Failed to delete camera:', error);
    }
  }

  function openCreateModal() {
    formName = '';
    formMedium = 'modern';
    formMake = '';
    formModel = '';
    formNotes = '';
    formDeinterlace = false;
    showCreateModal = true;
  }

  function closeCreateModal() {
    showCreateModal = false;
  }

  function openEditModal(camera: CameraWithPatterns) {
    editingCamera = camera;
    editName = camera.name;
    editNickname = camera.nickname || '';
    editMedium = camera.medium;
    editMake = camera.make || '';
    editModel = camera.model || '';
    editSerialNumber = camera.serial_number || '';
    editColorProfile = camera.color_profile || '';
    editColor = camera.color || '#3b82f6';
    editNotes = camera.notes || '';
    editDeinterlace = camera.deinterlace === 1;
    editLutPath = camera.lut_path || '';
    editIsActive = camera.is_active !== 0;
    showEditModal = true;
  }

  function closeEditModal() {
    showEditModal = false;
    editingCamera = null;
  }

  async function selectLutFile() {
    try {
      const path = await api.dialog.selectLutFile();
      if (path) {
        editLutPath = path;
      }
    } catch (error) {
      console.error('Failed to select LUT file:', error);
    }
  }

  // =========================================================================
  // Training Functions
  // =========================================================================

  async function openTrainModal() {
    showTrainModal = true;
    trainingSession = null;
    trainingResult = null;
    trainingError = null;
    isAnalyzing = false;
    editedName = '';
    editedMedium = 'modern';

    try {
      trainingSession = await api.cameraTrainer.startSession();
    } catch (error) {
      trainingError = 'Failed to start training session';
      console.error(error);
    }
  }

  function closeTrainModal() {
    showTrainModal = false;
    if (trainingSession) {
      api.cameraTrainer.cancelSession();
    }
    trainingSession = null;
    trainingResult = null;
    trainingError = null;
  }

  async function handleTrainDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    isDragOver = false;

    if (!trainingSession) {
      console.error('[Train] No training session active');
      return;
    }

    // Small delay to ensure preload listener has processed
    await new Promise(resolve => setTimeout(resolve, 50));

    // Get dropped file paths from preload
    const getDroppedFilePaths = (window as any).getDroppedFilePaths;
    if (!getDroppedFilePaths) {
      console.error('[Train] getDroppedFilePaths not available');
      trainingError = 'Drag and drop not available';
      return;
    }

    const paths = getDroppedFilePaths();

    if (!paths || paths.length === 0) {
      console.warn('[Train] No file paths extracted from drop');
      return;
    }

    try {
      // Check if it's a single folder drop - use folder scan (recursive)
      if (paths.length === 1) {
        const scanResult = await api.import.scan(paths[0]);
        if (scanResult.stats.videoFiles > 0) {
          // Scan returns all supported files - filter for video only
          const videoExts = /\.(mp4|mov|avi|mkv|mts|m2ts|mxf|tod|mod|3gp|webm|wmv|flv|m4v|mpg|mpeg|vob|dv|r3d|braw)$/i;
          const videoFiles = scanResult.files.filter((f: string) => videoExts.test(f));
          if (videoFiles.length > 0) {
            const result = await api.cameraTrainer.addFiles(videoFiles);
            trainingSession = await api.cameraTrainer.getSession();
            if (result.errors?.length > 0) {
              console.warn('Some files skipped:', result.errors);
            }
            return;
          }
        }
      }

      // Otherwise treat as files
      const result = await api.cameraTrainer.addFiles(paths);
      trainingSession = await api.cameraTrainer.getSession();

      if (result.errors?.length > 0) {
        console.warn('Some files skipped:', result.errors);
      }
    } catch (error) {
      trainingError = 'Failed to add files';
      console.error(error);
    }
  }

  async function selectTrainingFiles() {
    try {
      const paths = await api.cameraTrainer.selectFiles();
      if (paths.length > 0) {
        await api.cameraTrainer.addFiles(paths);
        trainingSession = await api.cameraTrainer.getSession();
      }
    } catch (error) {
      trainingError = 'Failed to add files';
      console.error(error);
    }
  }

  async function selectTrainingFolder() {
    try {
      const folder = await api.cameraTrainer.selectFolder();
      if (folder) {
        await api.cameraTrainer.addFiles([folder]);
        trainingSession = await api.cameraTrainer.getSession();
      }
    } catch (error) {
      trainingError = 'Failed to add folder';
      console.error(error);
    }
  }

  async function removeTrainingFile(filePath: string) {
    try {
      trainingSession = await api.cameraTrainer.removeFile(filePath);
    } catch (error) {
      console.error('Failed to remove file:', error);
    }
  }

  async function analyzeTrainingFiles() {
    if (!trainingSession || trainingSession.files.length < trainingSession.minimumFiles) return;

    isAnalyzing = true;
    trainingError = null;

    try {
      trainingResult = await api.cameraTrainer.analyze();

      if (trainingResult?.success) {
        editedName = trainingResult.suggestedName;
        editedMedium = trainingResult.suggestedMedium;
      } else {
        trainingError = trainingResult?.errors?.join(', ') || 'Analysis failed';
      }
    } catch (error) {
      trainingError = 'Analysis failed';
      console.error(error);
    } finally {
      isAnalyzing = false;
    }
  }

  async function saveTrainedCamera() {
    if (!trainingResult?.signature) return;

    try {
      // Resolve suggested LUT to actual file path
      const suggestedLut = trainingResult.signature.processing?.suggestedLut;
      let lutPath: string | null = null;
      if (suggestedLut) {
        lutPath = await api.luts.resolveSuggested(suggestedLut);
      }

      // Create camera from signature
      const input: CameraInput = {
        name: editedName,
        medium: editedMedium,
        make: trainingResult.signature.make || null,
        model: trainingResult.signature.model || null,
        serial_number: trainingResult.signature.serialNumber || null,
        color_profile: trainingResult.signature.colorProfile || null,
        notes: `Auto-trained from ${trainingResult.filesAnalyzed} sample files.`,
        deinterlace: trainingResult.signature.processing?.deinterlace || false,
        lut_path: lutPath,
      };

      await api.cameras.create(input);
      closeTrainModal();
      await loadCameras();
    } catch (error) {
      trainingError = 'Failed to save camera';
      console.error(error);
    }
  }

  async function exportTrainedSignature() {
    if (!trainingResult?.signature) return;

    try {
      // Update signature with edited values
      const signature = {
        ...trainingResult.signature,
        displayName: editedName,
        medium: editedMedium,
      };

      const path = await api.cameraTrainer.exportSignature(signature);
      if (path) {
        alert(`Signature exported to:\n${path}`);
      }
    } catch (error) {
      trainingError = 'Failed to export signature';
      console.error(error);
    }
  }
</script>

<div class="page">
  <header class="page-header">
    <div class="header-content">
      <h2>Cameras</h2>
      <p class="subtitle">Manage camera profiles</p>
    </div>
    <div class="header-actions">
      <button class="btn btn-secondary" onclick={openTrainModal}>
        Train Camera
      </button>
      <button class="btn btn-primary" onclick={openCreateModal}>
        Add Camera
      </button>
    </div>
  </header>

  <!-- USB Device Registration Section -->
  {#if connectedDevices.length > 0 || recognizedDevices.length > 0 || registeredCameras.length > 0}
    <section class="usb-section">
      <div class="usb-header">
        <h3>Device Registration</h3>
        <button class="btn btn-small" onclick={scanUSBDevices} disabled={scanningUSB}>
          {scanningUSB ? 'Scanning...' : 'Refresh'}
        </button>
      </div>

      <!-- Unregistered Devices -->
      {#if connectedDevices.length > 0}
        <div class="device-group">
          <h4 class="device-group-title">
            <span class="status-dot status-warning"></span>
            Unregistered Devices ({connectedDevices.length})
          </h4>
          <div class="device-list">
            {#each connectedDevices as device}
              <div class="device-card unregistered">
                <div class="device-info">
                  <div class="device-name">{device.productName}</div>
                  <div class="device-meta">
                    <span class="device-vendor">{device.vendorName}</span>
                    {#if device.volumes.length > 0}
                      <span class="device-storage">
                        {device.volumes.map(v => `${v.name} (${formatBytes(v.freeSpace)} free)`).join(', ')}
                      </span>
                    {/if}
                  </div>
                  {#if device.primaryVolumeUUID}
                    <div class="device-uuid">Volume ID: {device.primaryVolumeUUID.substring(0, 8)}...</div>
                  {/if}
                </div>
                <button class="btn btn-primary btn-small" onclick={() => openRegisterModal(device)}>
                  Register
                </button>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Connected & Recognized -->
      {#if recognizedDevices.length > 0}
        <div class="device-group">
          <h4 class="device-group-title">
            <span class="status-dot status-success"></span>
            Connected ({recognizedDevices.length})
          </h4>
          <div class="device-list">
            {#each recognizedDevices as { device, camera }}
              <div class="device-card registered">
                <div class="device-info">
                  <div class="device-name">{camera.name}</div>
                  <div class="device-meta">
                    <span class="device-vendor">{camera.make} {camera.model}</span>
                    {#if camera.physicalSerial}
                      <span class="device-serial">SN: {camera.physicalSerial}</span>
                    {/if}
                  </div>
                  {#if device.volumes.length > 0}
                    <div class="device-storage">
                      {device.volumes.map(v => `${v.name} (${formatBytes(v.freeSpace)} free)`).join(', ')}
                    </div>
                  {/if}
                </div>
                <span class="connected-badge">Connected</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- All Registered Cameras (including offline) -->
      {#if registeredCameras.length > 0}
        <div class="device-group">
          <h4 class="device-group-title">
            <span class="status-dot"></span>
            All Registered ({registeredCameras.length})
          </h4>
          <div class="device-list">
            {#each registeredCameras as regCam}
              {@const isConnected = recognizedDevices.some(r => r.camera.id === regCam.id)}
              <div class="device-card" class:connected={isConnected}>
                <div class="device-info">
                  <div class="device-name">
                    {regCam.name}
                    {#if isConnected}
                      <span class="online-indicator">Online</span>
                    {/if}
                  </div>
                  <div class="device-meta">
                    <span class="device-vendor">{regCam.make} {regCam.model}</span>
                    {#if regCam.physicalSerial}
                      <span class="device-serial">SN: {regCam.physicalSerial}</span>
                    {/if}
                  </div>
                  {#if regCam.lastSeen}
                    <div class="device-last-seen">
                      Last seen: {new Date(regCam.lastSeen).toLocaleDateString()}
                    </div>
                  {/if}
                </div>
                <button class="btn btn-small btn-danger" onclick={() => deleteRegisteredCamera(regCam.id)}>
                  Unregister
                </button>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </section>
  {/if}

  {#if loading}
    <div class="loading">Loading...</div>
  {:else if cameras.length === 0}
    <div class="empty-state">
      <p>No camera profiles yet.</p>
      <p>Add cameras to automatically match imported files.</p>
    </div>
  {:else}
    <div class="medium-sections">
      {#each ['modern', 'dadcam', 'super8'] as medium}
        {@const mediumCameras = cameras.filter(c => c.medium === medium)}
        {#if mediumCameras.length > 0}
          <section class="medium-section">
            <h3 class="medium-header">
              <span class="medium-badge medium-{medium}"></span>
              {getMediumName(medium as Medium)}
            </h3>
            <div class="cameras-list">
              {#each mediumCameras as camera}
                <div class="camera-card" class:inactive={camera.is_active === 0}>
                  <div class="camera-header">
                    <div class="camera-info">
                      <h4>
                        {camera.nickname || camera.name}
                        {#if camera.is_active === 0}
                          <span class="inactive-badge">Inactive</span>
                        {/if}
                      </h4>
                      {#if camera.nickname && camera.nickname !== camera.name}
                        <span class="camera-name-original">{camera.name}</span>
                      {/if}
                      {#if camera.make || camera.model}
                        <span class="camera-meta">
                          {[camera.make, camera.model].filter(Boolean).join(' ')}
                          {#if camera.serial_number}
                            <span class="serial">SN: {camera.serial_number}</span>
                          {/if}
                        </span>
                      {/if}
                    </div>
                    <div class="camera-actions">
                      <button class="btn btn-small" onclick={() => openEditModal(camera)}>
                        Edit
                      </button>
                      <button class="btn btn-small btn-danger" onclick={() => deleteCamera(camera.id)}>
                        Delete
                      </button>
                    </div>
                  </div>

                  <div class="camera-details">
                    {#if camera.color_profile}
                      <span class="detail-tag">Profile: {camera.color_profile}</span>
                    {/if}
                    {#if camera.lut_path}
                      <span class="detail-tag">LUT</span>
                    {/if}
                    {#if camera.deinterlace}
                      <span class="detail-tag">Deinterlace</span>
                    {/if}
                  </div>

                  {#if camera.notes}
                    <p class="camera-notes">{camera.notes}</p>
                  {/if}
                </div>
              {/each}
            </div>
          </section>
        {/if}
      {/each}
    </div>
  {/if}
</div>

{#if showCreateModal}
  <div class="modal-overlay" onclick={closeCreateModal} role="dialog" aria-modal="true">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="document">
      <h3>Add Camera</h3>
      <form onsubmit={(e) => { e.preventDefault(); createCamera(); }}>
        <div class="form-row">
          <div class="form-group">
            <label for="name">Name</label>
            <input id="name" type="text" bind:value={formName} required />
          </div>
          <div class="form-group">
            <label for="medium">Medium</label>
            <select id="medium" bind:value={formMedium}>
              <option value="modern">Modern Digital</option>
              <option value="dadcam">Dad Cam</option>
              <option value="super8">Super 8</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="make">Make (optional)</label>
            <input id="make" type="text" bind:value={formMake} placeholder="e.g., Sony" />
          </div>
          <div class="form-group">
            <label for="model">Model (optional)</label>
            <input id="model" type="text" bind:value={formModel} placeholder="e.g., FX3" />
          </div>
        </div>
        <div class="form-group">
          <label for="notes">Notes</label>
          <textarea id="notes" bind:value={formNotes} rows="2"></textarea>
        </div>
        <div class="form-row">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={formDeinterlace} />
            Needs deinterlacing
          </label>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick={closeCreateModal}>Cancel</button>
          <button type="submit" class="btn btn-primary">Create</button>
        </div>
      </form>
    </div>
  </div>
{/if}

{#if showEditModal && editingCamera}
  <div class="modal-overlay" onclick={closeEditModal} role="dialog" aria-modal="true">
    <div class="modal modal-edit" onclick={(e) => e.stopPropagation()} role="document">
      <h3>Edit Camera</h3>
      <form onsubmit={(e) => { e.preventDefault(); updateCamera(); }}>
        <div class="form-row">
          <div class="form-group">
            <label for="editName">Name</label>
            <input id="editName" type="text" bind:value={editName} required />
          </div>
          <div class="form-group">
            <label for="editNickname">Nickname</label>
            <input id="editNickname" type="text" bind:value={editNickname} placeholder="Display name" />
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="editMake">Make</label>
            <input id="editMake" type="text" bind:value={editMake} placeholder="e.g., Sony" />
          </div>
          <div class="form-group">
            <label for="editModel">Model</label>
            <input id="editModel" type="text" bind:value={editModel} placeholder="e.g., FX3" />
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="editSerialNumber">Serial Number</label>
            <input id="editSerialNumber" type="text" bind:value={editSerialNumber} placeholder="From XML sidecar" />
          </div>
          <div class="form-group">
            <label for="editMedium">Medium</label>
            <select id="editMedium" bind:value={editMedium}>
              <option value="modern">Modern Digital</option>
              <option value="dadcam">Dad Cam</option>
              <option value="super8">Super 8</option>
            </select>
          </div>
        </div>

        <div class="form-group">
          <label for="editColorProfile">Color Profile</label>
          <input id="editColorProfile" type="text" bind:value={editColorProfile} placeholder="e.g., S-Log3" />
        </div>

        <div class="form-group">
          <label for="editLutPath">LUT File</label>
          <div class="input-with-button">
            <input id="editLutPath" type="text" bind:value={editLutPath} placeholder="Path to .cube file" readonly />
            <button type="button" class="btn btn-small" onclick={selectLutFile}>Browse</button>
            {#if editLutPath}
              <button type="button" class="btn btn-small" onclick={() => editLutPath = ''}>Clear</button>
            {/if}
          </div>
        </div>

        <div class="form-group">
          <label for="editColor">Color Tag</label>
          <input id="editColor" type="color" bind:value={editColor} />
        </div>

        <div class="form-group">
          <label for="editNotes">Notes</label>
          <textarea id="editNotes" bind:value={editNotes} rows="2"></textarea>
        </div>

        <div class="form-row checkbox-row">
          {#if editMedium === 'dadcam'}
            <label class="checkbox-label">
              <input type="checkbox" bind:checked={editDeinterlace} />
              Needs deinterlacing
            </label>
          {/if}
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={editIsActive} />
            Active
          </label>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick={closeEditModal}>Cancel</button>
          <button type="submit" class="btn btn-primary">Save Changes</button>
        </div>
      </form>
    </div>
  </div>
{/if}

{#if showTrainModal}
  <div class="modal-overlay" onclick={closeTrainModal} role="dialog" aria-modal="true">
    <div class="modal modal-train" onclick={(e) => e.stopPropagation()} role="document">
      <h3>Train Camera Profile</h3>

      {#if trainingError}
        <div class="train-error">{trainingError}</div>
      {/if}

      {#if !trainingResult}
        <!-- Collection Phase -->
        <p class="train-description">
          Drop {trainingSession?.minimumFiles || 3}+ video files from the same camera to identify it.
        </p>

        <!-- Drop Zone -->
        <div
          class="drop-zone"
          class:drag-over={isDragOver}
          ondragenter={(e) => { e.preventDefault(); isDragOver = true; }}
          ondragleave={(e) => { e.preventDefault(); isDragOver = false; }}
          ondragover={(e) => e.preventDefault()}
          ondrop={handleTrainDrop}
        >
          <span class="drop-icon">+</span>
          <span>Drop video files or folder here</span>
          <div class="drop-buttons">
            <button type="button" class="btn btn-small" onclick={selectTrainingFiles}>
              Select Files
            </button>
            <button type="button" class="btn btn-small" onclick={selectTrainingFolder}>
              Select Folder
            </button>
          </div>
        </div>

        <!-- File List -->
        {#if trainingSession && trainingSession.files.length > 0}
          <div class="train-file-list">
            <div class="file-list-header">
              <span>
                {trainingSession.files.length} / {trainingSession.minimumFiles} files
                {#if trainingSession.files.length >= trainingSession.minimumFiles}
                  (ready)
                {/if}
              </span>
            </div>
            <div class="file-list-scroll">
              {#each trainingSession.files as file}
                <div class="train-file-item">
                  <span class="file-name" title={file.path}>{file.filename}</span>
                  <button
                    type="button"
                    class="file-remove"
                    onclick={() => removeTrainingFile(file.path)}
                  >
                    x
                  </button>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick={closeTrainModal}>
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-primary"
            disabled={!trainingSession || trainingSession.files.length < trainingSession.minimumFiles || isAnalyzing}
            onclick={analyzeTrainingFiles}
          >
            {#if isAnalyzing}
              Analyzing...
            {:else}
              Analyze Files
            {/if}
          </button>
        </div>
      {:else}
        <!-- Results Phase -->
        <div class="train-results">
          <div class="result-section">
            <h4>Detected Camera</h4>
            <div class="result-stats">
              <span>Analyzed {trainingResult.filesAnalyzed} files</span>
              <span class="confidence confidence-{trainingResult.fingerprint?.confidence || 'none'}">
                Confidence: {trainingResult.fingerprint?.confidence || 'none'}
              </span>
              <span class="source">Source: {trainingResult.fingerprint?.source || 'unknown'}</span>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="trainName">Camera Name</label>
              <input id="trainName" type="text" bind:value={editedName} required />
            </div>
            <div class="form-group">
              <label for="trainMedium">Medium</label>
              <select id="trainMedium" bind:value={editedMedium}>
                <option value="modern">Modern Digital</option>
                <option value="dadcam">Dad Cam</option>
                <option value="super8">Super 8</option>
              </select>
            </div>
          </div>

          <div class="fingerprint-details">
            <h4>Detected Camera Info</h4>
            <div class="fingerprint-grid">
              {#if trainingResult.identity?.make}
                <div class="fp-item">
                  <span class="fp-label">Make</span>
                  <span class="fp-value">{trainingResult.identity.make}</span>
                </div>
              {/if}
              {#if trainingResult.identity?.model}
                <div class="fp-item">
                  <span class="fp-label">Model</span>
                  <span class="fp-value">{trainingResult.identity.model}</span>
                </div>
              {/if}
              {#if trainingResult.supplementary?.serial}
                <div class="fp-item">
                  <span class="fp-label">Serial Number</span>
                  <span class="fp-value">{trainingResult.supplementary.serial}</span>
                </div>
              {/if}
              {#if trainingResult.supplementary?.lens}
                <div class="fp-item">
                  <span class="fp-label">Lens</span>
                  <span class="fp-value">{trainingResult.supplementary.lens}</span>
                </div>
              {/if}
              {#if trainingResult.supplementary?.gamma}
                <div class="fp-item">
                  <span class="fp-label">Color Profile</span>
                  <span class="fp-value">{trainingResult.supplementary.gamma}</span>
                </div>
              {/if}
              {#if trainingResult.specs?.codec}
                <div class="fp-item">
                  <span class="fp-label">Codec</span>
                  <span class="fp-value">{trainingResult.specs.codec}</span>
                </div>
              {/if}
              {#if trainingResult.specs?.width && trainingResult.specs?.height}
                <div class="fp-item">
                  <span class="fp-label">Resolution</span>
                  <span class="fp-value">{trainingResult.specs.width}x{trainingResult.specs.height}</span>
                </div>
              {/if}
              {#if trainingResult.specs?.frameRate}
                <div class="fp-item">
                  <span class="fp-label">Frame Rate</span>
                  <span class="fp-value">{trainingResult.specs.frameRate} fps</span>
                </div>
              {/if}
            </div>
          </div>

          {#if trainingResult.errors.length > 0}
            <div class="train-warnings">
              <strong>Warnings:</strong>
              <ul>
                {#each trainingResult.errors.slice(0, 5) as error}
                  <li>{error}</li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>

        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick={closeTrainModal}>
            Cancel
          </button>
          <button type="button" class="btn btn-secondary" onclick={exportTrainedSignature}>
            Export Signature
          </button>
          <button type="button" class="btn btn-primary" onclick={saveTrainedCamera}>
            Save Camera
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<!-- Register Device Modal -->
{#if showRegisterModal && deviceToRegister}
  <div class="modal-overlay" onclick={closeRegisterModal} role="dialog" aria-modal="true" tabindex="-1">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="document">
      <h3>Register Camera</h3>
      <p class="modal-description">
        Register this {deviceToRegister.vendorName} {deviceToRegister.productName} to identify it when importing footage.
      </p>

      <form onsubmit={(e) => { e.preventDefault(); registerDevice(); }}>
        <div class="form-group">
          <label for="registerName">Camera Name</label>
          <input
            id="registerName"
            type="text"
            bind:value={registerName}
            placeholder="e.g., JVC-A, Lead Camera, Ceremony Cam"
            required
          />
          <small class="form-hint">Give this camera a unique name to identify it</small>
        </div>

        <div class="form-group">
          <label for="registerSerial">Physical Serial Number (from camera body)</label>
          <input
            id="registerSerial"
            type="text"
            bind:value={registerPhysicalSerial}
            placeholder="e.g., 12345678"
          />
          <small class="form-hint">Check the sticker on the bottom of the camera</small>
        </div>

        <div class="form-group">
          <label for="registerNotes">Notes (optional)</label>
          <textarea
            id="registerNotes"
            bind:value={registerNotes}
            rows="2"
            placeholder="e.g., Bought 2015, has dent on lens hood"
          ></textarea>
        </div>

        <div class="device-details">
          <div class="detail-row">
            <span class="detail-label">Make:</span>
            <span class="detail-value">{deviceToRegister.vendorName}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Model:</span>
            <span class="detail-value">{deviceToRegister.productName}</span>
          </div>
          {#if deviceToRegister.volumes.length > 0}
            <div class="detail-row">
              <span class="detail-label">Storage:</span>
              <span class="detail-value">
                {deviceToRegister.volumes.map(v => v.name).join(', ')}
              </span>
            </div>
          {/if}
          <div class="detail-row">
            <span class="detail-label">Volume ID:</span>
            <span class="detail-value detail-mono">{deviceToRegister.primaryVolumeUUID}</span>
          </div>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick={closeRegisterModal}>Cancel</button>
          <button type="submit" class="btn btn-primary" disabled={!registerName}>Register Camera</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  /* USB Device Registration Styles */
  .usb-section {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 1.25rem;
    margin-bottom: 2rem;
  }

  .usb-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .usb-header h3 {
    margin: 0;
    font-size: var(--step-0);
  }

  .device-group {
    margin-bottom: 1.25rem;
  }

  .device-group:last-child {
    margin-bottom: 0;
  }

  .device-group-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: var(--step--1);
    font-weight: 500;
    color: var(--color-text-muted);
    margin-bottom: 0.75rem;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-text-muted);
  }

  .status-dot.status-warning {
    background: #f59e0b;
  }

  .status-dot.status-success {
    background: #10b981;
  }

  .device-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .device-card {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1rem;
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: 4px;
  }

  .device-card.unregistered {
    border-color: #f59e0b;
    border-style: dashed;
  }

  .device-card.registered,
  .device-card.connected {
    border-color: #10b981;
  }

  .device-info {
    flex: 1;
    min-width: 0;
  }

  .device-name {
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .device-meta {
    font-size: var(--step--1);
    color: var(--color-text-muted);
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .device-vendor {
    font-weight: 500;
  }

  .device-serial {
    font-family: var(--font-mono);
    font-size: var(--step--2);
  }

  .device-storage {
    font-size: var(--step--2);
    color: var(--color-text-muted);
  }

  .device-uuid {
    font-size: var(--step--2);
    font-family: var(--font-mono);
    color: var(--color-text-muted);
  }

  .device-last-seen {
    font-size: var(--step--2);
    color: var(--color-text-muted);
  }

  .connected-badge {
    background: #10b981;
    color: white;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: var(--step--2);
    font-weight: 500;
  }

  .online-indicator {
    background: #10b981;
    color: white;
    padding: 0.125rem 0.375rem;
    border-radius: 4px;
    font-size: var(--step--2);
    font-weight: 500;
  }

  /* Modal additions */
  .modal-description {
    color: var(--color-text-muted);
    margin-bottom: 1.5rem;
  }

  .form-hint {
    display: block;
    margin-top: 0.25rem;
    font-size: var(--step--2);
    color: var(--color-text-muted);
  }

  .device-details {
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 0.75rem 1rem;
    margin: 1rem 0;
  }

  .detail-row {
    display: flex;
    gap: 0.5rem;
    font-size: var(--step--1);
    padding: 0.25rem 0;
  }

  .detail-label {
    color: var(--color-text-muted);
    min-width: 80px;
  }

  .detail-value {
    flex: 1;
    word-break: break-all;
  }

  .detail-mono {
    font-family: var(--font-mono);
    font-size: var(--step--2);
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 2rem;
  }

  .header-content h2 { margin-bottom: 0.25rem; }
  .subtitle { color: var(--color-text-muted); margin: 0; }

  .loading, .empty-state {
    padding: 3rem;
    text-align: center;
    background: var(--color-surface);
    border: 1px dashed var(--color-border);
    border-radius: 4px;
    color: var(--color-text-muted);
  }

  .medium-sections { display: flex; flex-direction: column; gap: 2rem; }

  .medium-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
    font-size: var(--step-1);
  }

  .medium-badge {
    width: 12px;
    height: 12px;
    border-radius: 50%;
  }

  .medium-modern { background: var(--color-medium-modern); }
  .medium-dadcam { background: var(--color-medium-dadcam); }
  .medium-super8 { background: var(--color-medium-super8); }

  .cameras-list { display: flex; flex-direction: column; gap: 0.75rem; }

  .camera-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 1rem 1.25rem;
  }

  .camera-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 0.75rem;
  }

  .camera-info h4 {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .camera-card.inactive {
    opacity: 0.6;
  }

  .inactive-badge {
    font-size: var(--step--2);
    background: var(--color-text-muted);
    color: white;
    padding: 0.125rem 0.375rem;
    border-radius: 4px;
    font-weight: 500;
  }

  .camera-name-original {
    display: block;
    font-size: var(--step--2);
    color: var(--color-text-muted);
    font-style: italic;
  }

  .camera-meta {
    display: block;
    font-size: var(--step--1);
    color: var(--color-text-muted);
  }

  .camera-meta .serial {
    margin-left: 0.75rem;
    font-family: var(--font-mono);
    font-size: var(--step--2);
  }

  .camera-details {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 0.5rem;
  }

  .detail-tag {
    font-size: var(--step--2);
    background: var(--color-bg-alt);
    padding: 0.125rem 0.5rem;
    border-radius: 4px;
    color: var(--color-text-secondary);
  }

  .camera-actions { display: flex; gap: 0.5rem; }

  .camera-notes {
    font-size: var(--step--1);
    color: var(--color-text-secondary);
    margin: 0;
    padding-top: 0.5rem;
    border-top: 1px solid var(--color-border);
  }

  .btn {
    padding: 0.625rem 1.25rem;
    border: none;
    border-radius: 4px;
    font-size: var(--step-0);
    font-family: var(--font-sans);
    cursor: pointer;
  }

  .btn-small { padding: 0.375rem 0.75rem; font-size: var(--step--1); }
  .btn-primary { background: var(--color-text); color: var(--color-surface); }
  .btn-secondary { background: var(--color-surface); color: var(--color-text); border: 1px solid var(--color-border); }
  .btn-danger { background: var(--color-status-error); color: white; }

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal {
    background: var(--color-surface);
    border-radius: 4px;
    padding: 1.5rem;
    width: 100%;
    max-width: 560px;
  }

  .modal-small { max-width: 400px; }

  .modal h3 { margin-bottom: 1.5rem; }

  .form-row {
    display: flex;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .form-row .form-group { flex: 1; }

  .form-group {
    margin-bottom: 1rem;
  }

  .form-group label {
    display: block;
    margin-bottom: 0.375rem;
    font-size: var(--step--1);
    font-weight: 500;
  }

  .form-group input,
  .form-group select,
  .form-group textarea {
    width: 100%;
    padding: 0.625rem;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    font-size: var(--step-0);
    font-family: var(--font-sans);
  }

  .help-text {
    display: block;
    margin-top: 0.25rem;
    font-size: var(--step--2);
    color: var(--color-text-muted);
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: var(--step--1);
    cursor: pointer;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 1.5rem;
  }

  /* Header actions */
  .header-actions {
    display: flex;
    gap: 0.75rem;
  }

  /* Edit modal */
  .modal-edit { max-width: 640px; }

  .input-with-button {
    display: flex;
    gap: 0.5rem;
  }

  .input-with-button input {
    flex: 1;
  }

  .checkbox-row {
    margin-bottom: 0;
  }

  /* Training modal */
  .modal-train { max-width: 640px; }

  .train-error {
    background: var(--color-status-error);
    color: white;
    padding: 0.75rem 1rem;
    border-radius: 4px;
    margin-bottom: 1rem;
  }

  .train-description {
    color: var(--color-text-muted);
    margin: 0 0 1.5rem 0;
    font-size: var(--step--1);
  }

  .drop-zone {
    border: 2px dashed var(--color-border);
    border-radius: 4px;
    padding: 2rem;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    color: var(--color-text-muted);
    transition: border-color 0.15s, background-color 0.15s;
  }

  .drop-zone.drag-over {
    border-color: var(--color-text);
    background: var(--color-bg-alt);
  }

  .drop-icon {
    font-size: 2rem;
    line-height: 1;
    opacity: 0.5;
  }

  .drop-buttons {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .train-file-list {
    margin-top: 1.5rem;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    overflow: hidden;
  }

  .file-list-header {
    background: var(--color-bg-alt);
    padding: 0.5rem 0.75rem;
    font-size: var(--step--1);
    border-bottom: 1px solid var(--color-border);
  }

  .file-list-scroll {
    max-height: 200px;
    overflow-y: auto;
  }

  .train-file-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.375rem 0.75rem;
    border-bottom: 1px solid var(--color-border);
  }

  .train-file-item:last-child {
    border-bottom: none;
  }

  .file-name {
    font-size: var(--step--1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .file-remove {
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    padding: 0.25rem 0.5rem;
    font-size: var(--step--1);
    flex-shrink: 0;
  }

  .file-remove:hover { color: var(--color-status-error); }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Training results */
  .train-results { margin-bottom: 1rem; }

  .result-section {
    margin-bottom: 1.5rem;
  }

  .result-section h4 {
    margin: 0 0 0.5rem 0;
    font-size: var(--step-0);
  }

  .result-stats {
    display: flex;
    gap: 1.5rem;
    font-size: var(--step--1);
    color: var(--color-text-muted);
  }

  .fingerprint-details {
    background: var(--color-bg-alt);
    border-radius: 4px;
    padding: 1rem;
    margin-bottom: 1rem;
  }

  .fingerprint-details h4 {
    margin: 0 0 0.75rem 0;
    font-size: var(--step--1);
  }

  .fingerprint-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.75rem;
  }

  .fp-item {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .fp-label {
    font-size: var(--step--2);
    color: var(--color-text-muted);
    text-transform: uppercase;
  }

  .fp-value {
    font-size: var(--step--1);
  }

  .fp-value code {
    font-family: var(--font-mono);
    background: none;
    padding: 0;
  }

  .fp-confidence {
    font-size: var(--step--2);
    color: var(--color-status-success);
  }

  .train-warnings {
    background: #fff8e6;
    border: 1px solid #ffc107;
    border-radius: 4px;
    padding: 0.75rem 1rem;
    margin-top: 1rem;
    font-size: var(--step--1);
  }

  .train-warnings ul {
    margin: 0.5rem 0 0 1rem;
    padding: 0;
  }

  .train-warnings li {
    margin-bottom: 0.25rem;
  }

  /* Confidence levels */
  .confidence {
    font-weight: 500;
  }
  .confidence-high { color: var(--color-status-success); }
  .confidence-medium { color: #f59e0b; }
  .confidence-low { color: var(--color-status-error); }
  .confidence-none { color: var(--color-text-muted); }

  .source {
    color: var(--color-text-muted);
  }
</style>
