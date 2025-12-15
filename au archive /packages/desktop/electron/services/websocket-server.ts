/**
 * websocket-server.ts
 *
 * WebSocket server for real-time extension communication.
 * Runs on localhost:47124 alongside the HTTP API on :47123.
 *
 * Provides:
 * - Real-time location list updates
 * - Bookmark save confirmations
 * - Connection heartbeat
 * - Browser command routing (for zero-detection Research Browser)
 *
 * Browser Command Protocol:
 * - Main App sends 'browser:command' messages via browser-command-service
 * - Extension receives commands, executes them, sends 'browser:response'
 * - Extension sends 'browser:event' for tab changes, navigation, etc.
 */
import { WebSocketServer, WebSocket } from 'ws';
import { BrowserWindow } from 'electron';
import { getLogger } from './logger-service';
import {
  setWebSocketSender,
  clearWebSocketSender,
  handleBrowserResponse,
  handleBrowserEvent,
  type BrowserResponse,
  type BrowserEvent,
} from './browser-command-service';
import {
  updateExtensionHeartbeat,
  updateActiveTab,
  markExtensionDisconnected,
} from './detached-browser-service';

const WS_PORT = 47124;
const HEARTBEAT_INTERVAL = 30000; // 30 seconds

const logger = getLogger();

let wss: WebSocketServer | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;

/**
 * Set of connected WebSocket clients (general clients)
 */
const clients = new Set<WebSocket>();

/**
 * The extension WebSocket connection (for browser commands)
 * Only one extension connection is supported at a time
 */
let extensionClient: WebSocket | null = null;

/**
 * Start the WebSocket server
 */
export function startWebSocketServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (wss) {
      logger.warn('WebSocketServer', 'Server already running');
      resolve();
      return;
    }

    try {
      wss = new WebSocketServer({
        port: WS_PORT,
        host: '127.0.0.1',
      });

      wss.on('connection', (ws: WebSocket) => {
        logger.info('WebSocketServer', 'Client connected');
        clients.add(ws);

        // Handle incoming messages
        ws.on('message', (data: Buffer) => {
          try {
            const message = JSON.parse(data.toString());
            handleClientMessage(ws, message);
          } catch (err) {
            logger.error('WebSocketServer', `Invalid message: ${err}`);
          }
        });

        // Handle client disconnect
        ws.on('close', () => {
          logger.info('WebSocketServer', 'Client disconnected');
          clients.delete(ws);
        });

        // Handle client errors
        ws.on('error', (err: Error) => {
          logger.error('WebSocketServer', `Client error: ${err.message}`);
          clients.delete(ws);
        });
      });

      wss.on('listening', () => {
        logger.info('WebSocketServer', `Running on ws://localhost:${WS_PORT}`);
        startHeartbeat();
        resolve();
      });

      wss.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          logger.warn(
            'WebSocketServer',
            `Port ${WS_PORT} already in use, WebSocket features disabled`
          );
          // Don't reject - the app can work without WebSocket
          wss = null;
          resolve();
        } else {
          logger.error('WebSocketServer', `Server error: ${err.message}`);
          reject(err);
        }
      });
    } catch (err) {
      logger.error('WebSocketServer', `Failed to create server: ${err}`);
      reject(err);
    }
  });
}

/**
 * Stop the WebSocket server
 */
