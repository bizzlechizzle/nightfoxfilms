/**
 * Formatting utilities for Nightfox Desktop
 *
 * Centralized formatting functions for consistent display across the app.
 *
 * @module lib/format
 */

import type { Medium } from '@nightfox/core';

/**
 * Medium display labels
 */
export const MEDIUM_LABELS: Record<Medium | string, string> = {
  modern: 'Modern 4K',
  dadcam: 'Dad Cam',
  super8: 'Super 8',
};

/**
 * Format medium for display
 */
export function formatMedium(medium: Medium | string | null): string {
  if (!medium) return 'Unknown';
  return MEDIUM_LABELS[medium] || medium;
}

/**
 * Format multiple mediums for display
 */
export function formatMediums(mediums: Medium[] | null): string {
  if (!mediums || mediums.length === 0) return 'None';
  if (mediums.length === 1) return formatMedium(mediums[0]);
  return mediums.map(m => MEDIUM_LABELS[m] || m).join(' + ');
}

/**
 * Generate folder name from couple data
 * Format: YYYY-MM-DD-firstname-firstname
 * Example: 2025-12-31-julia-sven
 */
export function generateFolderName(
  weddingDate: string | null,
  coupleName: string
): string {
  // Parse couple name to get first names
  // Expected format: "Julia & Sven" or "Julia and Sven"
  const names = coupleName
    .toLowerCase()
    .split(/\s*[&+]\s*|\s+and\s+/i)
    .map(n => n.trim().split(/\s+/)[0]) // Take first word of each name
    .filter(n => n.length > 0);

  const namesPart = names.length >= 2
    ? `${names[0]}-${names[1]}`
    : names[0] || 'couple';

  // Format date part
  let datePart = 'undated';
  if (weddingDate) {
    const date = new Date(weddingDate);
    if (!isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      datePart = `${year}-${month}-${day}`;
    }
  }

  // Clean folder name (remove special chars, lowercase)
  return `${datePart}-${namesPart}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number | null): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/**
 * Format duration (seconds) for display
 */
export function formatDuration(seconds: number | null): string {
  if (!seconds || seconds === 0) return '0:00';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

/**
 * Format date for short display (e.g., "Dec 31, 2025")
 */
export function formatDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Format date for long display (e.g., "December 31, 2025")
 */
export function formatDateLong(dateStr: string | null): string {
  if (!dateStr) return 'Not set';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return 'Not set';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Footage type display labels
 */
export const FOOTAGE_TYPE_LABELS: Record<string, string> = {
  wedding: 'Wedding Day',
  date_night: 'Date Night',
  rehearsal: 'Rehearsal',
  other: 'Other',
};

/**
 * Format footage type for display
 */
export function formatFootageType(footageType: string | null): string {
  if (!footageType) return 'Unknown';
  return FOOTAGE_TYPE_LABELS[footageType] || footageType;
}

/**
 * Couple status display labels
 */
export const STATUS_LABELS: Record<string, string> = {
  booked: 'Booked',
  ingested: 'Ingested',
  editing: 'Editing',
  delivered: 'Delivered',
  archived: 'Archived',
};

/**
 * Format couple status for display
 */
export function formatStatus(status: string | null): string {
  if (!status) return 'Unknown';
  return STATUS_LABELS[status] || status;
}
