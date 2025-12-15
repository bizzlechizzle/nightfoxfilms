/**
 * browser-command-service.ts
 *
 * Bidirectional command routing service for Research Browser.
 * Enables the main application to send commands to the browser extension
 * and receive responses/events without any CDP (Chrome DevTools Protocol).
 *
 * Communication flow:
 * 1. Main App -> WebSocket Server -> Extension (commands)
 * 2. Extension -> WebSocket Server -> Main App (responses/events)
 *
 * This approach eliminates all bot detection fingerprints since there's
 * no automation framework connected to the browser.
 */
import { randomUUID } from 'crypto';
import { getLogger } from './logger-service';

const logger = getLogger();

// Command timeout in milliseconds
const COMMAND_TIMEOUT_MS = 15000;

/**
 * Browser command types that can be sent to the extension
 */
export type BrowserCommandAction =
  | { action: 'navigate'; url: string }
  | { action: 'newTab'; url?: string }
  | { action: 'closeTab'; tabId?: number }
  | { action: 'screenshot' }
  | { action: 'getActiveTab' }
  | { action: 'getTabs' }
  | { action: 'focusTab'; tabId: number }
  | { action: 'executeScript'; code: string }
  | { action: 'ping' };

/**
 * Command message sent to extension
 */
export interface BrowserCommand {
  type: 'browser:command';
  requestId: string;
  command: BrowserCommandAction;
}

/**
 * Response message from extension
 */
export interface BrowserResponse {
  type: 'browser:response';
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Event message from extension (not in response to a command)
 */
export interface BrowserEvent {
  type: 'browser:event';
  event:
    | { name: 'tabActivated'; tabId: number; url: string; title: string }
    | { name: 'tabUpdated'; tabId: number; url: string; title: string }
    | { name: 'tabClosed'; tabId: number }
    | { name: 'navigationCompleted'; tabId: number; url: string }
    | { name: 'extensionReady' }
    | { name: 'heartbeat' };
}

/**
 * Pending request tracking
 */
interface PendingRequest {
  resolve: (response: BrowserResponse) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
}

// Map of pending requests awaiting responses
const pendingRequests = new Map<string, PendingRequest>();

// WebSocket send function (set by WebSocket server)
let wsSendFunction: ((data: string) => void) | null = null;

// Event listeners
type EventListener = (event: BrowserEvent['event']) => void;
const eventListeners = new Set<EventListener>();

/**
 * Set the WebSocket send function
 * Called by websocket-server.ts when extension connects
 */
export function setWebSocketSender(sender: (data: string) => void): void {
  wsSendFunction = sender;
  logger.info('BrowserCommand', 'WebSocket sender registered');
}

/**
 * Clear the WebSocket send function
 * Called by websocket-server.ts when extension disconnects
 */
export function clearWebSocketSender(): void {
  wsSendFunction = null;
  logger.info('BrowserCommand', 'WebSocket sender cleared');

  // Reject all pending requests
  for (const [requestId, pending] of pendingRequests) {
    clearTimeout(pending.timeoutId);
    pending.reject(new Error('Extension disconnected'));
    pendingRequests.delete(requestId);
  }
}

/**
 * Check if extension is connected
 */
export function isExtensionConnected(): boolean {
  return wsSendFunction !== null;
}

/**
 * Send a command to the browser extension and wait for response
 */
export async function sendBrowserCommand(command: BrowserCommandAction): Promise<BrowserResponse> {
  if (!wsSendFunction) {
    return {
      type: 'browser:response',
      requestId: '',
      success: false,
      error: 'Extension not connected',
    };
  }

  const requestId = randomUUID();

  const message: BrowserCommand = {
    type: 'browser:command',
    requestId,
    command,
  };

  return new Promise((resolve, reject) => {
    // Set timeout for command
    const timeoutId = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`Command timeout: ${command.action}`));
    }, COMMAND_TIMEOUT_MS);

    // Store pending request
    pendingRequests.set(requestId, { resolve, reject, timeoutId });

    // Send command
    try {
      wsSendFunction!(JSON.stringify(message));
      logger.debug('BrowserCommand', 'Sent command', { action: command.action, requestId });
    } catch (error) {
      clearTimeout(timeoutId);
      pendingRequests.delete(requestId);
      reject(error);
    }
  });
}

/**
 * Handle response from extension
 * Called by websocket-server.ts when response message received
 */
export function handleBrowserResponse(response: BrowserResponse): void {
  const pending = pendingRequests.get(response.requestId);

  if (!pending) {
    logger.warn('BrowserCommand', 'Received response for unknown request', {
      requestId: response.requestId,
    });
    return;
  }

  clearTimeout(pending.timeoutId);
  pendingRequests.delete(response.requestId);
  pending.resolve(response);

  logger.debug('BrowserCommand', 'Received response', {
    requestId: response.requestId,
    success: response.success,
  });
}

/**
 * Handle event from extension (not a response to a command)
 * Called by websocket-server.ts when event message received
 */
export function handleBrowserEvent(event: BrowserEvent): void {
  logger.debug('BrowserCommand', 'Received event', { name: event.event.name });

  // Notify all listeners
  for (const listener of eventListeners) {
    try {
      listener(event.event);
    } catch (error) {
      logger.error('BrowserCommand', 'Event listener error', error as Error);
    }
  }
}

/**
 * Subscribe to browser events
 */
export function subscribeToBrowserEvents(listener: EventListener): () => void {
  eventListeners.add(listener);

  // Return unsubscribe function
  return () => {
    eventListeners.delete(listener);
  };
}

// ============================================================================
// Convenience Methods - High-level browser control functions
// ============================================================================

/**
 * Navigate the active tab to a URL
 */
export async function navigateTo(url: string): Promise<boolean> {
  const response = await sendBrowserCommand({ action: 'navigate', url });
  return response.success;
}

/**
 * Open a new tab with optional URL
 */
export async function openNewTab(url?: string): Promise<{ success: boolean; tabId?: number }> {
  const response = await sendBrowserCommand({ action: 'newTab', url });
  return {
    success: response.success,
    tabId: response.data as number | undefined,
  };
}

/**
 * Close a specific tab or the active tab
 */
export async function closeTab(tabId?: number): Promise<boolean> {
  const response = await sendBrowserCommand({ action: 'closeTab', tabId });
  return response.success;
}

/**
 * Get information about the active tab
 */
export async function getActiveTab(): Promise<{ url: string; title: string; tabId: number } | null> {
  const response = await sendBrowserCommand({ action: 'getActiveTab' });
  if (response.success && response.data) {
    return response.data as { url: string; title: string; tabId: number };
  }
  return null;
}

/**
 * Get all open tabs
 */
export async function getAllTabs(): Promise<Array<{ id: number; url: string; title: string }>> {
  const response = await sendBrowserCommand({ action: 'getTabs' });
  if (response.success && response.data) {
    return response.data as Array<{ id: number; url: string; title: string }>;
  }
  return [];
}

/**
 * Focus a specific tab
 */
export async function focusTab(tabId: number): Promise<boolean> {
  const response = await sendBrowserCommand({ action: 'focusTab', tabId });
  return response.success;
}

/**
 * Capture screenshot of the active tab
 */
export async function captureScreenshot(): Promise<string | null> {
  const response = await sendBrowserCommand({ action: 'screenshot' });
  if (response.success && response.data) {
    return response.data as string;
  }
  return null;
}

/**
 * Ping the extension to check connectivity
 */
export async function pingExtension(): Promise<boolean> {
  try {
    const response = await sendBrowserCommand({ action: 'ping' });
    return response.success;
  } catch {
    return false;
  }
}
