// lib/loadOrchestration.ts
// Pure functions for cloud load orchestration: tap queue and sweep-after-load
// Extracted from App.tsx so they can be unit tested

import type { Pill, HistoryEntry } from '../types';
import { isReminderTakenToday } from './pillHelpers';

// ─── Notification Tap Queue ───────────────────────────────────────────────────

export interface QueuedTap {
  pillId: string;
  reminderId: string;
  userId: string;
}

/**
 * Determines whether a tap should be queued (cloud load not complete)
 * or applied immediately.
 */
export const shouldQueueTap = (cloudLoadSucceeded: boolean): boolean => {
  return !cloudLoadSucceeded;
};

/**
 * Filters queued taps to only those for the specified user.
 * Used when applying queued taps after load completes.
 */
export const filterTapsForUser = (queue: QueuedTap[], userId: string): QueuedTap[] => {
  return queue.filter(tap => tap.userId === userId);
};

/**
 * Applies a taken mark to a pill's history.
 * Returns the updated pill, or the original if already taken or reminder not found.
 * This is the pure logic that App.tsx calls.
 */
export const applyTakenMarkToPill = (
  pill: Pill,
  reminderId: string
): Pill => {
  const history = pill.history || [];
  const alreadyTaken = isReminderTakenToday(history, reminderId);
  
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
  
  const updatedReminders = pill.reminders.map(r =>
    r.id === reminderId ? { ...r, snoozedUntil: undefined, taken: true } : r
  );
  
  return {
    ...pill,
    reminders: updatedReminders,
    history: [...history, newHistoryEntry],
  };
};

/**
 * Applies queued taps to a list of pills.
 * Returns the updated pills array.
 */
export const applyQueuedTapsToPills = (
  pills: Pill[],
  queuedTaps: QueuedTap[]
): Pill[] => {
  if (queuedTaps.length === 0) return pills;
  
  return pills.map(pill => {
    const tapsForPill = queuedTaps.filter(tap => tap.pillId === pill.id);
    if (tapsForPill.length === 0) return pill;
    
    // Apply each tap in sequence
    return tapsForPill.reduce(
      (currentPill, tap) => applyTakenMarkToPill(currentPill, tap.reminderId),
      pill
    );
  });
};

// ─── Sweep-After-Load Orchestration ───────────────────────────────────────────

export interface SweepDecision {
  shouldSweep: boolean;
  reason: string;
}

/**
 * Determines whether a missed-dose sweep should run after cloud load.
 * Returns decision with reason for testability.
 */
export const shouldRunSweepAfterLoad = (
  lastSweepDateStr: string | null,
  yesterdayStr: string,
  pillCount: number
): SweepDecision => {
  if (pillCount === 0) {
    return { shouldSweep: false, reason: 'no pills' };
  }
  
  if (lastSweepDateStr === yesterdayStr) {
    return { shouldSweep: false, reason: 'already swept today' };
  }
  
  return { shouldSweep: true, reason: 'sweep needed' };
};

/**
 * Full orchestration: given cloud-loaded pills, last sweep date, and queued taps,
 * returns the final pills state after sweep and tap application.
 * 
 * This is the core logic that App.tsx's loadCloud effect uses.
 */
export interface LoadOrchestrationResult {
  pills: Pill[];
  sweepRan: boolean;
  tapsApplied: number;
  /** IDs of pills that were modified by sweep or taps and need to be marked dirty */
  changedPillIds: Set<string>;
}

export const orchestrateAfterCloudLoad = (
  cloudPills: Pill[],
  lastSweepDateStr: string | null,
  yesterdayStr: string,
  queuedTaps: QueuedTap[],
  userId: string,
  runSweep: (pills: Pill[], lastSweep: string | null) => { updatedPills: Pill[]; hasChanges: boolean }
): LoadOrchestrationResult => {
  const changedPillIds = new Set<string>();
  
  // 1. Run sweep if needed
  let pillsAfterSweep = cloudPills;
  let sweepRan = false;
  
  const sweepDecision = shouldRunSweepAfterLoad(lastSweepDateStr, yesterdayStr, cloudPills.length);
  if (sweepDecision.shouldSweep) {
    const { updatedPills, hasChanges } = runSweep(cloudPills, lastSweepDateStr);
    if (hasChanges) {
      // Track which pills were changed by the sweep
      for (let i = 0; i < cloudPills.length; i++) {
        if (updatedPills[i] !== cloudPills[i]) {
          changedPillIds.add(updatedPills[i].id);
        }
      }
      pillsAfterSweep = updatedPills;
    }
    sweepRan = true;
  }
  
  // 2. Filter and apply queued taps
  const tapsForUser = filterTapsForUser(queuedTaps, userId);
  
  // Track which pills will have taps applied
  tapsForUser.forEach(tap => {
    if (pillsAfterSweep.some(p => p.id === tap.pillId)) {
      changedPillIds.add(tap.pillId);
    }
  });
  
  const finalPills = applyQueuedTapsToPills(pillsAfterSweep, tapsForUser);
  
  return {
    pills: finalPills,
    sweepRan,
    tapsApplied: tapsForUser.length,
    changedPillIds,
  };
};
