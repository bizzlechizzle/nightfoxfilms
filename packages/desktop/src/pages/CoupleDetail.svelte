<script lang="ts">
  /**
   * CoupleDetail - View and manage individual wedding project
   * Based on wireframe: Couples Name.pdf
   * Follows Braun/Ulm functional minimalism
   */
  import type {
    CoupleWithFiles,
    CoupleStatus,
    ContractDeliverable,
    CameraLoan,
    CameraLoanInput,
    LoanStatus,
    LoanEventType,
    Equipment,
  } from '@nightfox/core';
  import { getAPI, type CameraLoanWithDetails } from '../lib/api';
  import { generateFolderName, formatMedium, FOOTAGE_TYPE_LABELS } from '../lib/format';

  interface Props {
    coupleId: number;
    onback?: () => void;
  }

  const { coupleId, onback }: Props = $props();

  const api = getAPI();

  let couple = $state<CoupleWithFiles | null>(null);
  let loading = $state(true);
  let importing = $state(false);
  let syncing = $state(false);
  let syncMessage = $state<string | null>(null);
  let regeneratingThumbnails = $state(false);
  let regenerateMessage = $state<string | null>(null);

  // Working path setup state
  let showWorkingPathModal = $state(false);
  let pendingImportFiles = $state<string[]>([]);
  let selectedWorkingPath = $state('');

  // Footage type selection state
  let showFootageTypeModal = $state(false);
  let selectedFootageType = $state<'wedding' | 'date_night' | 'rehearsal' | 'other'>('wedding');
  let detectedFileCount = $state(0);
  let importIsFolder = $state(false);  // Track if user selected a folder vs individual files
  let customFootageType = $state('');  // For "Other" option custom input

  // Thumbnail cache: fileId -> data URL
  let thumbnails = $state<Map<number, string>>(new Map());
  let loadingThumbnails = $state(false);

  // Video lightbox state - includes full file data for media info display
  let lightboxFile = $state<{
    id: number;
    blake3: string;
    original_filename: string;
    duration_seconds: number | null;
    width: number | null;
    height: number | null;
    frame_rate: number | null;
    codec: string | null;
    bitrate: number | null;
    file_size: number | null;
    detected_make: string | null;
    detected_model: string | null;
    medium: string | null;
    recorded_at: string | null;
  } | null>(null);
  let lightboxVideoUrl = $state<string | null>(null);

  // Camera loan state
  let loans = $state<CameraLoanWithDetails[]>([]);
  let availableLoaners = $state<Equipment[]>([]);
  let showLoanModal = $state(false);
  let loanFormEquipment = $state<number | ''>('');
  let loanFormEventType = $state<LoanEventType>('date_night');
  let loanFormShipBy = $state('');
  let loanFormEventDate = $state('');
  let loanFormDueBack = $state('');
  let loanFormNotes = $state('');

  const statusLabels: Record<string, string> = {
    booked: 'Booked',
    ingested: 'Ingested',
    editing: 'Editing',
    delivered: 'Delivered',
    archived: 'Archived',
  };

  const loanStatusLabels: Record<LoanStatus, string> = {
    requested: 'Requested',
    approved: 'Approved',
    preparing: 'Preparing',
    shipped: 'Shipped',
    delivered: 'Delivered',
    active: 'Active',
    return_shipped: 'Return Shipped',
    received: 'Received',
    inspected: 'Inspected',
    completed: 'Completed',
    cancelled: 'Cancelled',
    lost: 'Lost',
    damaged: 'Damaged',
  };

  const eventTypeLabels: Record<string, string> = {
    wedding: 'Wedding',
    date_night: 'Date Night',
    other: 'Other',
  };

  // Parse deliverables from JSON
  const deliverables = $derived.by(() => {
    if (!couple) return [] as ContractDeliverable[];
    if (couple.deliverables_json) {
      try {
        return JSON.parse(couple.deliverables_json) as ContractDeliverable[];
      } catch {
        return [] as ContractDeliverable[];
      }
    }
    return [] as ContractDeliverable[];
  });

  // Filter to only edit deliverables (highlight films, teasers, etc.)
  const editDeliverables = $derived.by(() => {
    return deliverables.filter((d: ContractDeliverable) => d.category === 'edit');
  });

  // Helper: Check if a date has passed (defined first for use in derived values)
  const isDatePast = (dateStr: string | null): boolean => {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    date.setHours(0, 0, 0, 0);
    return date < today;
  };

  // Check if Date Night is included (session category deliverables)
  const hasDateNight = $derived.by(() => {
    return deliverables.some((d: ContractDeliverable) => d.code === 'session_datenight' || d.category === 'session');
  });

  // Check if Rehearsal Dinner is included in deliverables
  const hasRehearsalDinner = $derived.by(() => {
    return deliverables.some((d: ContractDeliverable) =>
      d.code === 'session_rehearsal' ||
      d.code === 'rehearsal_dinner' ||
      d.code === 'rehearsal'
    );
  });

  // Check if wedding date has passed (can import wedding footage)
  const weddingHasOccurred = $derived(couple?.wedding_date ? isDatePast(couple.wedding_date) : false);

  // Check if Raw Footage or Timeline deliverables exist
  const hasRawOrTimeline = $derived.by(() => {
    return deliverables.some((d: ContractDeliverable) => d.category === 'raw' || d.category === 'timeline');
  });

  // Check if camera loan deliverable exists (explicit contract item)
  // Camera loans are typically in 'session' category with specific codes
  const hasCameraLoanDeliverable = $derived.by(() => {
    return deliverables.some((d: ContractDeliverable) =>
      d.code === 'loaner_camera' ||
      d.code === 'camera_loan' ||
      d.code === 'loaner' ||
      d.code === 'guest_cam'
    );
  });

  // Show camera loans section ONLY if:
  // 1. Contract explicitly includes camera loan deliverable
  // 2. OR there are existing loans for this couple (historical data)
  const showCameraLoans = $derived(hasCameraLoanDeliverable || loans.length > 0);

  // Format medium for display
  const mediumDisplay = $derived.by(() => {
    if (!couple?.mediums_json) return 'Medium not specified';
    try {
      const mediums = JSON.parse(couple.mediums_json) as string[];
      if (mediums.length === 0) return 'Medium not specified';
      const labels: Record<string, string> = {
        modern: 'Modern 4K Digital',
        dadcam: 'Dad Cam',
        super8: 'Super 8',
      };
      if (mediums.length === 1) return labels[mediums[0]] || mediums[0];
      if (mediums.length === 3) return 'Super 8 + Dad Cam + Modern Digital';
      return mediums.map(m => labels[m]?.split(' ')[0] || m).join(' + ');
    } catch {
      return 'Medium not specified';
    }
  });

  // Calculate due date
  const dueDate = $derived.by(() => {
    if (!couple) return null;
    if (couple.due_date) return couple.due_date;
    if (!couple.wedding_date) return null;
    const wedding = new Date(couple.wedding_date);
    const turnaround = couple.turnaround_days || 180;
    wedding.setDate(wedding.getDate() + turnaround);
    return wedding.toISOString().split('T')[0];
  });

  // Days left until due
  const daysLeft = $derived.by(() => {
    const due = dueDate;
    if (!due) return null;
    const dueD = new Date(due);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    dueD.setHours(0, 0, 0, 0);
    return Math.ceil((dueD.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  });

  // Is this a wedding countdown (booked status with future wedding)?
  const isWeddingCountdown = $derived.by(() => {
    if (!couple) return false;
    if (couple.status !== 'booked') return false;
    if (!couple.wedding_date) return false;
    const wedding = new Date(couple.wedding_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    wedding.setHours(0, 0, 0, 0);
    return wedding.getTime() >= today.getTime();
  });

  // Days until wedding (for booked status)
  const daysUntilWedding = $derived.by(() => {
    if (!couple?.wedding_date) return null;
    const wedding = new Date(couple.wedding_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    wedding.setHours(0, 0, 0, 0);
    return Math.ceil((wedding.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  });

  // Urgency class - different thresholds for wedding countdown vs due date
  const daysLeftClass = $derived.by(() => {
    if (isWeddingCountdown) {
      const days = daysUntilWedding;
      if (days === null) return '';
      if (days < 0) return 'overdue';
      if (days < 7) return 'urgent';
      if (days < 15) return 'warning';
      return 'ok';
    }
    // Due date logic for post-wedding statuses
    const days = daysLeft;
    if (days === null) return '';
    if (days < 0) return 'overdue';
    if (days <= 14) return 'urgent';
    if (days <= 30) return 'warning';
    return 'ok';
  });

  // Countdown display (number + unit) - converts to weeks when > 14 days
  const countdownDisplay = $derived.by(() => {
    const days = isWeddingCountdown ? daysUntilWedding : daysLeft;
    if (days === null) return { number: '-', unit: '' };
    if (days === 0) return { number: '0', unit: 'Days' };
    if (days < 0) {
      const absDays = Math.abs(days);
      if (absDays > 14) {
        const weeks = Math.floor(absDays / 7);
        return { number: weeks, unit: weeks === 1 ? 'Week' : 'Weeks' };
      }
      return { number: absDays, unit: absDays === 1 ? 'Day' : 'Days' };
    }
    if (days > 14) {
      const weeks = Math.floor(days / 7);
      return { number: weeks, unit: weeks === 1 ? 'Week' : 'Weeks' };
    }
    return { number: days, unit: days === 1 ? 'Day' : 'Days' };
  });

  // Context label based on status
  const countdownContext = $derived.by(() => {
    if (!couple) return '';
    if (isWeddingCountdown) return 'Wedding';
    if (couple.status === 'editing') return 'Editing';
    if (couple.status === 'delivered') return 'Delivered';
    if (couple.status === 'archived') return 'Archived';
    return 'Due';
  });

  // Show getting ready section only before wedding date
  const showGettingReady = $derived.by(() => {
    if (!couple) return false;
    // Show if we have any getting ready data
    const hasData = couple.getting_ready_1_name || couple.getting_ready_1_address ||
                    couple.getting_ready_2_name || couple.getting_ready_2_address;
    if (!hasData) return false;
    // Hide after wedding date
    if (!couple.wedding_date) return true;
    const wedding = new Date(couple.wedding_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    wedding.setHours(0, 0, 0, 0);
    return wedding >= today;
  });

  // Show separate ceremony venue if different from reception
  const hasSeparateCeremony = $derived.by(() => {
    if (!couple?.ceremony_venue_name) return false;
    return couple.ceremony_venue_name !== couple.venue_name;
  });

  // Show addresses only if wedding is within 30 days (for day-of logistics)
  const showAddresses = $derived.by(() => {
    if (!couple?.wedding_date) return false;
    const wedding = new Date(couple.wedding_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    wedding.setHours(0, 0, 0, 0);
    const daysUntil = Math.ceil((wedding.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return daysUntil >= 0 && daysUntil <= 30;
  });

  // Timeline events - completed status derived from workflow progression
  const timelineEvents = $derived.by(() => {
    if (!couple) return [];
    const statusOrder = ['booked', 'editing', 'delivered', 'archived'];
    const currentIndex = statusOrder.indexOf(couple.status);

    const events: Array<{ label: string; date: string | null | undefined; completed: boolean }> = [
      { label: 'Booked', date: couple.created_at?.split('T')[0], completed: true },
    ];

    // Add Date Night if couple has it (between Booked and Wedding)
    if (hasDateNight) {
      events.push({
        label: 'Date Night',
        date: couple.date_night_date,
        completed: isDatePast(couple.date_night_date),
      });
    }

    events.push(
      { label: 'Wedding', date: couple.wedding_date, completed: currentIndex >= 1 },
      { label: 'Editing', date: couple.date_editing_started, completed: currentIndex >= 1 },
      { label: 'Delivered', date: couple.date_delivered, completed: currentIndex >= 2 },
      { label: 'Archived', date: couple.date_archived, completed: currentIndex >= 3 },
    );

    return events;
  });

  async function loadCouple() {
    loading = true;
    try {
      couple = await window.electronAPI.couples.findWithFiles(coupleId);
      // Load loans for this couple
      loans = await window.electronAPI.loans.findByCouple(coupleId);
      // Load thumbnails for files
      if (couple?.files.length) {
        loadThumbnails(couple.files);
      }
    } catch (e) {
      console.error('Failed to load couple:', e);
    } finally {
      loading = false;
    }
  }

  async function loadThumbnails(files: { id: number; blake3: string }[]) {
    if (!couple) return;
    loadingThumbnails = true;

    // Load thumbnails in parallel (batch of 6 at a time to avoid overwhelming)
    const batchSize = 6;
    const newThumbnails = new Map(thumbnails);

    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (file) => {
          try {
            const thumb = await window.electronAPI.files.getThumbnailByHash(file.blake3, couple!.id);
            return { id: file.id, thumb };
          } catch {
            return { id: file.id, thumb: null };
          }
        })
      );

      for (const { id, thumb } of results) {
        if (thumb) {
          newThumbnails.set(id, thumb);
        }
      }
      // Update state after each batch for progressive loading
      thumbnails = new Map(newThumbnails);
    }

    loadingThumbnails = false;
  }

  async function openVideoLightbox(file: {
    id: number;
    blake3: string;
    original_filename: string;
    duration_seconds: number | null;
    width: number | null;
    height: number | null;
    frame_rate: number | null;
    codec: string | null;
    bitrate: number | null;
    file_size: number | null;
    detected_make: string | null;
    detected_model: string | null;
    medium: string | null;
    recorded_at: string | null;
  }) {
    if (!couple) return;
    lightboxFile = file;

    try {
      // Get proxy video URL (data URL from file)
      const proxyUrl = await window.electronAPI.files.getProxyByHash(file.blake3, couple.id);
      lightboxVideoUrl = proxyUrl;
    } catch (e) {
      console.error('Failed to load proxy video:', e);
      lightboxVideoUrl = null;
    }
  }

  function closeLightbox() {
    lightboxFile = null;
    lightboxVideoUrl = null;
  }

  // Get filtered video files for navigation
  function getVideoFiles() {
    return couple?.files.filter(f => f.file_type === 'video') ?? [];
  }

  // Get current index of lightbox file in video list
  function getLightboxIndex(): number {
    if (!lightboxFile) return -1;
    const videos = getVideoFiles();
    return videos.findIndex(f => f.id === lightboxFile!.id);
  }

  // Navigate to previous/next video
  async function navigateLightbox(direction: 'prev' | 'next') {
    const videos = getVideoFiles();
    const currentIndex = getLightboxIndex();
    if (currentIndex === -1 || videos.length === 0) return;

    let newIndex: number;
    if (direction === 'prev') {
      newIndex = currentIndex > 0 ? currentIndex - 1 : videos.length - 1;
    } else {
      newIndex = currentIndex < videos.length - 1 ? currentIndex + 1 : 0;
    }

    const newFile = videos[newIndex];
    if (newFile) {
      await openVideoLightbox(newFile);
    }
  }

  function handleLightboxKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      closeLightbox();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      navigateLightbox('prev');
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      navigateLightbox('next');
    }
  }

  async function loadAvailableLoaners() {
    try {
      availableLoaners = await window.electronAPI.equipment.findLoanerEligible();
    } catch (e) {
      console.error('Failed to load available loaners:', e);
    }
  }

  function openLoanModal() {
    loanFormEquipment = '';
    loanFormEventType = hasDateNight ? 'date_night' : 'guest_cam';
    loanFormShipBy = '';
    loanFormEventDate = couple?.date_night_date || couple?.wedding_date || '';
    loanFormDueBack = '';
    loanFormNotes = '';
    loadAvailableLoaners();
    showLoanModal = true;
  }

  function closeLoanModal() {
    showLoanModal = false;
  }

  async function createLoan() {
    if (!loanFormEquipment || !loanFormEventDate) return;

    try {
      const input: CameraLoanInput = {
        equipment_id: Number(loanFormEquipment),
        couple_id: coupleId,
        event_type: loanFormEventType,
        status: 'requested',
        ship_by_date: loanFormShipBy || null,
        event_date: loanFormEventDate,
        due_back_date: loanFormDueBack || null,
        notes: loanFormNotes || null,
      };
      await window.electronAPI.loans.create(input);
      closeLoanModal();
      await loadCouple();
    } catch (e) {
      console.error('Failed to create loan:', e);
    }
  }

  async function advanceLoanStatus(loanId: number, newStatus: LoanStatus) {
    try {
      const result = await window.electronAPI.loans.transitionStatus(loanId, newStatus);
      if (result.success) {
        await loadCouple();
      } else {
        console.error('Failed to transition loan status:', result.error);
        alert(result.error || 'Failed to update loan status');
      }
    } catch (e) {
      console.error('Failed to advance loan status:', e);
    }
  }

  function getLoanStatusColor(status: LoanStatus): string {
    switch (status) {
      case 'requested':
      case 'approved':
        return 'bg-yellow-100 text-yellow-800';
      case 'preparing':
      case 'shipped':
        return 'bg-blue-100 text-blue-800';
      case 'delivered':
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'return_shipped':
      case 'received':
      case 'inspected':
        return 'bg-purple-100 text-purple-800';
      case 'completed':
        return 'bg-gray-100 text-gray-600';
      case 'cancelled':
        return 'bg-gray-100 text-gray-400';
      case 'lost':
      case 'damaged':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  }

  function getNextLoanStatus(currentStatus: LoanStatus): LoanStatus | null {
    const transitions: Record<LoanStatus, LoanStatus | null> = {
      requested: 'approved',
      approved: 'preparing',
      preparing: 'shipped',
      shipped: 'delivered',
      delivered: 'active',
      active: 'return_shipped',
      return_shipped: 'received',
      received: 'inspected',
      inspected: 'completed',
      completed: null,
      cancelled: null,
      lost: null,
      damaged: 'completed',
    };
    return transitions[currentStatus];
  }

  async function importFiles() {
    if (importing || !couple) return;

    try {
      const files = await api.dialog.selectFiles();
      if (files.length === 0) return;

      importIsFolder = false;  // User selected individual files

      // Check if working_path is configured
      if (!couple.working_path) {
        // Need to set up working path first
        pendingImportFiles = files;
        selectedWorkingPath = '';
        showWorkingPathModal = true;
        return;
      }

      // Ensure folder_name exists
      if (!couple.folder_name) {
        const folderName = generateFolderName(couple.wedding_date, couple.name);
        await api.couples.update(coupleId, { folder_name: folderName });
        await loadCouple();
      }

      // Show footage type selection modal
      pendingImportFiles = files;
      detectedFileCount = files.length;
      // Pre-select based on couple's timeline
      if (hasDateNight && couple.date_night_date && !isDatePast(couple.date_night_date)) {
        selectedFootageType = 'date_night';
      } else if (couple.wedding_date && !isDatePast(couple.wedding_date)) {
        selectedFootageType = 'wedding';
      } else {
        selectedFootageType = 'wedding';
      }
      showFootageTypeModal = true;
    } catch (e) {
      console.error('Failed to import files:', e);
    }
  }

  async function importFolder() {
    if (importing || !couple) return;

    try {
      const folder = await api.dialog.selectFolder();
      if (!folder) return;

      const scanResult = await api.import.scan(folder);
      if (scanResult.files.length === 0) return;

      importIsFolder = true;  // User selected a folder

      // Check if working_path is configured
      if (!couple.working_path) {
        pendingImportFiles = scanResult.files;
        selectedWorkingPath = '';
        showWorkingPathModal = true;
        return;
      }

      // Ensure folder_name exists
      if (!couple.folder_name) {
        const folderName = generateFolderName(couple.wedding_date, couple.name);
        await api.couples.update(coupleId, { folder_name: folderName });
        await loadCouple();
      }

      // Show footage type selection modal
      pendingImportFiles = scanResult.files;
      detectedFileCount = scanResult.files.length;
      // Pre-select based on couple's timeline
      if (hasDateNight && couple.date_night_date && !isDatePast(couple.date_night_date)) {
        selectedFootageType = 'date_night';
      } else if (couple.wedding_date && !isDatePast(couple.wedding_date)) {
        selectedFootageType = 'wedding';
      } else {
        selectedFootageType = 'wedding';
      }
      showFootageTypeModal = true;
    } catch (e) {
      console.error('Failed to import folder:', e);
    }
  }

  async function selectWorkingFolder() {
    const folder = await api.dialog.selectFolder();
    if (folder) {
      selectedWorkingPath = folder;
    }
  }

  async function confirmWorkingPath() {
    if (!selectedWorkingPath || !couple) return;

    try {
      // Generate folder name
      const folderName = couple.folder_name || generateFolderName(couple.wedding_date, couple.name);

      // Update couple with working_path and folder_name
      await api.couples.update(coupleId, {
        working_path: selectedWorkingPath,
        folder_name: folderName,
      });

      // Reload couple data
      await loadCouple();

      // Close working path modal
      showWorkingPathModal = false;

      // Now show footage type modal if we have pending files
      if (pendingImportFiles.length > 0) {
        detectedFileCount = pendingImportFiles.length;
        // Pre-select based on couple's timeline
        if (hasDateNight && couple.date_night_date && !isDatePast(couple.date_night_date)) {
          selectedFootageType = 'date_night';
        } else {
          selectedFootageType = 'wedding';
        }
        showFootageTypeModal = true;
      }
    } catch (e) {
      console.error('Failed to set working path:', e);
    }
  }

  async function executeImport(files: string[], footageType?: 'wedding' | 'date_night' | 'rehearsal' | 'other') {
    if (!couple) return;

    importing = true;
    try {
      await api.import.files(files, {
        coupleId,
        copyToManaged: true,
        managedStoragePath: couple.working_path || undefined,
        footageTypeOverride: footageType,
      });
      await loadCouple();
    } catch (e) {
      console.error('Import failed:', e);
    } finally {
      importing = false;
    }
  }

  function cancelWorkingPathSetup() {
    showWorkingPathModal = false;
    pendingImportFiles = [];
    selectedWorkingPath = '';
  }

  async function confirmFootageType() {
    if (pendingImportFiles.length === 0) return;

    showFootageTypeModal = false;
    const files = [...pendingImportFiles];
    const footageType = selectedFootageType;
    pendingImportFiles = [];
    importIsFolder = false;
    customFootageType = '';

    await executeImport(files, footageType);
  }

  function cancelFootageTypeSelection() {
    showFootageTypeModal = false;
    pendingImportFiles = [];
    selectedFootageType = 'wedding';
    detectedFileCount = 0;
    importIsFolder = false;
    customFootageType = '';
  }

  async function syncDocuments() {
    if (syncing || !couple) return;

    // Check if working_path is configured
    if (!couple.working_path || !couple.folder_name) {
      syncMessage = 'Working path not configured. Import files first to set up the folder.';
      setTimeout(() => { syncMessage = null; }, 3000);
      return;
    }

    syncing = true;
    syncMessage = null;

    try {
      const result = await window.electronAPI.documents.sync(coupleId);
      if (result.success) {
        syncMessage = `Documents synced: ${result.documentsUpdated.length} files written`;
      } else {
        syncMessage = `Sync failed: ${result.error || 'Unknown error'}`;
      }
    } catch (e) {
      syncMessage = `Sync error: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      syncing = false;
      // Clear message after 3 seconds
      setTimeout(() => { syncMessage = null; }, 3000);
    }
  }

  async function regenerateThumbnails() {
    if (regeneratingThumbnails || !couple) return;

    regeneratingThumbnails = true;
    regenerateMessage = 'Regenerating thumbnails with LUTs...';

    try {
      const result = await window.electronAPI.files.regenerateThumbnails(coupleId);
      if (result.success) {
        regenerateMessage = `Regenerated ${result.regenerated}/${result.total} thumbnails`;
        // Clear thumbnail cache to force reload
        thumbnails = new Map();
        // Reload couple data to get fresh thumbnail paths
        await loadCouple();
      } else {
        regenerateMessage = result.error || 'Failed to regenerate thumbnails';
      }
    } catch (e) {
      regenerateMessage = `Error: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      regeneratingThumbnails = false;
      // Clear message after 5 seconds
      setTimeout(() => { regenerateMessage = null; }, 5000);
    }
  }

  $effect(() => {
    loadCouple();
  });

  function formatDate(dateStr: string | null | undefined): string {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatDateLong(dateStr: string | null): string {
    if (!dateStr) return 'Not set';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function formatDuration(seconds: number | null): string {
    if (!seconds) return '0:00';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${minutes}:${String(secs).padStart(2, '0')}`;
  }

  function formatFileSize(bytes: number | null): string {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let unitIndex = 0;
    let size = bytes;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  function formatPhone(phone: string | null): string {
    if (!phone) return '';
    // Strip non-digits
    const digits = phone.replace(/\D/g, '');
    // Format 10-digit US numbers as xxx-xxx-xxxx
    if (digits.length === 10) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    // Return as-is if not 10 digits
    return phone;
  }
</script>

<div class="page">
  {#if loading}
    <div class="loading">Loading...</div>
  {:else if couple}
    <!-- Header -->
    <header class="page-header">
      <button class="btn btn-back" onclick={onback}>Back</button>
      <button class="btn btn-back" onclick={importFiles} disabled={importing}>
        {importing ? 'Importing...' : 'Import Files'}
      </button>
      <button class="btn btn-back" onclick={importFolder} disabled={importing}>
        Import Folder
      </button>
      <button class="btn btn-back" onclick={syncDocuments} disabled={syncing || !couple.working_path}>
        {syncing ? 'Syncing...' : 'Sync Docs'}
      </button>
      <button class="btn btn-back" onclick={regenerateThumbnails} disabled={regeneratingThumbnails || !couple.working_path}>
        {regeneratingThumbnails ? 'Regenerating...' : 'Regen Thumbs'}
      </button>
      <div class="header-content">
        <h1>{couple.name}</h1>
        <p class="page-subtitle">{formatDateLong(couple.wedding_date)}</p>
        {#if syncMessage}
          <p class="sync-message">{syncMessage}</p>
        {/if}
        {#if regenerateMessage}
          <p class="sync-message">{regenerateMessage}</p>
        {/if}
      </div>
    </header>

    <!-- Top Row: Countdown | Deliverables -->
    <div class="card-row top-row">
      <!-- Countdown Card -->
      <div class="card countdown-card {daysLeftClass}">
        <span class="countdown-number">{countdownDisplay.number}</span>
        <span class="countdown-unit">{countdownDisplay.unit}</span>
        <span class="countdown-context">{countdownContext}</span>
      </div>

      <!-- Deliverables Card (clean) -->
      <div class="card deliverables-card">
        <p class="videographer-line">{couple.videographer_count || 1} Videographer{(couple.videographer_count || 1) > 1 ? 's' : ''}</p>
        <p class="medium-line">{mediumDisplay}</p>
        {#each editDeliverables as edit}
          <p class="edit-line">{edit.name}</p>
        {/each}
        {#if hasRawOrTimeline}
          <p class="included-line">Raw Footage & Timeline</p>
        {/if}
        {#if hasDateNight}
          <p class="included-line">Date Night</p>
        {/if}
      </div>
    </div>

    <!-- Middle Row: Project Details | Contact -->
    <div class="card-row middle-row">
      <!-- Details Card -->
      <div class="card project-card">
        <h2 class="card-label">Details</h2>
        <dl class="details-grid">
          {#if showGettingReady}
            {#if couple.getting_ready_1_name || couple.getting_ready_1_address}
              <div class="detail-row">
                <dt>Getting Ready</dt>
                <dd>
                  {#if couple.getting_ready_1_name}{couple.getting_ready_1_name}{/if}
                  {#if showAddresses && couple.getting_ready_1_address}
                    {#if couple.getting_ready_1_name}<br />{/if}
                    {couple.getting_ready_1_address}
                  {/if}
                </dd>
              </div>
            {/if}
            {#if couple.getting_ready_2_name || couple.getting_ready_2_address}
              <div class="detail-row">
                <dt>Getting Ready</dt>
                <dd>
                  {#if couple.getting_ready_2_name}{couple.getting_ready_2_name}{/if}
                  {#if showAddresses && couple.getting_ready_2_address}
                    {#if couple.getting_ready_2_name}<br />{/if}
                    {couple.getting_ready_2_address}
                  {/if}
                </dd>
              </div>
            {/if}
          {/if}
          {#if hasSeparateCeremony}
            <div class="detail-row">
              <dt>Ceremony</dt>
              <dd>
                {couple.ceremony_venue_name}
                {#if showAddresses && couple.ceremony_venue_address}<br />{couple.ceremony_venue_address}{/if}
              </dd>
            </div>
            <div class="detail-row">
              <dt>Reception</dt>
              <dd>
                {#if couple.venue_name}
                  {couple.venue_name}
                  {#if showAddresses}
                    {#if couple.venue_address}<br />{couple.venue_address}{/if}
                    {#if couple.venue_city}, {couple.venue_city}{/if}{#if couple.venue_state}, {couple.venue_state}{/if}
                  {/if}
                {:else}
                  -
                {/if}
              </dd>
            </div>
          {:else}
            <div class="detail-row">
              <dt>Venue</dt>
              <dd>
                {#if couple.venue_name}
                  {couple.venue_name}
                  {#if showAddresses}
                    {#if couple.venue_address}<br />{couple.venue_address}{/if}
                    {#if couple.venue_city}, {couple.venue_city}{/if}{#if couple.venue_state}, {couple.venue_state}{/if}
                  {/if}
                {:else}
                  -
                {/if}
              </dd>
            </div>
          {/if}
          {#if couple.notes}
            <div class="detail-row full">
              <dt>Notes</dt>
              <dd>{couple.notes}</dd>
            </div>
          {/if}
        </dl>
      </div>

    </div>

    <!-- Timeline Section -->
    <section class="card timeline-card">
      <h2 class="card-label">Timeline</h2>
      <div class="timeline">
        {#each timelineEvents as event, i}
          <div class="timeline-event {event.completed ? 'completed' : 'pending'}">
            <div class="event-dot"></div>
            <span class="event-label">{event.label}</span>
            <span class="event-date">{formatDate(event.date)}</span>
          </div>
          {#if i < timelineEvents.length - 1}
            <div class="timeline-connector {event.completed ? 'completed' : 'pending'}"></div>
          {/if}
        {/each}
      </div>
    </section>

    <!-- Camera Loans Section (only show if Date Night or existing loans) -->
    {#if showCameraLoans}
      <section class="card loans-card">
        <div class="card-header-row">
          <h2 class="card-label">Camera Loans</h2>
          <button class="btn btn-small" onclick={openLoanModal}>
            + New Loan
          </button>
        </div>
        {#if loans.length === 0}
          <p class="empty-text">No camera loans for this couple yet</p>
        {:else}
          <div class="loans-list">
            {#each loans as loan (loan.id)}
              <div class="loan-item">
                <div class="loan-header">
                  <span class="loan-equipment">{loan.equipment_name}</span>
                  <span class="loan-status {getLoanStatusColor(loan.status as LoanStatus)}">
                    {loanStatusLabels[loan.status as LoanStatus]}
                  </span>
                </div>
                <div class="loan-details">
                  <span class="loan-event-type">{eventTypeLabels[loan.event_type] || loan.event_type}</span>
                  {#if loan.event_date}
                    <span class="loan-date">Event: {formatDate(loan.event_date)}</span>
                  {/if}
                  {#if loan.ship_by_date}
                    <span class="loan-date">Ship by: {formatDate(loan.ship_by_date)}</span>
                  {/if}
                </div>
                {#if getNextLoanStatus(loan.status as LoanStatus)}
                  <button
                    class="btn btn-small btn-advance"
                    onclick={() => advanceLoanStatus(loan.id, getNextLoanStatus(loan.status as LoanStatus)!)}
                  >
                    Mark as {loanStatusLabels[getNextLoanStatus(loan.status as LoanStatus)!]}
                  </button>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </section>
    {/if}

    <!-- Footage Gallery - Grouped by Type -->
    {@const videoFiles = couple.files.filter(f => f.file_type === 'video')}
    {@const footageTypeOrder = ['date_night', 'rehearsal', 'wedding', 'other', null] as const}
    {@const groupedFootage = footageTypeOrder
      .map(type => ({
        type,
        label: type ? FOOTAGE_TYPE_LABELS[type] || type : 'Unknown',
        files: videoFiles.filter(f => (f.footage_type || null) === type)
      }))
      .filter(group => group.files.length > 0)}
    {#if videoFiles.length > 0}
      {#each groupedFootage as group (group.type)}
        <section class="card footage-card">
          <h2 class="card-label">{group.label} Footage ({group.files.length})</h2>
          <div class="footage-grid">
            {#each group.files as file (file.id)}
              <button class="footage-item" title={file.original_filename} onclick={() => openVideoLightbox(file)}>
                <div class="footage-thumb">
                  {#if thumbnails.get(file.id)}
                    <img src={thumbnails.get(file.id)} alt={file.original_filename} />
                  {:else}
                    <div class="footage-placeholder">
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="23 7 16 12 23 17 23 7"></polygon>
                        <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                      </svg>
                    </div>
                  {/if}
                  {#if file.duration_seconds}
                    <span class="footage-duration">{formatDuration(file.duration_seconds)}</span>
                  {/if}
                </div>
                <div class="footage-info">
                  <span class="footage-name">{file.original_filename}</span>
                  <span class="footage-meta">{formatMedium(file.medium)}</span>
                </div>
              </button>
            {/each}
          </div>
          {#if loadingThumbnails}
            <p class="loading-thumbs">Loading thumbnails...</p>
          {/if}
        </section>
      {/each}
    {/if}

    <!-- Contact Section: Partner 1 | Partner 2 -->
    {#if couple.partner_1_name || couple.phone || couple.partner_2_name || couple.phone_2}
      <div class="card-row contact-row">
        <!-- Partner 1 -->
        <div class="card partner-card">
          <h2 class="card-label">{couple.partner_1_name || 'Partner 1'}</h2>
          <dl class="details-grid">
            {#if couple.phone}
              <div class="detail-row">
                <dt>Phone</dt>
                <dd>{formatPhone(couple.phone)}</dd>
              </div>
            {/if}
            {#if couple.partner_1_email}
              <div class="detail-row">
                <dt>Email</dt>
                <dd><a href="mailto:{couple.partner_1_email}">{couple.partner_1_email}</a></dd>
              </div>
            {:else if couple.email && !couple.partner_2_email}
              <div class="detail-row">
                <dt>Email</dt>
                <dd><a href="mailto:{couple.email}">{couple.email}</a></dd>
              </div>
            {/if}
            {#if couple.partner_1_instagram}
              <div class="detail-row">
                <dt>Instagram</dt>
                <dd><a href="https://instagram.com/{couple.partner_1_instagram}" target="_blank" rel="noopener">@{couple.partner_1_instagram}</a></dd>
              </div>
            {:else if couple.instagram && !couple.partner_2_instagram}
              <div class="detail-row">
                <dt>Instagram</dt>
                <dd><a href="https://instagram.com/{couple.instagram}" target="_blank" rel="noopener">@{couple.instagram}</a></dd>
              </div>
            {/if}
            {#if couple.mailing_address}
              <div class="detail-row">
                <dt>Address</dt>
                <dd>{couple.mailing_address}</dd>
              </div>
            {/if}
          </dl>
        </div>

        <!-- Partner 2 -->
        <div class="card partner-card">
          <h2 class="card-label">{couple.partner_2_name || 'Partner 2'}</h2>
          <dl class="details-grid">
            {#if couple.phone_2}
              <div class="detail-row">
                <dt>Phone</dt>
                <dd>{formatPhone(couple.phone_2)}</dd>
              </div>
            {/if}
            {#if couple.partner_2_email}
              <div class="detail-row">
                <dt>Email</dt>
                <dd><a href="mailto:{couple.partner_2_email}">{couple.partner_2_email}</a></dd>
              </div>
            {/if}
            {#if couple.partner_2_instagram}
              <div class="detail-row">
                <dt>Instagram</dt>
                <dd><a href="https://instagram.com/{couple.partner_2_instagram}" target="_blank" rel="noopener">@{couple.partner_2_instagram}</a></dd>
              </div>
            {/if}
            {#if couple.mailing_address}
              <div class="detail-row">
                <dt>Address</dt>
                <dd>{couple.mailing_address}</dd>
              </div>
            {/if}
          </dl>
        </div>
      </div>
    {/if}
  {:else}
    <div class="empty-state">
      <h3>Project not found</h3>
      <button class="btn btn-primary" onclick={onback}>Go Back</button>
    </div>
  {/if}
</div>

<!-- Loan Modal -->
{#if showLoanModal}
  <div class="modal-overlay" onclick={closeLoanModal}>
    <div class="modal" onclick={(e) => e.stopPropagation()}>
      <header class="modal-header">
        <h2>Create Camera Loan</h2>
        <button class="btn-icon" onclick={closeLoanModal}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </header>
      <form class="modal-body" onsubmit={(e) => { e.preventDefault(); createLoan(); }}>
        <div class="form-group">
          <label for="equipment">Equipment *</label>
          <select id="equipment" bind:value={loanFormEquipment} required>
            <option value="">Select equipment...</option>
            {#each availableLoaners as equip (equip.id)}
              <option value={equip.id}>{equip.name} ({equip.make} {equip.model})</option>
            {/each}
          </select>
          {#if availableLoaners.length === 0}
            <p class="form-hint">No loaner equipment available. Add equipment marked as "loaner" in Equipment page.</p>
          {/if}
        </div>

        <div class="form-group">
          <label for="eventType">Event Type *</label>
          <select id="eventType" bind:value={loanFormEventType}>
            <option value="date_night">Date Night</option>
            <option value="engagement">Engagement</option>
            <option value="guest_cam">Guest Cam</option>
          </select>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="eventDate">Event Date *</label>
            <input type="date" id="eventDate" bind:value={loanFormEventDate} required />
          </div>
          <div class="form-group">
            <label for="shipBy">Ship By</label>
            <input type="date" id="shipBy" bind:value={loanFormShipBy} />
          </div>
        </div>

        <div class="form-group">
          <label for="dueBack">Due Back</label>
          <input type="date" id="dueBack" bind:value={loanFormDueBack} />
        </div>

        <div class="form-group">
          <label for="loanNotes">Notes</label>
          <textarea id="loanNotes" bind:value={loanFormNotes} rows="2"></textarea>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn" onclick={closeLoanModal}>Cancel</button>
          <button type="submit" class="btn btn-primary" disabled={!loanFormEquipment || !loanFormEventDate}>
            Create Loan
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- Working Path Setup Modal -->
{#if showWorkingPathModal}
  <div class="modal-overlay" onclick={cancelWorkingPathSetup}>
    <div class="modal" onclick={(e) => e.stopPropagation()}>
      <header class="modal-header">
        <h2>Set Up Project Folder</h2>
        <button class="btn-icon" onclick={cancelWorkingPathSetup}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </header>
      <div class="modal-body">
        <p class="modal-description">
          Select a folder where project files will be stored. A subfolder will be created for this couple.
        </p>

        <div class="form-group">
          <label>Storage Location</label>
          <div class="path-selector">
            <input
              type="text"
              value={selectedWorkingPath}
              readonly
              placeholder="Select a folder..."
              class="path-input"
            />
            <button type="button" class="btn" onclick={selectWorkingFolder}>
              Browse
            </button>
          </div>
        </div>

        {#if selectedWorkingPath && couple}
          <div class="form-group">
            <label>Project Folder Name</label>
            <p class="folder-preview">
              {selectedWorkingPath}/{couple.folder_name || generateFolderName(couple.wedding_date, couple.name)}
            </p>
          </div>
        {/if}

        <p class="modal-note">
          Files will be organized by medium and camera:
          <code>source/modern/camera-name/</code>
        </p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn" onclick={cancelWorkingPathSetup}>Cancel</button>
        <button
          type="button"
          class="btn btn-primary"
          onclick={confirmWorkingPath}
          disabled={!selectedWorkingPath}
        >
          Set Folder & Import
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Footage Type Selection Modal -->
{#if showFootageTypeModal}
  <div class="modal-overlay" onclick={cancelFootageTypeSelection}>
    <div class="modal modal-sm modal-footage-type" onclick={(e) => e.stopPropagation()}>
      <header class="modal-header modal-header-clean">
        <h2>Select Footage Type</h2>
        <button class="btn-icon" onclick={cancelFootageTypeSelection}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </header>
      <div class="modal-body">
        <div class="footage-type-options">
          {#if weddingHasOccurred}
            <label class="footage-type-option" class:selected={selectedFootageType === 'wedding'}>
              <input
                type="radio"
                name="footageType"
                value="wedding"
                checked={selectedFootageType === 'wedding'}
                onchange={() => selectedFootageType = 'wedding'}
              />
              <span class="footage-type-label">Wedding Day</span>
            </label>
          {/if}

          {#if hasDateNight}
            <label class="footage-type-option" class:selected={selectedFootageType === 'date_night'}>
              <input
                type="radio"
                name="footageType"
                value="date_night"
                checked={selectedFootageType === 'date_night'}
                onchange={() => selectedFootageType = 'date_night'}
              />
              <span class="footage-type-label">Date Night</span>
            </label>
          {/if}

          {#if hasRehearsalDinner && !weddingHasOccurred}
            <label class="footage-type-option" class:selected={selectedFootageType === 'rehearsal'}>
              <input
                type="radio"
                name="footageType"
                value="rehearsal"
                checked={selectedFootageType === 'rehearsal'}
                onchange={() => selectedFootageType = 'rehearsal'}
              />
              <span class="footage-type-label">Rehearsal Dinner</span>
            </label>
          {/if}

          <label class="footage-type-option" class:selected={selectedFootageType === 'other'}>
            <input
              type="radio"
              name="footageType"
              value="other"
              checked={selectedFootageType === 'other'}
              onchange={() => selectedFootageType = 'other'}
            />
            <span class="footage-type-label">Other</span>
          </label>

          {#if selectedFootageType === 'other'}
            <input
              type="text"
              class="custom-footage-input"
              placeholder="e.g., Engagement, BTS, First Look"
              bind:value={customFootageType}
            />
          {/if}
        </div>
      </div>
      <div class="modal-footer modal-footer-clean">
        <button type="button" class="btn" onclick={cancelFootageTypeSelection}>Cancel</button>
        <button
          type="button"
          class="btn btn-primary"
          onclick={confirmFootageType}
        >
          Import {importIsFolder ? '1 Folder' : `${detectedFileCount} File${detectedFileCount !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Video Lightbox -->
{#if lightboxFile}
  {@const videoFiles = getVideoFiles()}
  {@const currentIndex = getLightboxIndex()}
  <div
    class="lightbox-overlay"
    onclick={closeLightbox}
    onkeydown={handleLightboxKeydown}
    role="dialog"
    aria-modal="true"
    aria-label="Video player"
    tabindex="-1"
  >
    <!-- Navigation: Previous -->
    {#if videoFiles.length > 1}
      <button
        class="lightbox-nav lightbox-nav-prev"
        onclick={(e) => { e.stopPropagation(); navigateLightbox('prev'); }}
        aria-label="Previous video"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </button>
    {/if}

    <div class="lightbox-content" onclick={(e) => e.stopPropagation()}>
      <header class="lightbox-header">
        <span class="lightbox-title">
          {lightboxFile.original_filename}
          {#if videoFiles.length > 1}
            <span class="lightbox-counter">{currentIndex + 1} / {videoFiles.length}</span>
          {/if}
        </span>
        <button class="lightbox-close" onclick={closeLightbox} aria-label="Close video">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </header>
      <div class="lightbox-body">
        <div class="lightbox-video-container">
          {#if lightboxVideoUrl}
            <video
              class="lightbox-video"
              src={lightboxVideoUrl}
              controls
              autoplay
            >
              <track kind="captions" />
            </video>
          {:else}
            <div class="lightbox-loading">
              <p>Loading video...</p>
            </div>
          {/if}
        </div>
        <aside class="lightbox-info">
          <h3 class="info-title">Media Info</h3>
          <dl class="info-grid">
            {#if lightboxFile.width && lightboxFile.height}
              <div class="info-item">
                <dt>Resolution</dt>
                <dd>{lightboxFile.width}x{lightboxFile.height}</dd>
              </div>
            {/if}
            {#if lightboxFile.duration_seconds}
              <div class="info-item">
                <dt>Duration</dt>
                <dd>{formatDuration(lightboxFile.duration_seconds)}</dd>
              </div>
            {/if}
            {#if lightboxFile.frame_rate}
              <div class="info-item">
                <dt>Frame Rate</dt>
                <dd>{lightboxFile.frame_rate.toFixed(2)} fps</dd>
              </div>
            {/if}
            {#if lightboxFile.codec}
              <div class="info-item">
                <dt>Codec</dt>
                <dd>{lightboxFile.codec}</dd>
              </div>
            {/if}
            {#if lightboxFile.bitrate}
              <div class="info-item">
                <dt>Bitrate</dt>
                <dd>{(lightboxFile.bitrate / 1_000_000).toFixed(1)} Mbps</dd>
              </div>
            {/if}
            {#if lightboxFile.file_size}
              <div class="info-item">
                <dt>File Size</dt>
                <dd>{(lightboxFile.file_size / (1024 * 1024 * 1024)).toFixed(2)} GB</dd>
              </div>
            {/if}
            {#if lightboxFile.detected_make || lightboxFile.detected_model}
              <div class="info-item">
                <dt>Camera</dt>
                <dd>{[lightboxFile.detected_make, lightboxFile.detected_model].filter(Boolean).join(' ')}</dd>
              </div>
            {/if}
            {#if lightboxFile.medium}
              <div class="info-item">
                <dt>Medium</dt>
                <dd>{formatMedium(lightboxFile.medium)}</dd>
              </div>
            {/if}
            {#if lightboxFile.recorded_at}
              <div class="info-item">
                <dt>Recorded</dt>
                <dd>{new Date(lightboxFile.recorded_at).toLocaleString()}</dd>
              </div>
            {/if}
          </dl>
        </aside>
      </div>
    </div>

    <!-- Navigation: Next -->
    {#if videoFiles.length > 1}
      <button
        class="lightbox-nav lightbox-nav-next"
        onclick={(e) => { e.stopPropagation(); navigateLightbox('next'); }}
        aria-label="Next video"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </button>
    {/if}
  </div>
{/if}

<style>
  .page-header {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    margin-bottom: 2rem;
  }

  /* Inset all content below header */
  .card-row,
  .card:not(.card-row .card),
  .timeline-card {
    margin-left: 2rem;
    margin-right: 2rem;
  }

  .header-content {
    margin-left: auto;
    text-align: right;
  }

  .header-content h1 {
    margin: 0;
    font-size: 3.5rem;
    font-weight: 600;
  }

  .page-subtitle {
    margin: -0.25rem 0 0;
    padding-left: 25%;
    color: var(--color-text-muted);
  }

  .sync-message {
    margin: 0.25rem 0 0;
    font-size: 0.75rem;
    color: var(--color-text-muted);
    padding: 0.25rem 0.5rem;
    background: var(--color-surface-raised, #f0f0f0);
    border-radius: 4px;
  }

  /* Card Layout */
  .card-row {
    display: grid;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .top-row {
    grid-template-columns: 1fr 2.5fr;
    align-items: stretch;
  }

  .middle-row {
    grid-template-columns: 1fr;
  }

  .contact-row {
    grid-template-columns: 1fr 1fr;
  }

  .partner-card {
    margin-bottom: 0;
  }

  .card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    padding: 1.25rem;
    margin-bottom: 1rem;
  }

  .card-label {
    margin: 0 0 1rem;
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
  }

  /* Countdown Card (centered, flexbox) */
  .countdown-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    min-height: 120px;
  }

  .countdown-number {
    font-size: 36px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.02em;
    color: var(--color-text, #1C1C1A);
  }

  .countdown-unit {
    font-size: 17px;
    font-weight: 500;
    color: var(--color-text-muted, #5C5C58);
    margin-top: 8px;
  }

  .countdown-context {
    font-size: 13px;
    font-weight: 400;
    color: #8A8A86;
    margin-top: 8px;
  }

  /* Urgency states */
  .countdown-card.warning .countdown-number { color: #C9A227; }
  .countdown-card.urgent .countdown-number { color: #B85C4A; }
  .countdown-card.overdue .countdown-number { color: #B85C4A; }
  .countdown-card.overdue .countdown-context::before { content: 'Overdue - '; }

  /* Deliverables Card (clean layout, right-aligned, vertically centered) */
  .deliverables-card {
    display: flex;
    flex-direction: column;
    justify-content: center;
    text-align: right;
  }

  .videographer-line {
    font-size: 24px;
    font-weight: 600;
    letter-spacing: -0.01em;
    margin: 0;
  }

  .medium-line {
    font-size: 15px;
    color: var(--color-text-muted, #5C5C58);
    margin: 0 0 16px;
  }

  .edit-line {
    font-size: 17px;
    font-weight: 500;
    margin: 0 0 8px;
  }

  .edit-line:last-of-type {
    margin-bottom: 0;
  }

  .included-line {
    font-size: 13px;
    color: var(--color-text-muted, #8A8A86);
    margin: 8px 0 0;
  }

  .included-line:first-of-type {
    margin-top: 16px;
  }

  /* Details Grid */
  .details-grid {
    margin: 0;
  }

  .detail-row {
    display: grid;
    grid-template-columns: 80px 1fr;
    gap: 0.75rem;
    padding: 0.375rem 0;
    border-bottom: 1px solid var(--color-border-light, #f0f0f0);
  }

  .detail-row:last-child {
    border-bottom: none;
  }

  .detail-row.full {
    grid-template-columns: 1fr;
  }

  .detail-row dt {
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
    font-weight: 500;
  }

  .detail-row dd {
    margin: 0;
    font-size: 0.875rem;
  }

  .detail-row a {
    color: #2563eb;
    text-decoration: none;
  }

  .detail-row a:hover {
    text-decoration: underline;
  }

  /* Timeline */
  .timeline-card {
    overflow-x: auto;
  }

  .timeline {
    display: flex;
    align-items: flex-start;
    min-width: 600px;
  }

  .timeline-event {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 80px;
  }

  .event-dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--color-surface);
    border: 2px solid var(--color-border);
    margin-bottom: 0.5rem;
  }

  .timeline-event.completed .event-dot {
    background: #047857;
    border-color: #047857;
  }

  .event-label {
    font-size: 0.75rem;
    font-weight: 500;
    margin-bottom: 0.125rem;
  }

  .event-date {
    font-size: 0.625rem;
    color: var(--color-text-muted);
  }

  .timeline-connector {
    flex: 1;
    height: 2px;
    background: var(--color-border);
    margin: 6px 0.25rem 0;
  }

  .timeline-connector.completed {
    background: #047857;
  }

  /* Footage Gallery */
  .footage-card {
    margin-left: 2rem;
    margin-right: 2rem;
  }

  .footage-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 1rem;
  }

  .footage-item {
    display: flex;
    flex-direction: column;
    cursor: pointer;
    transition: transform 0.15s;
  }

  .footage-item:hover {
    transform: translateY(-2px);
  }

  .footage-thumb {
    position: relative;
    aspect-ratio: 16/9;
    background: var(--color-bg-alt, #f0f0f0);
    border-radius: 4px;
    overflow: hidden;
  }

  .footage-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .footage-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--color-text-muted);
  }

  .footage-duration {
    position: absolute;
    bottom: 4px;
    right: 4px;
    padding: 2px 6px;
    background: rgba(0, 0, 0, 0.75);
    color: white;
    font-size: 0.6875rem;
    font-weight: 500;
    border-radius: 2px;
    font-variant-numeric: tabular-nums;
  }

  .footage-info {
    display: flex;
    flex-direction: column;
    padding: 0.5rem 0.25rem;
  }

  .footage-name {
    font-size: 0.75rem;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .footage-meta {
    font-size: 0.625rem;
    color: var(--color-text-muted);
    margin-top: 2px;
  }

  .loading-thumbs {
    font-size: 0.75rem;
    color: var(--color-text-muted);
    text-align: center;
    margin-top: 1rem;
  }

  /* Files Table */
  .files-table {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th, td {
    padding: 0.75rem;
    text-align: left;
    border-bottom: 1px solid var(--color-border);
  }

  th {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
    background: var(--color-bg-alt);
  }

  td {
    font-size: 0.875rem;
  }

  td.filename {
    max-width: 280px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  tbody tr:hover {
    background: var(--color-bg-alt);
  }

  /* Utils */
  .btn {
    padding: 0.5rem 1rem;
    border: none;
    font-family: inherit;
    font-size: 0.875rem;
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn-back {
    background: var(--color-surface);
    color: var(--color-text);
    border: 1px solid var(--color-border);
  }

  .btn-back:hover {
    background: var(--color-bg-alt);
  }

  .btn-primary {
    background: var(--color-text);
    color: var(--color-surface);
  }

  .loading {
    text-align: center;
    padding: 3rem;
    color: var(--color-text-muted);
  }

  .empty-state {
    text-align: center;
    padding: 3rem;
  }

  /* Camera Loans */
  .loans-card {
    margin-left: 2rem;
    margin-right: 2rem;
  }

  .card-header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .card-header-row .card-label {
    margin: 0;
  }

  .btn-small {
    padding: 0.25rem 0.75rem;
    font-size: 0.75rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 4px;
  }

  .btn-small:hover {
    border-color: var(--color-text);
  }

  .empty-text {
    color: var(--color-text-muted);
    font-size: 0.875rem;
    margin: 0;
  }

  .loans-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .loan-item {
    padding: 0.75rem;
    background: var(--color-bg-alt, #f8f8f7);
    border-radius: 6px;
  }

  .loan-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .loan-equipment {
    font-weight: 500;
  }

  .loan-status {
    font-size: 0.6875rem;
    padding: 0.125rem 0.5rem;
    border-radius: 4px;
    text-transform: uppercase;
    font-weight: 500;
  }

  .loan-details {
    display: flex;
    gap: 1rem;
    font-size: 0.75rem;
    color: var(--color-text-muted);
    margin-bottom: 0.5rem;
  }

  .loan-event-type {
    font-weight: 500;
  }

  .btn-advance {
    margin-top: 0.25rem;
  }

  /* Status colors */
  .bg-yellow-100 { background: #FEF3C7; }
  .text-yellow-800 { color: #92400E; }
  .bg-blue-100 { background: #DBEAFE; }
  .text-blue-800 { color: #1E40AF; }
  .bg-green-100 { background: #D1FAE5; }
  .text-green-800 { color: #065F46; }
  .bg-purple-100 { background: #EDE9FE; }
  .text-purple-800 { color: #5B21B6; }
  .bg-gray-100 { background: #F3F4F6; }
  .text-gray-600 { color: #4B5563; }
  .text-gray-400 { color: #9CA3AF; }
  .bg-red-100 { background: #FEE2E2; }
  .text-red-800 { color: #991B1B; }

  /* Modal */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal {
    background: var(--color-surface);
    border-radius: 8px;
    width: 90%;
    max-width: 500px;
    max-height: 90vh;
    overflow-y: auto;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--color-border);
  }

  .modal-header h2 {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
  }

  .btn-icon {
    padding: 0.25rem;
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    border-radius: 4px;
  }

  .btn-icon:hover {
    background: var(--color-bg-alt);
    color: var(--color-text);
  }

  .modal-body {
    padding: 1.25rem;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    padding-top: 1rem;
    margin-top: 1rem;
    border-top: 1px solid var(--color-border);
  }

  .modal-description {
    color: var(--color-text-muted);
    margin-bottom: 1.25rem;
    line-height: 1.5;
  }

  .modal-note {
    font-size: 0.75rem;
    color: var(--color-text-muted);
    margin-top: 1rem;
  }

  .modal-note code {
    background: var(--color-bg);
    padding: 0.125rem 0.375rem;
    border-radius: 3px;
    font-family: monospace;
  }

  .path-selector {
    display: flex;
    gap: 0.5rem;
  }

  .path-input {
    flex: 1;
    padding: 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background: var(--color-bg);
    font-size: 0.875rem;
  }

  .folder-preview {
    padding: 0.5rem;
    background: var(--color-bg);
    border-radius: 4px;
    font-family: monospace;
    font-size: 0.75rem;
    word-break: break-all;
    color: var(--color-text-muted);
  }

  /* Footage Type Modal */
  .modal-sm {
    max-width: 380px;
  }

  .footage-type-options {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .footage-type-option {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }

  .footage-type-option:hover {
    border-color: var(--color-text-muted);
  }

  .footage-type-option.selected {
    border-color: var(--color-text);
    background: var(--color-bg-alt);
  }

  .footage-type-option input[type="radio"] {
    margin: 0;
    width: 16px;
    height: 16px;
    accent-color: var(--color-text);
  }

  .footage-type-label {
    font-weight: 500;
    flex: 1;
  }

  .footage-type-date {
    font-size: 0.75rem;
    color: var(--color-text-muted);
  }

  /* Clean header/footer without lines */
  .modal-header-clean {
    border-bottom: none;
  }

  .modal-footer-clean {
    border-top: none;
    margin-top: 0;
    padding-top: 0.5rem;
  }

  /* Custom footage type input */
  .custom-footage-input {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    font-size: 14px;
    font-family: inherit;
    background: var(--color-surface);
    margin-top: 8px;
  }

  .custom-footage-input:focus {
    outline: none;
    border-color: var(--color-text);
  }

  .custom-footage-input::placeholder {
    color: var(--color-text-muted);
  }

  .form-group {
    margin-bottom: 1rem;
  }

  .form-group label {
    display: block;
    font-size: 0.75rem;
    font-weight: 500;
    margin-bottom: 0.375rem;
    color: var(--color-text);
  }

  .form-group input,
  .form-group select,
  .form-group textarea {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    font-size: 0.875rem;
    font-family: inherit;
    background: var(--color-surface);
  }

  .form-group input:focus,
  .form-group select:focus,
  .form-group textarea:focus {
    outline: none;
    border-color: var(--color-text);
  }

  .form-hint {
    font-size: 0.75rem;
    color: var(--color-text-muted);
    margin: 0.375rem 0 0;
  }

  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  /* Video Lightbox */
  .lightbox-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.9);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
  }

  .lightbox-content {
    width: 95%;
    max-width: 1400px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    background: #111;
    border-radius: 8px;
    overflow: hidden;
  }

  .lightbox-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1rem;
    background: rgba(0, 0, 0, 0.8);
    flex-shrink: 0;
  }

  .lightbox-title {
    color: #fff;
    font-size: 0.875rem;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lightbox-close {
    padding: 0.5rem;
    background: none;
    border: none;
    color: #fff;
    cursor: pointer;
    border-radius: 4px;
    opacity: 0.7;
    transition: opacity 0.15s;
  }

  .lightbox-close:hover {
    opacity: 1;
    background: rgba(255, 255, 255, 0.1);
  }

  .lightbox-nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 10;
    padding: 1rem;
    background: rgba(0, 0, 0, 0.5);
    border: none;
    border-radius: 50%;
    color: #fff;
    cursor: pointer;
    opacity: 0.7;
    transition: opacity 0.15s, background 0.15s;
  }

  .lightbox-nav:hover {
    opacity: 1;
    background: rgba(0, 0, 0, 0.8);
  }

  .lightbox-nav-prev {
    left: 1rem;
  }

  .lightbox-nav-next {
    right: 1rem;
  }

  .lightbox-counter {
    margin-left: 0.75rem;
    padding: 0.25rem 0.5rem;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 400;
  }

  .lightbox-body {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .lightbox-video-container {
    position: relative;
    flex: 1;
    min-width: 0;
    background: #000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .lightbox-video {
    width: 100%;
    height: 100%;
    max-height: 70vh;
    object-fit: contain;
  }

  .lightbox-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: #fff;
  }

  .lightbox-info {
    width: 280px;
    flex-shrink: 0;
    background: #1a1a1a;
    padding: 1.25rem;
    overflow-y: auto;
    border-left: 1px solid #333;
  }

  .info-title {
    color: #fff;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0 0 1rem 0;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid #333;
  }

  .info-grid {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
    margin: 0;
  }

  .info-item {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .info-item dt {
    color: #888;
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .info-item dd {
    color: #fff;
    font-size: 0.875rem;
    margin: 0;
    font-family: var(--font-mono, monospace);
  }

  @media (max-width: 900px) {
    .lightbox-body {
      flex-direction: column;
    }

    .lightbox-info {
      width: 100%;
      max-height: 200px;
      border-left: none;
      border-top: 1px solid #333;
    }

    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      gap: 0.75rem;
    }
  }

  /* Footage item as button */
  button.footage-item {
    all: unset;
    display: flex;
    flex-direction: column;
    cursor: pointer;
    transition: transform 0.15s;
    box-sizing: border-box;
  }

  button.footage-item:hover {
    transform: translateY(-2px);
  }

  button.footage-item:focus-visible {
    outline: 2px solid var(--color-text);
    outline-offset: 2px;
    border-radius: 4px;
  }

  /* Responsive */
  @media (max-width: 900px) {
    .top-row, .middle-row, .contact-row {
      grid-template-columns: 1fr;
    }

    .page-header {
      flex-wrap: wrap;
    }

    .form-row {
      grid-template-columns: 1fr;
    }

    .lightbox-content {
      width: 95%;
      max-height: 80vh;
    }
  }
</style>
