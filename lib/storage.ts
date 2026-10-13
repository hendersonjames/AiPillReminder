// lib/storage.ts
// User-scoped localStorage utilities to prevent data leakage between users

import type { Pill, OutboxEntry } from '../types';
import type { QueuedTap } from './loadOrchestration';

const PILLS_KEY_PREFIX = 'remedi_pills_';
const LAST_SWEEP_KEY_PREFIX = 'remedi_last_missed_sweep_';
const PENDING_SYNC_KEY_PREFIX = 'remedi_pending_sync_';
const CLOUD_IDS_KEY_PREFIX = 'remedi_cloud_ids_';
const OUTBOX_KEY_PREFIX = 'remedi_outbox_';
const QUEUED_TAPS_KEY_PREFIX = 'remedi_queued_taps_';

// Legacy unscoped keys that must be purged (from pre-fix versions)
const LEGACY_UNSCOPED_KEYS = ['pills', 'remedi_last_missed_sweep'];

// Get user-scoped storage key
const getUserKey = (prefix: string, userId: string): string => `${prefix}${userId}`;

// ─── Purge legacy unscoped data (call at startup, before auth) ────────────────
// These keys have no owner and could belong to anyone who used the device.
// Delete them unconditionally to prevent data leakage.

export const purgeLegacyUnscopedData = (): void => {
  LEGACY_UNSCOPED_KEYS.forEach(key => {
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore errors - best effort cleanup
    }
  });
};

// ─── Pills storage ────────────────────────────────────────────────────────────

export const loadPillsFromStorage = (userId: string): Pill[] => {
  try {
    const key = getUserKey(PILLS_KEY_PREFIX, userId);
    const stored = localStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('Failed to parse pills from localStorage', error);
  }
  return [];
};

export const savePillsToStorage = (userId: string, pills: Pill[]): void => {
  try {
    const key = getUserKey(PILLS_KEY_PREFIX, userId);
    localStorage.setItem(key, JSON.stringify(pills));
  } catch (error) {
    console.error('Failed to save pills to localStorage', error);
  }
};

// ─── Cloud IDs tracking (for delta sync) ──────────────────────────────────────

export const loadCloudIdsFromStorage = (userId: string): Set<string> => {
  try {
    const key = getUserKey(CLOUD_IDS_KEY_PREFIX, userId);
    const stored = localStorage.getItem(key);
    if (stored) {
      return new Set(JSON.parse(stored));
    }
  } catch (error) {
    console.error('Failed to parse cloud IDs from localStorage', error);
  }
  return new Set();
};

export const saveCloudIdsToStorage = (userId: string, ids: Set<string>): void => {
  try {
    const key = getUserKey(CLOUD_IDS_KEY_PREFIX, userId);
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch (error) {
    console.error('Failed to save cloud IDs to localStorage', error);
  }
};

// ─── Outbox (durable offline queue) ───────────────────────────────────────────

export const loadOutboxFromStorage = (userId: string): OutboxEntry[] => {
  try {
    const key = getUserKey(OUTBOX_KEY_PREFIX, userId);
    const stored = localStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('Failed to parse outbox from localStorage', error);
  }
  return [];
};

export const saveOutboxToStorage = (userId: string, outbox: OutboxEntry[]): void => {
  try {
    const key = getUserKey(OUTBOX_KEY_PREFIX, userId);
    if (outbox.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(outbox));
    }
  } catch (error) {
    console.error('Failed to save outbox to localStorage', error);
  }
};

export const addToOutbox = (userId: string, entry: OutboxEntry): void => {
  const outbox = loadOutboxFromStorage(userId);
  const existingIndex = outbox.findIndex(e => e.id === entry.id);
  if (existingIndex >= 0) {
    outbox[existingIndex] = entry;
  } else {
    outbox.push(entry);
  }
  saveOutboxToStorage(userId, outbox);
};

export const removeFromOutbox = (userId: string, id: string): void => {
  const outbox = loadOutboxFromStorage(userId);
  const filtered = outbox.filter(e => e.id !== id);
  saveOutboxToStorage(userId, filtered);
};

export const clearOutbox = (userId: string): void => {
  saveOutboxToStorage(userId, []);
};