export function stopWebSocketServer(): Promise<void> {
  return new Promise((resolve) => {
    // Stop heartbeat
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }

    // Clear extension client and command service
    if (extensionClient) {
      try {
        extensionClient.close(1000, 'Server shutting down');
      } catch {
        // Ignore errors during cleanup
      }
      extensionClient = null;
      clearWebSocketSender();
      markExtensionDisconnected();
    }

    if (wss) {
      // Close all client connections gracefully
      clients.forEach((client) => {
        try {
          client.close(1000, 'Server shutting down');
        } catch {
          // Ignore errors during cleanup
        }
      });
      clients.clear();

      // Close the server
      wss.close(() => {
        logger.info('WebSocketServer', 'Server stopped');
        wss = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

/**
 * Handle incoming client messages
 */
function handleClientMessage(
  ws: WebSocket,
  message: { type: string; [key: string]: unknown }
): void {
  switch (message.type) {
    case 'subscribe':
      logger.info('WebSocketServer', 'Client subscribed to updates');
      // Client is now listening for updates (already added to clients set)
      break;

    case 'pong':
      // Client responded to heartbeat - connection is alive
      break;

    // ========================================================================
    // Extension Registration - Identifies this connection as the browser extension
    // ========================================================================
    case 'extension:register':
      logger.info('WebSocketServer', 'Extension registered for browser commands');
      extensionClient = ws;

      // Set up sender function for browser-command-service
      setWebSocketSender((data: string) => {
        if (extensionClient && extensionClient.readyState === WebSocket.OPEN) {
          extensionClient.send(data);
        }
      });

      // Handle extension disconnect
      ws.on('close', () => {
        if (extensionClient === ws) {
          logger.info('WebSocketServer', 'Extension disconnected');
          extensionClient = null;
          clearWebSocketSender();
          markExtensionDisconnected();
        }
      });
      break;

    // ========================================================================
    // Extension Heartbeat - Tracks extension liveness
    // ========================================================================
    case 'extension:heartbeat':
      updateExtensionHeartbeat();
      // Send acknowledgment
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'heartbeat:ack' }));
      }
      break;

    // ========================================================================
    // Browser Command Response - Extension responding to a command
    // ========================================================================
    case 'browser:response':
      handleBrowserResponse(message as unknown as BrowserResponse);
      break;

    // ========================================================================
    // Browser Event - Extension reporting browser state changes
    // ========================================================================
    case 'browser:event': {
      const event = message as unknown as BrowserEvent;
      handleBrowserEvent(event);

      // Also update detached-browser-service with tab info
      if (event.event.name === 'tabActivated' || event.event.name === 'tabUpdated') {
        const tabEvent = event.event as { name: string; tabId: number; url: string; title: string };
        updateActiveTab({
          tabId: tabEvent.tabId,
          url: tabEvent.url,
          title: tabEvent.title,
        });
      }
      break;
    }

    default:
      logger.warn('WebSocketServer', `Unknown message type: ${message.type}`);
  }
}

/**
 * Start heartbeat to keep connections alive and detect dead clients
 */
function startHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }

  heartbeatInterval = setInterval(() => {
    broadcast({ type: 'ping' });
  }, HEARTBEAT_INTERVAL);
}

/**
 * Broadcast a message to all connected clients
 */
export function broadcast(message: object): void {
  if (!wss) return;

  const data = JSON.stringify(message);

  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(data);
      } catch (err) {
        logger.error('WebSocketServer', `Failed to send to client: ${err}`);
      }
    }
  });
}

/**
 * Notify all clients that the location list has been updated
 * Call this after creating, updating, or deleting locations
 */
export function notifyLocationsUpdated(): void {
  broadcast({ type: 'locations_updated' });
}

/**
 * Notify all clients that a bookmark was saved
 * @deprecated Use notifyWebSourceSaved instead (OPT-109)
 */
export function notifyBookmarkSaved(
  bookmarkId: string,
  locid: string | null,
  subid?: string | null
): void {
  broadcast({
    type: 'bookmark_saved',
    bookmark_id: bookmarkId,
    locid,
    subid: subid || null,
  });
}

/**
 * Notify all clients that a web source was saved
 * OPT-109: Replaces notifyBookmarkSaved with richer payload
 */
export function notifyWebSourceSaved(
  sourceId: string,
  locid: string | null,
  subid: string | null,
  sourceType: string
): void {
  broadcast({
    type: 'websource_saved',
    source_id: sourceId,
    locid,
    subid,
    source_type: sourceType,
  });
  // Also broadcast legacy event for backward compatibility
  broadcast({
    type: 'bookmark_saved',
    bookmark_id: sourceId,
    locid,
    subid,
  });

  // FIX: Also notify Electron renderer windows via IPC so UI updates
  const payload = { sourceId, locid, subid, sourceType };
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send('websource:saved', payload);
    }
  });
}

/**
 * Check if the WebSocket server is running
 */
export function isWebSocketServerRunning(): boolean {
  return wss !== null && wss.clients !== undefined;
}

/**
 * Get the number of connected clients
 */
export function getClientCount(): number {
  return clients.size;
}

/**
 * Check if the browser extension is connected
 */
export function isExtensionClientConnected(): boolean {
  return extensionClient !== null && extensionClient.readyState === WebSocket.OPEN;
}
