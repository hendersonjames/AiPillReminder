// tests/appIntegration.test.ts
// Tests for App-level orchestration: tap queue and sweep-after-load
// These tests import the ACTUAL functions from lib/loadOrchestration.ts
// If you break those functions, these tests MUST fail.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  shouldQueueTap,
  filterTapsForUser,
  applyTakenMarkToPill,
  applyQueuedTapsToPills,
  shouldRunSweepAfterLoad,
  orchestrateAfterCloudLoad,
  type QueuedTap,
} from '../lib/loadOrchestration';
import { recordMissedDoses } from '../lib/pillHelpers';
import { getDateString } from '../lib/storage';
import type { Pill, HistoryEntry } from '../types';

// Helper to create pills for testing
const createTestPill = (
  id: string,
  name: string,
  createdAt?: number,
  history: HistoryEntry[] = []
): Pill => ({
  id,
  name,
  dosage: '500mg',
  reminders: [
    { id: 'r1', time: '09:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], taken: false },
  ],
  history,
  createdAt,
});

describe('loadOrchestration: Tap Queue', () => {
  describe('shouldQueueTap', () => {
    it('returns true when cloud load has not succeeded', () => {
      expect(shouldQueueTap(false)).toBe(true);
    });

    it('returns false when cloud load has succeeded', () => {
      expect(shouldQueueTap(true)).toBe(false);
    });
  });

  describe('filterTapsForUser', () => {
    it('filters taps to only those for the specified user', () => {
      const queue: QueuedTap[] = [
        { pillId: 'p1', reminderId: 'r1', userId: 'user-a' },
        { pillId: 'p2', reminderId: 'r1', userId: 'user-b' },
        { pillId: 'p3', reminderId: 'r1', userId: 'user-a' },
      ];

      const result = filterTapsForUser(queue, 'user-a');

      expect(result).toHaveLength(2);
      expect(result.every(tap => tap.userId === 'user-a')).toBe(true);
    });

    it('returns empty array when no taps match', () => {
      const queue: QueuedTap[] = [
        { pillId: 'p1', reminderId: 'r1', userId: 'user-a' },
      ];

      const result = filterTapsForUser(queue, 'user-b');

      expect(result).toHaveLength(0);
    });
  });

  describe('applyTakenMarkToPill', () => {
    it('adds taken history entry to pill', () => {
      const pill = createTestPill('p1', 'Test Pill');

      const result = applyTakenMarkToPill(pill, 'r1');

      expect(result.history).toHaveLength(1);
      expect(result.history![0].action).toBe('taken');
      expect(result.history![0].reminderId).toBe('r1');
    });

    it('returns unchanged pill if already taken today', () => {
      const now = Date.now();
      const pill = createTestPill('p1', 'Test Pill', undefined, [
        {
          id: 'existing',
          reminderId: 'r1',
          pillName: 'Test Pill',
          time: '09:00',
          action: 'taken',
          timestamp: now,
        },
      ]);

      const result = applyTakenMarkToPill(pill, 'r1');

      // Should not add duplicate
      expect(result.history).toHaveLength(1);
      expect(result).toBe(pill); // Same reference = unchanged
    });

    it('returns unchanged pill if reminder not found', () => {
      const pill = createTestPill('p1', 'Test Pill');

      const result = applyTakenMarkToPill(pill, 'non-existent-reminder');

      expect(result.history).toHaveLength(0);
      expect(result).toBe(pill);
    });
  });

  describe('applyQueuedTapsToPills', () => {
    it('applies taps to matching pills', () => {
      const pills = [
        createTestPill('p1', 'Pill 1'),
        createTestPill('p2', 'Pill 2'),
      ];
      const taps: QueuedTap[] = [
        { pillId: 'p1', reminderId: 'r1', userId: 'user-a' },
      ];

      const result = applyQueuedTapsToPills(pills, taps);

      expect(result[0].history).toHaveLength(1);
      expect(result[0].history![0].action).toBe('taken');
      expect(result[1].history).toHaveLength(0); // Unchanged
    });

    it('returns original pills if no taps', () => {
      const pills = [createTestPill('p1', 'Pill 1')];

      const result = applyQueuedTapsToPills(pills, []);

      expect(result).toBe(pills); // Same reference
    });

    it('ignores taps for non-existent pills', () => {
      const pills = [createTestPill('p1', 'Pill 1')];
      const taps: QueuedTap[] = [
        { pillId: 'non-existent', reminderId: 'r1', userId: 'user-a' },
      ];

      const result = applyQueuedTapsToPills(pills, taps);

      expect(result[0].history).toHaveLength(0);
    });
  });
});

describe('loadOrchestration: Sweep After Load', () => {
  describe('shouldRunSweepAfterLoad', () => {
    it('returns shouldSweep=true when not swept today', () => {
      const result = shouldRunSweepAfterLoad('2024-01-14', '2024-01-15', 1);

      expect(result.shouldSweep).toBe(true);
      expect(result.reason).toBe('sweep needed');
    });

    it('returns shouldSweep=false when already swept today', () => {
      const result = shouldRunSweepAfterLoad('2024-01-15', '2024-01-15', 1);

      expect(result.shouldSweep).toBe(false);
      expect(result.reason).toBe('already swept today');
    });

    it('returns shouldSweep=false when no pills', () => {
      const result = shouldRunSweepAfterLoad('2024-01-14', '2024-01-15', 0);

      expect(result.shouldSweep).toBe(false);
      expect(result.reason).toBe('no pills');
    });
  });

  describe('orchestrateAfterCloudLoad', () => {
    it('runs sweep and applies taps in correct order', () => {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const pill = createTestPill('p1', 'Old Pill', weekAgo.getTime());

      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const lastSweep = getDateString(threeDaysAgo);

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = getDateString(yesterday);

      const queuedTaps: QueuedTap[] = [
        { pillId: 'p1', reminderId: 'r1', userId: 'user-a' },
      ];

      const result = orchestrateAfterCloudLoad(
        [pill],
        lastSweep,
        yesterdayStr,
        queuedTaps,
        'user-a',
        recordMissedDoses
      );

      // Sweep should have run
      expect(result.sweepRan).toBe(true);

      // Tap should have been applied
      expect(result.tapsApplied).toBe(1);

      // Pill should have both missed entries and taken entry
      const history = result.pills[0].history || [];
      const missedEntries = history.filter(h => h.action === 'missed');
      const takenEntries = history.filter(h => h.action === 'taken');

      expect(missedEntries.length).toBeGreaterThan(0);
      expect(takenEntries.length).toBe(1);
    });

    it('skips sweep when already done today', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = getDateString(yesterday);

      const pill = createTestPill('p1', 'Pill');

      const result = orchestrateAfterCloudLoad(
        [pill],
        yesterdayStr, // Already swept
        yesterdayStr,
        [],
        'user-a',
        recordMissedDoses
      );

      expect(result.sweepRan).toBe(false);
    });

    it('filters taps by user ID', () => {
      const pill = createTestPill('p1', 'Pill');
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = getDateString(yesterday);

      const queuedTaps: QueuedTap[] = [
        { pillId: 'p1', reminderId: 'r1', userId: 'user-a' },
        { pillId: 'p1', reminderId: 'r1', userId: 'user-b' }, // Different user
      ];

      const result = orchestrateAfterCloudLoad(
        [pill],
        yesterdayStr,
        yesterdayStr,
        queuedTaps,
        'user-a', // Only apply taps for user-a
        recordMissedDoses
      );

      // Only 1 tap applied (user-a's tap)
      expect(result.tapsApplied).toBe(1);
    });

    it('returns changedPillIds for pills modified by sweep (H3 fix)', () => {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const pill = createTestPill('p1', 'Old Pill', weekAgo.getTime());

      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const lastSweep = getDateString(threeDaysAgo);

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = getDateString(yesterday);

      const result = orchestrateAfterCloudLoad(
        [pill],
        lastSweep,
        yesterdayStr,
        [], // No taps
        'user-a',
        recordMissedDoses
      );

      // Sweep ran and changed the pill
      expect(result.sweepRan).toBe(true);
      expect(result.changedPillIds.has('p1')).toBe(true);
    });

    it('returns changedPillIds for pills modified by taps', () => {
      const pill = createTestPill('p1', 'Pill');
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = getDateString(yesterday);

      const queuedTaps: QueuedTap[] = [
        { pillId: 'p1', reminderId: 'r1', userId: 'user-a' },
      ];

      const result = orchestrateAfterCloudLoad(
        [pill],
        yesterdayStr, // Already swept
        yesterdayStr,
        queuedTaps,
        'user-a',
        recordMissedDoses
      );

      expect(result.changedPillIds.has('p1')).toBe(true);
    });

    it('does not include unchanged pills in changedPillIds', () => {
      const pill1 = createTestPill('p1', 'Pill 1');
      const pill2 = createTestPill('p2', 'Pill 2');
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = getDateString(yesterday);

      const queuedTaps: QueuedTap[] = [
        { pillId: 'p1', reminderId: 'r1', userId: 'user-a' }, // Only tap p1
      ];

      const result = orchestrateAfterCloudLoad(
        [pill1, pill2],
        yesterdayStr, // Already swept
        yesterdayStr,
        queuedTaps,
        'user-a',
        recordMissedDoses
      );

      expect(result.changedPillIds.has('p1')).toBe(true);
      expect(result.changedPillIds.has('p2')).toBe(false);
    });
  });
});

