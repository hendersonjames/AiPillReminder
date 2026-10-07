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
  migrateUnscopedData,
  getTodayDateString,
  getDateString,
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

  describe('migrateUnscopedData', () => {
    it('migrates old unscoped pills to user-scoped storage', () => {
      const oldPills = [createTestPill('1', 'Old Pill')];
      localStorage.setItem('pills', JSON.stringify(oldPills));
      localStorage.setItem('remedi_last_missed_sweep', '2024-01-15');

      const migrated = migrateUnscopedData(testUserId);

      expect(migrated).toEqual(oldPills);
      expect(loadPillsFromStorage(testUserId)).toEqual(oldPills);
      expect(getLastMissedSweepDate(testUserId)).toBe('2024-01-15');

      // Old keys should be removed
      expect(localStorage.getItem('pills')).toBeNull();
      expect(localStorage.getItem('remedi_last_missed_sweep')).toBeNull();
    });

    it('does not overwrite existing user data', () => {
      const existingPills = [createTestPill('1', 'Existing Pill')];
      const oldPills = [createTestPill('2', 'Old Pill')];

      savePillsToStorage(testUserId, existingPills);
      localStorage.setItem('pills', JSON.stringify(oldPills));

      const migrated = migrateUnscopedData(testUserId);

      expect(migrated).toBeNull();
      expect(loadPillsFromStorage(testUserId)).toEqual(existingPills);

      // Old keys should still be removed
      expect(localStorage.getItem('pills')).toBeNull();
    });

    it('returns null when there is no unscoped data', () => {
      const migrated = migrateUnscopedData(testUserId);
      expect(migrated).toBeNull();
    });
  });

  describe('date helpers', () => {
    it('getTodayDateString returns YYYY-MM-DD format', () => {
      const result = getTodayDateString();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('getDateString returns YYYY-MM-DD format for any date', () => {
      const date = new Date('2024-01-15T10:30:00');
      expect(getDateString(date)).toBe('2024-01-15');
    });
  });
});
