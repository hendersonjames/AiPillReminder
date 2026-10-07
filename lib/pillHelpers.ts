// lib/pillHelpers.ts
// Helper functions for pill status derivation and missed dose handling

import type { Pill, Reminder, HistoryEntry } from '../types';
import { getDateString, getTodayDateString, parseLocalDateString } from './storage';

// ─── Derive "taken today" from history ────────────────────────────────────────
// Instead of storing a `taken` flag that can become stale,
// derive it from whether there's a 'taken' history entry for today

export const isReminderTakenOnDate = (
  history: HistoryEntry[],
  reminderId: string,
  dateStr: string
): boolean => {
  const targetDate = parseLocalDateString(dateStr);
  const dayStart = targetDate.getTime();
  const dayEnd = dayStart + 86400000 - 1;

  return history.some(
    h =>
      h.reminderId === reminderId &&
      h.action === 'taken' &&
      h.timestamp >= dayStart &&
      h.timestamp <= dayEnd
  );
};

export const isReminderTakenToday = (
  history: HistoryEntry[],
  reminderId: string
): boolean => {
  return isReminderTakenOnDate(history, reminderId, getTodayDateString());
};

// Get the effective "taken" status for a reminder
// This is the derived value based on history, not the stored flag
export const getReminderTakenStatus = (
  pill: Pill,
  reminder: Reminder
): boolean => {
  const history = pill.history || [];
  return isReminderTakenToday(history, reminder.id);
};

// ─── Multi-day missed dose sweep ──────────────────────────────────────────────
// Covers all days from lastSweepDate to yesterday (inclusive)

export interface MissedDoseResult {
  updatedPills: Pill[];
  hasChanges: boolean;
}

export const recordMissedDoses = (
  pills: Pill[],
  lastSweepDateStr: string | null
): MissedDoseResult => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  // Determine the start date for the sweep
  let sweepStartDate: Date;
  
  if (lastSweepDateStr) {
    // Start from the day after the last sweep
    sweepStartDate = parseLocalDateString(lastSweepDateStr);
    sweepStartDate.setDate(sweepStartDate.getDate() + 1);
  } else {
    // If never swept, just do yesterday
    sweepStartDate = yesterday;
  }
  
  // Don't sweep future dates or today
  if (sweepStartDate > yesterday) {
    return { updatedPills: pills, hasChanges: false };
  }

  let anyGlobalChanges = false;

  const updatedPills = pills.map(pill => {
    const newHistory = [...(pill.history || [])];
    let pillHasChanges = false;

    // Iterate through each day from sweepStartDate to yesterday
    const currentDate = new Date(sweepStartDate);
    while (currentDate <= yesterday) {
      const dayOfWeek = currentDate.getDay();
      const dateStr = getDateString(currentDate);
      const dayStart = currentDate.getTime();
      const dayEnd = dayStart + 86400000 - 1;

      pill.reminders.forEach(reminder => {
        if (!reminder.daysOfWeek.includes(dayOfWeek)) return;

        // Check if there's already a 'taken' or 'missed' entry for this day
        const alreadyLogged = newHistory.some(
          h =>
            h.reminderId === reminder.id &&
            h.timestamp >= dayStart &&
            h.timestamp <= dayEnd &&
            (h.action === 'taken' || h.action === 'missed')
        );

        if (!alreadyLogged) {
          newHistory.push({
            id: `missed-${dateStr}-${reminder.id}`,
            reminderId: reminder.id,
            pillName: pill.name,
            time: reminder.time,
            action: 'missed',
            timestamp: dayEnd, // End of that day
          });
          pillHasChanges = true;
          anyGlobalChanges = true;
        }
      });

      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return pillHasChanges ? { ...pill, history: newHistory } : pill;
  });

  return { updatedPills, hasChanges: anyGlobalChanges };
};

// ─── Remove stale history entry when un-marking taken ─────────────────────────
// When toggling from taken to not-taken, remove the most recent 'taken' entry for today

export const removeLatestTakenEntry = (
  history: HistoryEntry[],
  reminderId: string
): HistoryEntry[] => {
  const todayStr = getTodayDateString();
  const today = parseLocalDateString(todayStr);
  const dayStart = today.getTime();
  const dayEnd = dayStart + 86400000 - 1;

  // Find all taken entries for this reminder today
  const takenEntriesToday = history.filter(
    h =>
      h.reminderId === reminderId &&
      h.action === 'taken' &&
      h.timestamp >= dayStart &&
      h.timestamp <= dayEnd
  );

  if (takenEntriesToday.length === 0) return history;

  // Remove only the most recent one
  const latestEntry = takenEntriesToday.reduce((latest, current) =>
    current.timestamp > latest.timestamp ? current : latest
  );

  return history.filter(h => h.id !== latestEntry.id);
};

// ─── Pill enhancement: add derived taken status ───────────────────────────────
// This creates a view of the pill with the `taken` flag derived from history

export const enhancePillWithDerivedStatus = (pill: Pill): Pill => {
  const history = pill.history || [];
  
  return {
    ...pill,
    reminders: pill.reminders.map(reminder => ({
      ...reminder,
      taken: isReminderTakenToday(history, reminder.id),
    })),
  };
};

// Enhance all pills with derived taken status
export const enhancePillsWithDerivedStatus = (pills: Pill[]): Pill[] => {
  return pills.map(enhancePillWithDerivedStatus);
};
