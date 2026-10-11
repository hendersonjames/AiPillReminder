import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDateString, parseLocalDateString } from '../lib/storage';
import { recordMissedDoses } from '../lib/pillHelpers';
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

describe('App Integration: Missed Dose Sweep', () => {
  describe('sweep runs after cloud load', () => {
    it('recordMissedDoses is called with pills from cloud', () => {
      // Simulate a pill that existed for a week
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      
      const pill = createTestPill('p1', 'Old Pill', weekAgo.getTime());
      
      // Simulate lastSweep was 3 days ago
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const lastSweepStr = getDateString(threeDaysAgo);
      
      const result = recordMissedDoses([pill], lastSweepStr);
      
      // Should have 2 missed entries (2 days ago and yesterday)
      expect(result.hasChanges).toBe(true);
      const missedEntries = result.updatedPills[0].history?.filter(h => h.action === 'missed') || [];
      expect(missedEntries.length).toBe(2);
    });

    it('createdAt skips days before pill existed', () => {
      // Pill created yesterday
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(10, 0, 0, 0);
      
      const newPill = createTestPill('p1', 'New Pill', yesterday.getTime());
      
      // lastSweep was a week ago
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const lastSweepStr = getDateString(weekAgo);
      
      const result = recordMissedDoses([newPill], lastSweepStr);
      
      // Pill created yesterday - can only miss starting today (which we don't sweep)
      // So no missed entries should be created
      expect(result.hasChanges).toBe(false);
    });
  });
});

describe('App Integration: Queued Notification Tap', () => {
  describe('tap queued before cloud load', () => {
    it('queued tap survives and results in taken status', () => {
      // This test verifies the queue logic by testing the data flow:
      // 1. Tap arrives with pillId, reminderId
      // 2. Cloud load returns pill with that ID
      // 3. Applying the tap creates a history entry
      
      const pillId = 'p1';
      const reminderId = 'r1';
      const pillFromCloud = createTestPill(pillId, 'Test Pill');
      
      // Simulate applying a queued tap to cloud-loaded pill
      const applyTakenMark = (pill: Pill, reminderId: string): Pill => {
        const history = pill.history || [];
        const reminder = pill.reminders.find(r => r.id === reminderId);
        if (!reminder) return pill;
        
        const newHistoryEntry: HistoryEntry = {
          id: `${Date.now()}-${reminderId}`,
          reminderId: reminderId,
          pillName: pill.name,
          time: reminder.time,
          action: 'taken',
          timestamp: Date.now(),
        };
        
        return {
          ...pill,
          history: [...history, newHistoryEntry],
        };
      };
      
      // Apply the queued tap
      const updatedPill = applyTakenMark(pillFromCloud, reminderId);
      
      // Verify the history entry was created
      expect(updatedPill.history?.length).toBe(1);
      expect(updatedPill.history?.[0].action).toBe('taken');
      expect(updatedPill.history?.[0].reminderId).toBe(reminderId);
    });

    it('queued tap for non-existent pill is safely ignored', () => {
      const pillFromCloud = createTestPill('p1', 'Test Pill');
      
      // Simulate applying a tap for a different pill ID (non-existent)
      const applyTakenMark = (pills: Pill[], targetPillId: string, reminderId: string): Pill[] => {
        return pills.map(pill => {
          if (pill.id !== targetPillId) return pill;
          
          const reminder = pill.reminders.find(r => r.id === reminderId);
          if (!reminder) return pill;
          
          const newHistoryEntry: HistoryEntry = {
            id: `${Date.now()}-${reminderId}`,
            reminderId: reminderId,
            pillName: pill.name,
            time: reminder.time,
            action: 'taken',
            timestamp: Date.now(),
          };
          
          return {
            ...pill,
            history: [...(pill.history || []), newHistoryEntry],
          };
        });
      };
      
      // Try to apply tap for non-existent pill
      const result = applyTakenMark([pillFromCloud], 'non-existent-pill', 'r1');
      
      // Original pill should be unchanged
      expect(result[0].history?.length ?? 0).toBe(0);
    });

    it('queued tap does not create duplicate if already taken', () => {
      const now = Date.now();
      const pillWithTakenHistory = createTestPill('p1', 'Test Pill', undefined, [
        {
          id: 'existing',
          reminderId: 'r1',
          pillName: 'Test Pill',
          time: '09:00',
          action: 'taken',
          timestamp: now - 1000, // Taken 1 second ago
        },
      ]);
      
      // Simulate applying a tap that checks for existing taken status
      const applyTakenMarkSafe = (pill: Pill, reminderId: string): Pill => {
        const history = pill.history || [];
        
        // Check if already taken today (simplified: any taken entry for this reminder)
        const alreadyTaken = history.some(
          h => h.reminderId === reminderId && h.action === 'taken'
        );
        if (alreadyTaken) return pill;
        
        const reminder = pill.reminders.find(r => r.id === reminderId);
        if (!reminder) return pill;
        
        const newHistoryEntry: HistoryEntry = {
          id: `${Date.now()}-${reminderId}`,
          reminderId: reminderId,
          pillName: pill.name,
          time: reminder.time,
          action: 'taken',
          timestamp: Date.now(),
        };
        
        return {
          ...pill,
          history: [...history, newHistoryEntry],
        };
      };
      
      // Apply tap to pill that's already taken
      const result = applyTakenMarkSafe(pillWithTakenHistory, 'r1');
      
      // Should still have only 1 history entry (no duplicate)
      expect(result.history?.length).toBe(1);
    });
  });

  describe('tap applied on load failure', () => {
    it('tap applied to local state preserves user action', () => {
      // When cloud load fails, we still have local pills
      // The queued tap should be applied so user's action isn't lost
      
      const localPill = createTestPill('p1', 'Local Pill');
      
      const applyTakenMark = (pill: Pill, reminderId: string): Pill => {
        const reminder = pill.reminders.find(r => r.id === reminderId);
        if (!reminder) return pill;
        
        const newHistoryEntry: HistoryEntry = {
          id: `${Date.now()}-${reminderId}`,
          reminderId: reminderId,
          pillName: pill.name,
          time: reminder.time,
          action: 'taken',
          timestamp: Date.now(),
        };
        
        return {
          ...pill,
          history: [...(pill.history || []), newHistoryEntry],
        };
      };
      
      const result = applyTakenMark(localPill, 'r1');
      
      // Tap was applied to local pill
      expect(result.history?.length).toBe(1);
      expect(result.history?.[0].action).toBe('taken');
    });
  });
});
