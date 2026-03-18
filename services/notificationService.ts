// services/notificationService.ts
//
// Unified notification service — works on both web and native (Capacitor).
//
// On native (iOS/Android via Capacitor):
//   - Uses @capacitor/local-notifications for proper OS-level notifications
//   - Works when app is closed, screen is off, phone is locked
//   - Uses @capacitor/haptics for vibration feedback
//
// On web:
//   - Falls back to Browser Notification API + Web Audio
//   - Only works while the browser tab is open
//
// Usage:
//   import { scheduleReminderNotifications, cancelReminderNotifications, fireImmediateNotification } from './notificationService';

import { Capacitor } from '@capacitor/core';
import { playSound } from './soundService';

// ─── Platform detection ───────────────────────────────────────────────────────

export const isNative = () => Capacitor.isNativePlatform();

// ─── Lazy-load Capacitor plugins (only on native) ────────────────────────────

let LocalNotifications: any = null;
let Haptics: any = null;

const loadNativePlugins = async () => {
  if (!isNative()) return;
  if (!LocalNotifications) {
    const ln = await import('@capacitor/local-notifications');
    LocalNotifications = ln.LocalNotifications;
  }
  if (!Haptics) {
    const hap = await import('@capacitor/haptics');
    Haptics = hap.Haptics;
  }
};

// ─── Permission request ───────────────────────────────────────────────────────

export const requestNotificationPermission = async (): Promise<boolean> => {
  if (isNative()) {
    await loadNativePlugins();
    try {
      const { display } = await LocalNotifications.requestPermissions();
      return display === 'granted';
    } catch {
      return false;
    }
  } else {
    // Web fallback
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const result = await Notification.requestPermission();
    return result === 'granted';
  }
};

export const getNotificationPermission = async (): Promise<'granted' | 'denied' | 'prompt'> => {
  if (isNative()) {
    await loadNativePlugins();
    try {
      const { display } = await LocalNotifications.checkPermissions();
      if (display === 'granted') return 'granted';
      if (display === 'denied') return 'denied';
      return 'prompt';
    } catch {
      return 'prompt';
    }
  } else {
    if (!('Notification' in window)) return 'denied';
    return Notification.permission as 'granted' | 'denied' | 'prompt';
  }
};

// ─── Fire an immediate notification (alarm fired / snooze expired) ───────────

export const fireImmediateNotification = async (
  title: string,
  body: string,
  soundId?: string
) => {
  if (isNative()) {
    await loadNativePlugins();
    try {
      // Haptic feedback
      await Haptics.vibrate();
      // Native notification
      await LocalNotifications.schedule({
        notifications: [
          {
            id: Math.floor(Math.random() * 100000),
            title,
            body,
            sound: 'default',
            extra: { type: 'immediate' },
          },
        ],
      });
    } catch (err) {
      console.warn('Native notification failed:', err);
    }
  } else {
    // Web fallback: sound + browser notification
    playSound(soundId);
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body,
          icon: '/favicon.ico',
          tag: title,
          renotify: true,
        });
      } catch (err) {
        console.warn('Browser notification failed:', err);
      }
    }
  }
};

// ─── Notification ID generation ───────────────────────────────────────────────
// Each reminder+day combination gets a stable numeric ID.
// Capacitor local notification IDs must be positive integers.
// We derive them from the pillId + reminderId + dayOfWeek.
//
// Formula: hash the reminder ID string into a number, add dayOfWeek offset.
// Keeps IDs stable across app restarts so we can cancel them.

const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit int
  }
  return Math.abs(hash) % 1000000; // Keep under 1M to avoid collisions
};

const getNotificationId = (pillId: string, reminderId: string, dayOfWeek: number): number => {
  const base = hashString(`${pillId}-${reminderId}`);
  return base * 10 + dayOfWeek; // unique per day
};

// ─── Schedule recurring notifications for a reminder ─────────────────────────
//
// Called when a pill is saved or edited.
// Schedules one recurring notification per selected day of week.

export const scheduleReminderNotifications = async (
  pillId: string,
  pillName: string,
  dosage: string,
  reminderId: string,
  timeString: string, // "HH:MM" format
  daysOfWeek: number[], // 0=Sunday .. 6=Saturday
) => {
  if (!isNative()) return; // Web handles alarms via setInterval in App.tsx

  await loadNativePlugins();

  const [hourStr, minuteStr] = timeString.split(':');
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);

  const notifications = daysOfWeek.map(day => ({
    id: getNotificationId(pillId, reminderId, day),
    title: `💊 Time for ${pillName}`,
    body: dosage ? `${dosage} — open Remedi to mark as taken` : 'Open Remedi to mark as taken',
    sound: 'default',
    schedule: {
      on: {
        weekday: day + 1, // Capacitor weekday: 1=Sunday .. 7=Saturday
        hour,
        minute,
      },
      allowWhileIdle: true,
    },
    extra: { pillId, reminderId, type: 'reminder' },
    actionTypeId: 'PILL_REMINDER',
  }));

  try {
    await LocalNotifications.schedule({ notifications });
    console.log(`Scheduled ${notifications.length} notifications for ${pillName} reminder ${reminderId}`);
  } catch (err) {
    console.warn('Failed to schedule notifications:', err);
  }
};

// ─── Cancel notifications for a specific reminder ─────────────────────────────
//
// Called when a reminder is deleted or its schedule changes.

export const cancelReminderNotifications = async (
  pillId: string,
  reminderId: string,
  daysOfWeek: number[]
) => {
  if (!isNative()) return;

  await loadNativePlugins();

  const notifications = daysOfWeek.map(day => ({
    id: getNotificationId(pillId, reminderId, day),
  }));

  try {
    await LocalNotifications.cancel({ notifications });
  } catch (err) {
    console.warn('Failed to cancel notifications:', err);
  }
};

// ─── Cancel ALL notifications for a pill (e.g. pill deleted) ─────────────────

export const cancelAllPillNotifications = async (
  pillId: string,
  reminders: Array<{ id: string; daysOfWeek: number[] }>
) => {
  if (!isNative()) return;
  for (const reminder of reminders) {
    await cancelReminderNotifications(pillId, reminder.id, reminder.daysOfWeek);
  }
};

// ─── Register notification action handlers ────────────────────────────────────
//
// Set up listeners for when a user taps a notification.
// Call this once at app startup.

export const registerNotificationListeners = async (
  onReminderTapped: (pillId: string, reminderId: string) => void
) => {
  if (!isNative()) return;

  await loadNativePlugins();

  // User tapped a notification while app was in background/closed
  await LocalNotifications.addListener(
    'localNotificationActionPerformed',
    (action: any) => {
      const extra = action?.notification?.extra;
      if (extra?.type === 'reminder' && extra?.pillId && extra?.reminderId) {
        onReminderTapped(extra.pillId, extra.reminderId);
      }
    }
  );
};
