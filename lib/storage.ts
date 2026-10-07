// lib/storage.ts
// User-scoped localStorage utilities to prevent data leakage between users

import type { Pill } from '../types';

const PILLS_KEY_PREFIX = 'remedi_pills_';
const LAST_SWEEP_KEY_PREFIX = 'remedi_last_missed_sweep_';
const PENDING_SYNC_KEY_PREFIX = 'remedi_pending_sync_';
const CLOUD_IDS_KEY_PREFIX = 'remedi_cloud_ids_';

// Get user-scoped storage key
const getUserKey = (prefix: string, userId: string): string => `${prefix}${userId}`;

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

// ─── Missed dose sweep tracking ───────────────────────────────────────────────

export const getLastMissedSweepDate = (userId: string): string | null => {
  const key = getUserKey(LAST_SWEEP_KEY_PREFIX, userId);
  return localStorage.getItem(key);
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
  ];
  
  keysToRemove.forEach(key => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error(`Failed to remove ${key} from localStorage`, error);
    }
  });
};

// ─── Migration: move old unscoped data to user-scoped ─────────────────────────

export const migrateUnscopedData = (userId: string): Pill[] | null => {
  try {
    // Check for old unscoped pills
    const oldPills = localStorage.getItem('pills');
    const oldSweep = localStorage.getItem('remedi_last_missed_sweep');
    
    if (oldPills) {
      const pills = JSON.parse(oldPills) as Pill[];
      
      // Only migrate if current user has no data
      const existingUserPills = loadPillsFromStorage(userId);
      if (existingUserPills.length === 0 && pills.length > 0) {
        // Migrate to user-scoped storage
        savePillsToStorage(userId, pills);
        
        // Migrate sweep date if exists
        if (oldSweep) {
          setLastMissedSweepDate(userId, oldSweep);
        }
        
        // Clean up old keys
        localStorage.removeItem('pills');
        localStorage.removeItem('remedi_last_missed_sweep');
        
        return pills;
      }
      
      // Clean up old keys even if we didn't migrate (user has data already)
      localStorage.removeItem('pills');
      localStorage.removeItem('remedi_last_missed_sweep');
    }
  } catch (error) {
    console.error('Failed to migrate unscoped data', error);
  }
  return null;
};

// ─── Get today's date string for taken status derivation ──────────────────────

export const getTodayDateString = (): string => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.toISOString().split('T')[0]; // YYYY-MM-DD
};

export const getDateString = (date: Date): string => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
};
