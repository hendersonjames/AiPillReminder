import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isReminderTakenOnDate,
  isReminderTakenToday,
  recordMissedDoses,
  removeLatestTakenEntry,
  enhancePillsWithDerivedStatus,
} from '../lib/pillHelpers';
import { getDateString, getTodayDateString, parseLocalDateString } from '../lib/storage';
import type { Pill, HistoryEntry } from '../types';

// Helper to create a timestamp at a specific hour on a given local date
const createLocalTimestamp = (dateStr: string, hour: number): number => {
  const date = parseLocalDateString(dateStr);
  date.setHours(hour, 30, 0, 0);
  return date.getTime();
};

describe('pillHelpers', () => {
  describe('isReminderTakenOnDate', () => {
    it('returns true when there is a taken entry for the specified date', () => {
      const dateStr = '2024-01-15';
      const history: HistoryEntry[] = [
        {
          id: '1',
          reminderId: 'rem-1',
          pillName: 'Test Pill',
          time: '09:00',
          action: 'taken',
          timestamp: createLocalTimestamp(dateStr, 9),
        },
      ];

      expect(isReminderTakenOnDate(history, 'rem-1', dateStr)).toBe(true);
    });

    it('returns false when there is no taken entry for the specified date', () => {
      const history: HistoryEntry[] = [
        {
          id: '1',
          reminderId: 'rem-1',
          pillName: 'Test Pill',
          time: '09:00',
          action: 'taken',
          timestamp: createLocalTimestamp('2024-01-14', 9),
        },
      ];

      expect(isReminderTakenOnDate(history, 'rem-1', '2024-01-15')).toBe(false);
    });

    it('returns false when the entry is for a different reminder', () => {
      const dateStr = '2024-01-15';
      const history: HistoryEntry[] = [
        {
          id: '1',
          reminderId: 'rem-2',
          pillName: 'Test Pill',
          time: '09:00',
          action: 'taken',
          timestamp: createLocalTimestamp(dateStr, 9),
        },
      ];

      expect(isReminderTakenOnDate(history, 'rem-1', dateStr)).toBe(false);
    });

    it('returns false for snoozed or missed entries', () => {
      const dateStr = '2024-01-15';
      const history: HistoryEntry[] = [
        {
          id: '1',
          reminderId: 'rem-1',
          pillName: 'Test Pill',
          time: '09:00',
          action: 'snoozed',
          timestamp: createLocalTimestamp(dateStr, 9),
        },
        {
          id: '2',
          reminderId: 'rem-1',
          pillName: 'Test Pill',
          time: '09:00',
          action: 'missed',
          timestamp: createLocalTimestamp(dateStr, 23),
        },
      ];

      expect(isReminderTakenOnDate(history, 'rem-1', dateStr)).toBe(false);
    });
  });

  describe('isReminderTakenToday', () => {
    it('returns true when there is a taken entry for today', () => {
      const todayStr = getTodayDateString();
      const history: HistoryEntry[] = [
        {
          id: '1',
          reminderId: 'rem-1',
          pillName: 'Test Pill',
          time: '09:00',
          action: 'taken',
          timestamp: Date.now(),
        },
      ];

      expect(isReminderTakenToday(history, 'rem-1')).toBe(true);
    });

    it('returns false when the entry is from yesterday', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(12, 0, 0, 0);

      const history: HistoryEntry[] = [
        {
          id: '1',
          reminderId: 'rem-1',
          pillName: 'Test Pill',
          time: '09:00',
          action: 'taken',
          timestamp: yesterday.getTime(),
        },
      ];

      expect(isReminderTakenToday(history, 'rem-1')).toBe(false);
    });
  });

  describe('recordMissedDoses', () => {
    const createPill = (id: string, name: string, reminders: Pill['reminders'], history: HistoryEntry[] = []): Pill => ({
      id,
      name,
      dosage: '500mg',
      reminders,
      history,
    });

    it('records missed doses for days since last sweep', () => {
      const pill = createPill('p1', 'Vitamin D', [
        { id: 'r1', time: '09:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], taken: false },
      ]);

      // Last sweep was 3 days ago
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const lastSweepStr = getDateString(threeDaysAgo);

      const result = recordMissedDoses([pill], lastSweepStr);

      // Should have missed entries for the 2 days between sweep and yesterday
      expect(result.hasChanges).toBe(true);
      const missedEntries = result.updatedPills[0].history?.filter(h => h.action === 'missed') || [];
      expect(missedEntries.length).toBe(2);
    });

    it('does not record missed doses if already logged', () => {
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      twoDaysAgo.setHours(12, 0, 0, 0);

      const pill = createPill(
        'p1',
        'Vitamin D',
        [{ id: 'r1', time: '09:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], taken: false }],
        [
          {
            id: 'existing-taken',
            reminderId: 'r1',
            pillName: 'Vitamin D',
            time: '09:00',
            action: 'taken',
            timestamp: twoDaysAgo.getTime(),
          },
        ]
      );

      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const lastSweepStr = getDateString(threeDaysAgo);

      const result = recordMissedDoses([pill], lastSweepStr);

      // Should only add missed for yesterday, not 2 days ago (already has taken)
      const missedEntries = result.updatedPills[0].history?.filter(h => h.action === 'missed') || [];
      expect(missedEntries.length).toBe(1);
    });

    it('respects daysOfWeek schedule', () => {
      const pill = createPill('p1', 'Weekday Pill', [
        // Only weekdays (Mon-Fri: 1-5)
        { id: 'r1', time: '09:00', daysOfWeek: [1, 2, 3, 4, 5], taken: false },
      ]);

      // Last sweep was a week ago
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const lastSweepStr = getDateString(weekAgo);

      const result = recordMissedDoses([pill], lastSweepStr);

      // Verify all missed entries are for weekdays
      const missedEntries = result.updatedPills[0].history?.filter(h => h.action === 'missed') || [];
      missedEntries.forEach(entry => {
        const date = new Date(entry.timestamp);
        const dayOfWeek = date.getDay();
        expect([1, 2, 3, 4, 5]).toContain(dayOfWeek);
      });
    });

    it('returns no changes if already swept up to yesterday', () => {
      const pill = createPill('p1', 'Vitamin D', [
        { id: 'r1', time: '09:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], taken: false },
      ]);

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = getDateString(yesterday);

      const result = recordMissedDoses([pill], yesterdayStr);

      expect(result.hasChanges).toBe(false);
    });

    it('handles null lastSweepDateStr (first run)', () => {
      const pill = createPill('p1', 'Vitamin D', [
        { id: 'r1', time: '09:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], taken: false },
      ]);

      const result = recordMissedDoses([pill], null);

      // Should record missed for yesterday only
      expect(result.hasChanges).toBe(true);
      const missedEntries = result.updatedPills[0].history?.filter(h => h.action === 'missed') || [];
      expect(missedEntries.length).toBe(1);
    });
  });

  describe('removeLatestTakenEntry', () => {
    it('removes only the most recent taken entry for today', () => {
      const todayStr = getTodayDateString();
      const dayStart = parseLocalDateString(todayStr).getTime();

      const history: HistoryEntry[] = [
        {
          id: '1',
          reminderId: 'rem-1',
          pillName: 'Test',
          time: '09:00',
          action: 'taken',
          timestamp: dayStart + 3600000, // 1 hour after midnight
        },
        {
          id: '2',
          reminderId: 'rem-1',
          pillName: 'Test',
          time: '09:00',
          action: 'taken',
          timestamp: dayStart + 7200000, // 2 hours after midnight
        },
      ];

      const result = removeLatestTakenEntry(history, 'rem-1');

      expect(result.length).toBe(1);
      expect(result[0].id).toBe('1'); // Only the earlier one remains
    });

    it('does not remove entries from other days', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(12, 0, 0, 0);

      const history: HistoryEntry[] = [
        {
          id: '1',
          reminderId: 'rem-1',
          pillName: 'Test',
          time: '09:00',
          action: 'taken',
          timestamp: yesterday.getTime(),
        },
      ];

      const result = removeLatestTakenEntry(history, 'rem-1');

      expect(result.length).toBe(1); // Entry preserved (different day)
    });

    it('does not remove entries for other reminders', () => {
      const now = new Date();

      const history: HistoryEntry[] = [
        {
          id: '1',
          reminderId: 'rem-2',
          pillName: 'Test',
          time: '09:00',
          action: 'taken',
          timestamp: now.getTime(),
        },
      ];

      const result = removeLatestTakenEntry(history, 'rem-1');

      expect(result.length).toBe(1); // Entry preserved (different reminder)
    });
  });

  describe('enhancePillsWithDerivedStatus', () => {
    it('sets taken=true for reminders with taken history today', () => {
      const now = new Date();

      const pills: Pill[] = [
        {
          id: 'p1',
          name: 'Test Pill',
          dosage: '500mg',
          reminders: [
            { id: 'r1', time: '09:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], taken: false },
            { id: 'r2', time: '21:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], taken: false },
          ],
          history: [
            {
              id: 'h1',
              reminderId: 'r1',
              pillName: 'Test Pill',
              time: '09:00',
              action: 'taken',
              timestamp: now.getTime(),
            },
          ],
        },
      ];

      const enhanced = enhancePillsWithDerivedStatus(pills);

      expect(enhanced[0].reminders[0].taken).toBe(true); // r1 has taken history
      expect(enhanced[0].reminders[1].taken).toBe(false); // r2 has no taken history
    });
  });
});
