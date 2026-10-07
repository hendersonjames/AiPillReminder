import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadPillsFromStorage,
  savePillsToStorage,
  loadCloudIdsFromStorage,
  saveCloudIdsToStorage,
  getLastMissedSweepDate,
  setLastMissedSweepDate,
  hasPendingSync,
  setPendingSync,
  clearUserData,
  wipeLocalUserData,
  purgeLegacyUnscopedData,
  getTodayDateString,
  getDateString,
  getLocalDateString,
  parseLocalDateString,
} from '../lib/storage';
import type { Pill } from '../types';

describe('storage', () => {
  const testUserId = 'user-123';
  const otherUserId = 'user-456';

  const createTestPill = (id: string, name: string): Pill => ({
    id,
    name,
    dosage: '500mg',
    reminders: [{ id: 'r1', time: '09:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], taken: false }],
    history: [],
  });

  describe('user-scoped storage isolation', () => {
    it('stores pills separately for different users', () => {
      const userAPills = [createTestPill('1', 'User A Pill')];
      const userBPills = [createTestPill('2', 'User B Pill')];

      savePillsToStorage(testUserId, userAPills);
      savePillsToStorage(otherUserId, userBPills);

      expect(loadPillsFromStorage(testUserId)).toEqual(userAPills);
      expect(loadPillsFromStorage(otherUserId)).toEqual(userBPills);
    });

    it('returns empty array for user with no stored pills', () => {
      expect(loadPillsFromStorage('nonexistent-user')).toEqual([]);
    });

    it('clearing one user data does not affect another user', () => {
      const userAPills = [createTestPill('1', 'User A Pill')];
      const userBPills = [createTestPill('2', 'User B Pill')];

      savePillsToStorage(testUserId, userAPills);
      savePillsToStorage(otherUserId, userBPills);
      setLastMissedSweepDate(testUserId, '2024-01-15');
      setLastMissedSweepDate(otherUserId, '2024-01-14');

      clearUserData(testUserId);

      // User A's data should be cleared
      expect(loadPillsFromStorage(testUserId)).toEqual([]);
      expect(getLastMissedSweepDate(testUserId)).toBeNull();

      // User B's data should be preserved
      expect(loadPillsFromStorage(otherUserId)).toEqual(userBPills);
      expect(getLastMissedSweepDate(otherUserId)).toBe('2024-01-14');
    });
  });

  describe('purgeLegacyUnscopedData', () => {
    it('removes legacy unscoped keys', () => {
      // Set up legacy data
      localStorage.setItem('pills', JSON.stringify([createTestPill('old', 'Old Pill')]));
      localStorage.setItem('remedi_last_missed_sweep', '2024-01-15');

      purgeLegacyUnscopedData();

      // Legacy keys should be removed
      expect(localStorage.getItem('pills')).toBeNull();
      expect(localStorage.getItem('remedi_last_missed_sweep')).toBeNull();
    });

    it('does not affect user-scoped keys', () => {
      const userPills = [createTestPill('1', 'User Pill')];
      savePillsToStorage(testUserId, userPills);
      setLastMissedSweepDate(testUserId, '2024-01-15');

      // Also set legacy keys
      localStorage.setItem('pills', JSON.stringify([createTestPill('old', 'Old Pill')]));

      purgeLegacyUnscopedData();

      // User-scoped data should be preserved
      expect(loadPillsFromStorage(testUserId)).toEqual(userPills);
      expect(getLastMissedSweepDate(testUserId)).toBe('2024-01-15');
      
      // Legacy should be gone
      expect(localStorage.getItem('pills')).toBeNull();
    });
  });

  describe('legacy keys are never migrated or shown (security fix M1)', () => {
    it('legacy unscoped pills are deleted, not migrated to any user', () => {
      const legacyPills = [createTestPill('old', 'Previous User Pill')];
      localStorage.setItem('pills', JSON.stringify(legacyPills));

      // Purge at startup (as done in App.tsx)
      purgeLegacyUnscopedData();

      // User B signs in - should get empty, not legacy data
      const userBPills = loadPillsFromStorage(otherUserId);
      expect(userBPills).toEqual([]);

      // Legacy key should be gone
      expect(localStorage.getItem('pills')).toBeNull();
    });
  });

  describe('clearUserData', () => {
    it('removes all user-scoped data', () => {
      savePillsToStorage(testUserId, [createTestPill('1', 'Test')]);
      setLastMissedSweepDate(testUserId, '2024-01-15');
      setPendingSync(testUserId, true);
      saveCloudIdsToStorage(testUserId, new Set(['1', '2']));

      clearUserData(testUserId);

      expect(loadPillsFromStorage(testUserId)).toEqual([]);
      expect(getLastMissedSweepDate(testUserId)).toBeNull();
      expect(hasPendingSync(testUserId)).toBe(false);
      expect(loadCloudIdsFromStorage(testUserId)).toEqual(new Set());
    });
  });

  describe('wipeLocalUserData', () => {
    it('clears user data and legacy keys', () => {
      savePillsToStorage(testUserId, [createTestPill('1', 'Test')]);
      localStorage.setItem('pills', JSON.stringify([createTestPill('old', 'Old')]));

      wipeLocalUserData(testUserId);

      expect(loadPillsFromStorage(testUserId)).toEqual([]);
      expect(localStorage.getItem('pills')).toBeNull();
    });
  });

  describe('cloud IDs tracking', () => {
    it('stores and retrieves cloud IDs as a Set', () => {
      const ids = new Set(['pill-1', 'pill-2', 'pill-3']);
      saveCloudIdsToStorage(testUserId, ids);

      const loaded = loadCloudIdsFromStorage(testUserId);
      expect(loaded).toEqual(ids);
    });

    it('returns empty Set for user with no cloud IDs', () => {
      expect(loadCloudIdsFromStorage('nonexistent-user')).toEqual(new Set());
    });
  });

  describe('pending sync flag', () => {
    it('tracks pending sync state per user', () => {
      expect(hasPendingSync(testUserId)).toBe(false);

      setPendingSync(testUserId, true);
      expect(hasPendingSync(testUserId)).toBe(true);

      setPendingSync(testUserId, false);
      expect(hasPendingSync(testUserId)).toBe(false);
    });
  });

  describe('old sweep date format handling (N3)', () => {
    it('converts old toDateString format to YYYY-MM-DD', () => {
      // Old format from previous version
      localStorage.setItem(`remedi_last_missed_sweep_${testUserId}`, 'Mon Oct 05 2026');

      const result = getLastMissedSweepDate(testUserId);

      // Should be converted to new format
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('preserves new YYYY-MM-DD format', () => {
      setLastMissedSweepDate(testUserId, '2024-01-15');

      const result = getLastMissedSweepDate(testUserId);
      expect(result).toBe('2024-01-15');
    });
  });

  describe('date helpers (timezone-independent)', () => {
    it('getTodayDateString returns YYYY-MM-DD format using local date', () => {
      const result = getTodayDateString();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      
      // Verify it matches local date
      const now = new Date();
      const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      expect(result).toBe(expected);
    });

    it('getDateString returns YYYY-MM-DD format for any date using local calendar', () => {
      // Create a date at noon to avoid any edge cases
      const date = new Date(2024, 0, 15, 12, 0, 0); // Jan 15, 2024 noon local
      expect(getDateString(date)).toBe('2024-01-15');
    });

    it('getLocalDateString uses local calendar components', () => {
      const date = new Date(2024, 5, 20, 12, 0, 0); // June 20, 2024 noon local
      expect(getLocalDateString(date)).toBe('2024-06-20');
    });

    it('parseLocalDateString creates local midnight', () => {
      const parsed = parseLocalDateString('2024-01-15');
      
      expect(parsed.getFullYear()).toBe(2024);
      expect(parsed.getMonth()).toBe(0); // January
      expect(parsed.getDate()).toBe(15);
      expect(parsed.getHours()).toBe(0);
      expect(parsed.getMinutes()).toBe(0);
    });

    it('round-trips date through getDateString and parseLocalDateString', () => {
      const original = new Date();
      original.setHours(12, 0, 0, 0); // Noon to avoid edge cases
      
      const dateStr = getDateString(original);
      const parsed = parseLocalDateString(dateStr);
      
      expect(parsed.getFullYear()).toBe(original.getFullYear());
      expect(parsed.getMonth()).toBe(original.getMonth());
      expect(parsed.getDate()).toBe(original.getDate());
    });
  });
});
