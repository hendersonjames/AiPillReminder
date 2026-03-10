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
  action: 'taken' | 'snoozed';
  timestamp: number; // The exact time the action occurred
}

export interface Pill {
  id:string;
  name: string;
  dosage: string;
  notes?: string;
  notificationSound?: string;
  reminders: Reminder[];
  history?: HistoryEntry[];
}

export enum MessageAuthor {
  USER = 'user',
  BOT = 'bot',
}

export interface ChatMessage {
  author: MessageAuthor;
  text: string;
}