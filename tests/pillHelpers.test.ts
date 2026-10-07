import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isReminderTakenOnDate,
  isReminderTakenToday,
  recordMissedDoses,
  removeLatestTakenEntry,
  enhancePillsWithDerivedStatus,
} from '../lib/pillHelpers';
import type { Pill, HistoryEntry } from '../types';

describe('pillHelpers', () => {
  describe('isReminderTakenOnDate', () => {
    it('returns true when there is a taken entry for the specified date', () => {
      const history: HistoryEntry[] = [
        {
          id: '1',
          reminderId: 'rem-1',
          pillName: 'Test Pill',
          time: '09:00',
          action: 'taken',
          timestamp: new Date('2024-01-15T09:30:00').getTime(),
        },
      ];

      expect(isReminderTakenOnDate(history, 'rem-1', '2024-01-15')).toBe(true);
    });

    it('returns false when there is no taken entry for the specified date', () => {
      const history: HistoryEntry[] = [
        {
          id: '1',
          reminderId: 'rem-1',
          pillName: 'Test Pill',
          time: '09:00',
          action: 'taken',
          timestamp: new Date('2024-01-14T09:30:00').getTime(),
        },
      ];

      expect(isReminderTakenOnDate(history, 'rem-1', '2024-01-15')).toBe(false);
    });

    it('returns false when the entry is for a different reminder', () => {
      const history: HistoryEntry[] = [
        {
          id: '1',
          reminderId: 'rem-2',
          pillName: 'Test Pill',
          time: '09:00',
          action: 'taken',
          timestamp: new Date('2024-01-15T09:30:00').getTime(),
        },
      ];

      expect(isReminderTakenOnDate(history, 'rem-1', '2024-01-15')).toBe(false);
    });

    it('returns false for snoozed or missed entries', () => {
      const history: HistoryEntry[] = [
        {
          id: '1',
          reminderId: 'rem-1',
          pillName: 'Test Pill',
          time: '09:00',
          action: 'snoozed',
          timestamp: new Date('2024-01-15T09:30:00').getTime(),
        },
        {
          id: '2',
          reminderId: 'rem-1',
          pillName: 'Test Pill',
          time: '09:00',
          action: 'missed',
          timestamp: new Date('2024-01-15T23:59:00').getTime(),
        },
      ];

      expect(isReminderTakenOnDate(history, 'rem-1', '2024-01-15')).toBe(false);
    });
  });

  describe('isReminderTakenToday', () => {
    it('uses current date for the check', () => {
      const now = new Date();
      const history: HistoryEntry[] = [
        {
          id: '1',
          reminderId: 'rem-1',
          pillName: 'Test Pill',
          time: '09:00',
          action: 'taken',
          timestamp: now.getTime(),
        },
      ];

      expect(isReminderTakenToday(history, 'rem-1')).toBe(true);
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

      // Mock: last sweep was 3 days ago
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const lastSweepStr = threeDaysAgo.toISOString().split('T')[0];

      const result = recordMissedDoses([pill], lastSweepStr);

      // Should have missed entries for the 2 days between sweep and yesterday
      expect(result.hasChanges).toBe(true);
      const missedEntries = result.updatedPills[0].history?.filter(h => h.action === 'missed') || [];
      expect(missedEntries.length).toBe(2); // 2 days: day before yesterday and yesterday
    });

    it('does not record missed doses if already logged', () => {
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      const twoDaysAgoEnd = new Date(twoDaysAgo);
      twoDaysAgoEnd.setHours(23, 59, 59, 999);

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
            timestamp: twoDaysAgoEnd.getTime(),
          },
        ]
      );

      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const lastSweepStr = threeDaysAgo.toISOString().split('T')[0];

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
      const lastSweepStr = weekAgo.toISOString().split('T')[0];

      const result = recordMissedDoses([pill], lastSweepStr);

      // Count missed entries - should be approximately 5 (weekdays only)
      const missedEntries = result.updatedPills[0].history?.filter(h => h.action === 'missed') || [];
      
      // Verify all missed entries are for weekdays
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
      const yesterdayStr = yesterday.toISOString().split('T')[0];

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
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      const dayStart = new Date(today + 'T00:00:00').getTime();

      const history: HistoryEntry[] = [
        {
          id: '1',
          reminderId: 'rem-1',
          pillName: 'Test',
          time: '09:00',
          action: 'taken',
          timestamp: dayStart + 3600000, // 1am
        },
        {
          id: '2',
          reminderId: 'rem-1',
          pillName: 'Test',
          time: '09:00',
          action: 'taken',
          timestamp: dayStart + 7200000, // 2am
        },
      ];

      const result = removeLatestTakenEntry(history, 'rem-1');

      expect(result.length).toBe(1);
      expect(result[0].id).toBe('1'); // Only the earlier one remains
    });

    it('does not remove entries from other days', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

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