describe('Missed Dose Sweep: createdAt fallback', () => {
  it('falls back to numeric id as creation timestamp (pre-build pills)', () => {
    // Pill with timestamp-based ID but no createdAt (legacy pill)
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    twoDaysAgo.setHours(12, 0, 0, 0);

    const legacyPill: Pill = {
      id: twoDaysAgo.getTime().toString(), // Numeric timestamp as ID
      name: 'Legacy Pill',
      dosage: '500mg',
      reminders: [
        { id: 'r1', time: '09:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], taken: false },
      ],
      history: [],
      // No createdAt field
    };

    // Sweep from a week ago
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const lastSweepStr = getDateString(weekAgo);

    const result = recordMissedDoses([legacyPill], lastSweepStr);

    // Should only have 1 missed entry (yesterday)
    // Because the pill's ID timestamp indicates it was created 2 days ago
    // So we can only miss starting the day after (1 day ago = yesterday)
    const missedEntries = result.updatedPills[0].history?.filter(h => h.action === 'missed') || [];
    expect(missedEntries.length).toBe(1);
  });

  it('does not use non-numeric id as fallback', () => {
    // Pill with non-numeric ID and no createdAt
    const pillWithStringId: Pill = {
      id: 'abc-123', // Not a numeric timestamp
      name: 'String ID Pill',
      dosage: '500mg',
      reminders: [
        { id: 'r1', time: '09:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], taken: false },
      ],
      history: [],
    };

    // Sweep from 3 days ago
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const lastSweepStr = getDateString(threeDaysAgo);

    const result = recordMissedDoses([pillWithStringId], lastSweepStr);

    // Should have missed entries for all days (no createdAt protection)
    const missedEntries = result.updatedPills[0].history?.filter(h => h.action === 'missed') || [];
    expect(missedEntries.length).toBe(2); // 2 days ago and yesterday
  });
});