// ─── Queued notification taps (persist failed-load taps) ──────────────────────

export const loadQueuedTapsFromStorage = (userId: string): QueuedTap[] => {
  try {
    const key = getUserKey(QUEUED_TAPS_KEY_PREFIX, userId);
    const stored = localStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('Failed to parse queued taps from localStorage', error);
  }
  return [];
};

export const saveQueuedTapsToStorage = (userId: string, taps: QueuedTap[]): void => {
  try {
    const key = getUserKey(QUEUED_TAPS_KEY_PREFIX, userId);
    if (taps.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(taps));
    }
  } catch (error) {
    console.error('Failed to save queued taps to localStorage', error);
  }
};

export const addQueuedTap = (userId: string, tap: QueuedTap): void => {
  const taps = loadQueuedTapsFromStorage(userId);
  taps.push(tap);
  saveQueuedTapsToStorage(userId, taps);
};

export const clearQueuedTaps = (userId: string): void => {
  saveQueuedTapsToStorage(userId, []);
};

// ─── Missed dose sweep tracking ───────────────────────────────────────────────

export const getLastMissedSweepDate = (userId: string): string | null => {
  const key = getUserKey(LAST_SWEEP_KEY_PREFIX, userId);
  const value = localStorage.getItem(key);
  
  // Handle old format (e.g. "Mon Oct 05 2026" from toDateString())
  // vs new format ("2026-10-05" YYYY-MM-DD)
  if (value && !value.match(/^\d{4}-\d{2}-\d{2}$/)) {
    // Old format - try to parse it
    try {
      const parsed = new Date(value);
      if (!isNaN(parsed.getTime())) {
        // Convert to new format
        const newFormat = getLocalDateString(parsed);
        localStorage.setItem(key, newFormat);
        return newFormat;
      }
    } catch {
      // Invalid date - clear it
      localStorage.removeItem(key);
      return null;
    }
  }
  
  return value;
};

export const setLastMissedSweepDate = (userId: string, dateStr: string): void => {
  const key = getUserKey(LAST_SWEEP_KEY_PREFIX, userId);
  localStorage.setItem(key, dateStr);
};

// ─── Pending sync flag (for flush on visibility change) ──────────────────────

export const hasPendingSync = (userId: string): boolean => {
  const key = getUserKey(PENDING_SYNC_KEY_PREFIX, userId);
  return localStorage.getItem(key) === 'true';
};

export const setPendingSync = (userId: string, pending: boolean): void => {
  const key = getUserKey(PENDING_SYNC_KEY_PREFIX, userId);
  if (pending) {
    localStorage.setItem(key, 'true');
  } else {
    localStorage.removeItem(key);
  }
};

// ─── Clear all user data (on sign-out) ────────────────────────────────────────

export const clearUserData = (userId: string): void => {
  const keysToRemove = [
    getUserKey(PILLS_KEY_PREFIX, userId),
    getUserKey(LAST_SWEEP_KEY_PREFIX, userId),
    getUserKey(PENDING_SYNC_KEY_PREFIX, userId),
    getUserKey(CLOUD_IDS_KEY_PREFIX, userId),
    getUserKey(OUTBOX_KEY_PREFIX, userId),
    getUserKey(QUEUED_TAPS_KEY_PREFIX, userId),
  ];
  
  keysToRemove.forEach(key => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error(`Failed to remove ${key} from localStorage`, error);
    }
  });
};

// ─── Comprehensive wipe: user data + legacy keys ──────────────────────────────
// Call this on sign-out to ensure complete cleanup

export const wipeLocalUserData = (userId: string): void => {
  // Clear user-scoped data
  clearUserData(userId);
  // Also purge any legacy keys that might have appeared
  purgeLegacyUnscopedData();
};

// ─── Date helpers using LOCAL calendar date (not UTC) ─────────────────────────

export const getLocalDateString = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getTodayDateString = (): string => {
  return getLocalDateString(new Date());
};

export const getDateString = (date: Date): string => {
  return getLocalDateString(date);
};

// Parse a YYYY-MM-DD string as local midnight
export const parseLocalDateString = (dateStr: string): Date => {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
};
