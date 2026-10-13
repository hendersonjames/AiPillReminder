export interface Reminder {
  id: string;
  time: string; // "HH:MM" format
  daysOfWeek: number[]; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  taken: boolean;
  snoozedUntil?: number; // Timestamp for when the snooze expires
}

export interface HistoryEntry {
  id: string;
  reminderId: string;
  pillName: string;
  time: string; // The time of the reminder, e.g., "09:00"
  action: 'taken' | 'snoozed' | 'missed';
  timestamp: number; // The exact time the action occurred
}

export interface Pill {
  id: string;
  name: string;
  dosage: string;
  notes?: string;
  notificationSound?: string;
  reminders: Reminder[];
  history?: HistoryEntry[];
  createdAt?: number; // Timestamp when the pill was created (local device time)
  updatedAt?: number; // Timestamp of last local edit (for conflict resolution)
  deleted?: boolean;  // Soft-delete tombstone for multi-tab sync
}

// Outbox entry for offline/pending changes
export interface OutboxEntry {
  id: string;          // Same as pill ID
  type: 'upsert' | 'delete';
  pill?: Pill;         // Full pill for upsert, undefined for delete
  updatedAt: number;   // When this change was queued
  userId: string;      // Owner of this change
}

export enum MessageAuthor {
  USER = 'user',
  BOT = 'bot',
}

export interface ChatMessage {
  author: MessageAuthor;
  text: string;
}