import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Pill, HistoryEntry } from './types';
import Header from './components/Header';
import PillList from './components/PillList';
import AddPillModal from './components/AddPillModal';
import ChatModal from './components/ChatModal';
import Auth from './components/Auth';
import ResetPassword from './components/ResetPassword';
import DoctorReport from './components/DoctorReport';
import { ChatIcon, PlusIcon } from './components/icons/Icons';
import { playSound } from './services/soundService';
import { onAuthStateChange, signOut, cleanupUserData, type User } from './services/authService';
import { loadPillsFromCloud } from './services/pillsService';
import {
  requestNotificationPermission,
  fireImmediateNotification,
  scheduleReminderNotifications,
  cancelAllPillNotifications,
  cancelAllScheduledNotifications,
  scheduleAllPillNotifications,
  registerNotificationListeners,
  isNative,
  type NotificationListenerHandle,
} from './services/notificationService';
import {
  loadPillsFromStorage,
  loadCloudIdsFromStorage,
  saveCloudIdsToStorage,
  purgeLegacyUnscopedData,
} from './lib/storage';
import {
  hasUnsyncedChanges,
  getSyncChannelName,
  isValidSyncMessage,
  createSyncMessage,
} from './lib/syncEngine';
import { useSyncEngine } from './lib/useSyncEngine';
import {
  isReminderTakenToday,
  removeLatestTakenEntry,
  enhancePillsWithDerivedStatus,
} from './lib/pillHelpers';

// Purge legacy unscoped data at module load, BEFORE auth
// This prevents data from old versions being shown to any user
purgeLegacyUnscopedData();

// ─── Web-only Notification helpers (used when not running natively) ───────────

const requestWebNotificationPermission = async () => {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
};

const showWebNotification = (title: string, body: string) => {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification(title, {
      body,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: title,
      renotify: true,
    });
  } catch (err) {
    console.warn('Notification failed:', err);
  }
};

// ─── App (auth wrapper) ───────────────────────────────────────────────────────

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  
  // Track previous user ID to detect user switches
  const prevUserIdRef = useRef<string | null>(null);
  // Flag to block writes during sign-out (shared with SignedInApp)
  const signingOutRef = useRef(false);
  // Flush callback from SignedInApp
  const flushCallbackRef = useRef<(() => Promise<void>) | null>(null);

  // ─── Auth listener ──────────────────────────────────────────────────────────
  useEffect(() => {
    const { data: { subscription } } = onAuthStateChange(async (currentUser, event) => {
      const currentUserId = currentUser?.id ?? null;
      const prevUserId = prevUserIdRef.current;
      
      // Detect password recovery flow (user clicked reset link from email)
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
        prevUserIdRef.current = currentUserId;
        setUserId(currentUserId);
        setUser(currentUser);
        setAuthLoading(false);
        return;
      }
      
      // Handle sign-out from ANY source (button, expiry, another tab, revocation)
      if (event === 'SIGNED_OUT') {
        // Clear previous user's data if we know who they were
        if (prevUserId) {
          await cleanupUserData(prevUserId);
        }
        signingOutRef.current = false;
        prevUserIdRef.current = null;
        setUserId(null);
        setUser(null);
        setAuthLoading(false);
        return;
      }
      
      // Ignore TOKEN_REFRESHED and USER_UPDATED - they don't change the user ID
      // This prevents dropping unsynced edits on hourly token refresh
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        return;
      }
      
      // Detect user change (direct switch without SIGNED_OUT)
      // This can happen via cross-tab sign-in, OAuth redirect, etc.
      if (prevUserId && currentUserId && prevUserId !== currentUserId) {
        // Clean up previous user's data before loading new user
        await cleanupUserData(prevUserId);
      }
      
      prevUserIdRef.current = currentUserId;
      setUserId(currentUserId);
      setUser(currentUser);
      setAuthLoading(false);
      
      if (currentUser && !isPasswordRecovery) {
        // Request notification permission — native or web
        await requestNotificationPermission();
        if (!isNative()) await requestWebNotificationPermission();
      }
    });
    return () => subscription.unsubscribe();
  }, [isPasswordRecovery]);

  const handleSignOut = useCallback(async () => {
    const currentUserId = prevUserIdRef.current;
    
    // Check for unsynced changes before sign-out
    if (currentUserId && hasUnsyncedChanges(currentUserId)) {
      // Try to flush first
      const flushCallback = flushCallbackRef.current;
      if (flushCallback) {
        const flushed = await flushCallback();
        if (!flushed) {
          // Warn user about potential data loss
          const confirmed = window.confirm(
            'You have unsynced changes that could not be saved. ' +
            'If you sign out now, these changes may be lost. Continue?'
          );
          if (!confirmed) {
            return;
          }
        }
      }
    }
    
    signingOutRef.current = true;
    setSignOutError(null);
    
    // Pass flush callback to signOut so it can save pending edits BEFORE clearing
    const result = await signOut(
      currentUserId ?? undefined,
      flushCallbackRef.current ?? undefined
    );
    
    if (!result.success) {
      setSignOutError(result.error ?? 'Sign out failed');
      // Keep signingOutRef true to block writes
    } else if (result.localOnly && result.error) {
      // Partial success - show warning
      setSignOutError(result.error);
    }
    
    // Hard reload if required (ensures clean state after offline sign-out)
    if (result.requiresReload) {
      window.location.reload();
      return;
    }
    
    // On normal success, SIGNED_OUT event will handle the rest
    if (result.success && !result.localOnly) {
      signingOutRef.current = false;
    }
  }, []);

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (authLoading) {
    return (
      <div className="min-h-screen bg-sky-100 flex items-center justify-center">
        <div className="text-slate-500">Loading...</div>
      </div>
    );
  }

  // Show password reset screen when user clicked recovery link from email
  if (isPasswordRecovery && user) {
    return <ResetPassword onComplete={() => setIsPasswordRecovery(false)} />;
  }

  if (!user || !userId) return <Auth />;

  // Key by userId to ensure all state is reset when user changes (S2)
  return (
    <SignedInApp
      key={userId}
      user={user}
      userId={userId}
      signingOutRef={signingOutRef}
      flushCallbackRef={flushCallbackRef}
      signOutError={signOutError}
      onSignOut={handleSignOut}
      onClearError={() => setSignOutError(null)}
    />
  );
};

// ─── SignedInApp (keyed by userId for isolation) ──────────────────────────────

interface SignedInAppProps {
  user: User;
  userId: string;
  signingOutRef: React.MutableRefObject<boolean>;
  flushCallbackRef: React.MutableRefObject<(() => Promise<void>) | null>;
  signOutError: string | null;
  onSignOut: () => void;
  onClearError: () => void;
}

const SignedInApp: React.FC<SignedInAppProps> = ({
  user,
  userId,
  signingOutRef,
  flushCallbackRef,
  signOutError,
  onSignOut,
  onClearError,
}) => {
  const [notifDismissed, setNotifDismissed] = useState(false);
  const [idGenError, setIdGenError] = useState<string | null>(null);
  
  // Track if last reload was triggered by BroadcastChannel (prevents ping-pong)
  const reloadTriggeredByChannelRef = useRef(false);
  
  // Single BroadcastChannel instance owned by this component for both send & receive
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  
  // Debounce timer for notification rescheduling (L-a fix)
  const notifRescheduleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // ─── Use sync engine hook for core sync wiring ──────────────────────────────
  const { state, actions } = useSyncEngine({
    userId,
    loadPillsFromCloud,
    signingOutRef, // Pass ref directly for live reads (N8 fix)
    onPillsChange: (newPills) => {
      // L-a fix: debounce notification rescheduling ~500ms
      if (isNative()) {
        if (notifRescheduleTimerRef.current) {
          clearTimeout(notifRescheduleTimerRef.current);
        }
        notifRescheduleTimerRef.current = setTimeout(() => {
          cancelAllScheduledNotifications().then(() => {
            scheduleAllPillNotifications(newPills);
          });
          notifRescheduleTimerRef.current = null;
        }, 500);
      }
      // Broadcast to other tabs ONLY if not triggered by channel message
      // Note: We send pills_loaded without pill data since storage is already written
      if (!reloadTriggeredByChannelRef.current && broadcastChannelRef.current) {
        broadcastChannelRef.current.postMessage(createSyncMessage('pills_loaded', userId));
      }
      reloadTriggeredByChannelRef.current = false;
    },
  });
  
  const { pills, syncStatus } = state;
  const { markDirty, markReminderTaken, flushSync, hasUnsynced, setPills } = actions;
  
  const pillsRef = useRef<Pill[]>([]);
  const cloudIdsRef = useRef<Set<string>>(new Set());
  const notifListenerRef = useRef<NotificationListenerHandle | null>(null);

  // UI state - all reset per-user due to key={userId} remount
  const [isAddPillModalOpen, setAddPillModalOpen] = useState(false);
  const [isChatModalOpen, setChatModalOpen] = useState(false);
  const [isReportOpen, setReportOpen] = useState(false);
  const [pillToEdit, setPillToEdit] = useState<Pill | undefined>(undefined);

  // Keep ref in sync
  useEffect(() => { pillsRef.current = pills; }, [pills]);
  
  // Update cloud IDs when pills change
  useEffect(() => {
    const newCloudIds = new Set<string>(pills.filter(p => !p.deleted).map(p => p.id));
    cloudIdsRef.current = newCloudIds;
    saveCloudIdsToStorage(userId, newCloudIds);
  }, [pills, userId]);

  // ─── Register notification listener inside SignedInApp (B2 fix) ─────────────
  useEffect(() => {
    const setupListener = async () => {
      if (isNative()) {
        notifListenerRef.current = await registerNotificationListeners(markReminderTaken);
      }
    };
    setupListener();
    
    return () => {
      if (notifListenerRef.current) {
        notifListenerRef.current.remove();
        notifListenerRef.current = null;
      }
    };
  }, [markReminderTaken]);

  // ─── Multi-tab coordination via BroadcastChannel ────────────────────────────
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    
    const channel = new BroadcastChannel(getSyncChannelName(userId));
    broadcastChannelRef.current = channel;
    
    channel.onmessage = (event) => {
      // Validate message shape
      if (!isValidSyncMessage(event.data)) return;
      const msg = event.data;
      if (msg.userId !== userId) return;
      
      if (msg.type === 'pill_changed' && msg.pillId) {
        // Set ping-pong flag BEFORE setPills to prevent re-broadcast
        reloadTriggeredByChannelRef.current = true;
        // Use pill from message if available (avoids race with storage)
        if (msg.pill) {
          setPills(prevPills => {
            const exists = prevPills.some(p => p.id === msg.pillId);
            if (exists) {
              return prevPills.map(p => p.id === msg.pillId ? msg.pill! : p);
            } else {
              return [...prevPills, msg.pill!];
            }
          });
        } else {
          // Fallback to storage read
          const refreshedPills = loadPillsFromStorage(userId);
          setPills(enhancePillsWithDerivedStatus(refreshedPills));
        }
      } else if (msg.type === 'pill_deleted' && msg.pillId) {
        reloadTriggeredByChannelRef.current = true;
        setPills(prevPills => prevPills.filter(p => p.id !== msg.pillId));
      } else if (msg.type === 'pills_loaded') {
        reloadTriggeredByChannelRef.current = true;
        const refreshedPills = loadPillsFromStorage(userId);
        setPills(enhancePillsWithDerivedStatus(refreshedPills));
      }
    };
    
    return () => {
      broadcastChannelRef.current = null;
      channel.close();
    };
  }, [userId, setPills]);

  // ─── Flush pending sync wrapper for sign-out ────────────────────────────────
  const flushPendingSync = useCallback(async (): Promise<boolean> => {
    const result = await flushSync();
    return result.success;
  }, [flushSync]);

  // Register flush callback for sign-out to use
  useEffect(() => {
    flushCallbackRef.current = flushPendingSync;
    return () => {
      flushCallbackRef.current = null;
    };
  }, [flushPendingSync, flushCallbackRef]);

  // ─── Flush sync on tab close/hide ───────────────────────────────────────────
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && !signingOutRef.current) {
        flushPendingSync();
      }
    };
    
    const handlePageHide = () => {
      if (!signingOutRef.current) {
        flushPendingSync();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [flushPendingSync, signingOutRef]);

  // ─── Snooze expiry check (every 30s) — re-triggers alarm when snooze ends ───
  // Compute due alarms from ref OUTSIDE the updater, then do state update
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      
      // Compute which alarms are due from current pills ref
      const dueAlarms: { pillName: string; pillSound?: string; reminderTime: string }[] = [];
      const expiredReminderIds = new Set<string>();
      
      pillsRef.current.forEach(pill => {
        pill.reminders.forEach(reminder => {
          if (reminder.snoozedUntil && reminder.snoozedUntil <= now) {
            dueAlarms.push({
              pillName: pill.name,
              pillSound: pill.notificationSound,
              reminderTime: reminder.time,
            });
            expiredReminderIds.add(`${pill.id}:${reminder.id}`);
          }
        });
      });
      
      // Only update state if there are expired snoozes
      if (expiredReminderIds.size > 0) {
        setPills(prev => prev.map(pill => ({
          ...pill,
          reminders: pill.reminders.map(reminder => {
            if (expiredReminderIds.has(`${pill.id}:${reminder.id}`)) {
              const { snoozedUntil, ...rest } = reminder;
              return rest;
            }
            return reminder;
          }),
        })));
        
        // Fire alarms
        dueAlarms.forEach(({ pillName, pillSound, reminderTime }) => {
          if (isNative()) {
            fireImmediateNotification(`⏰ ${pillName}`, `Your snoozed reminder for ${reminderTime} is due!`);
          } else {
            playSound(pillSound);
            showWebNotification(`⏰ ${pillName}`, `Your snoozed reminder for ${reminderTime} is due!`);
          }
        });
      }
    }, 1000 * 30);
    return () => clearInterval(interval);
  }, []);

  // ─── Due reminder check (fires at each minute boundary) ─────────────────────
  useEffect(() => {
    let intervalId: number | undefined;

    const checkReminders = () => {
      const now = new Date();
      const currentTime = now.toTimeString().substring(0, 5);
      const currentDay = now.getDay();

      pillsRef.current.forEach(pill => {
        pill.reminders.forEach(reminder => {
          const isDue = reminder.time === currentTime;
          const isToday = reminder.daysOfWeek.includes(currentDay);
          const isSnoozed = reminder.snoozedUntil && reminder.snoozedUntil > now.getTime();
          
          // Use derived taken status from history
          const isTaken = isReminderTakenToday(pill.history || [], reminder.id);

          if (isDue && isToday && !isTaken && !isSnoozed) {
            if (isNative()) {
              fireImmediateNotification(
                `💊 Time for ${pill.name}`,
                pill.dosage ? `${pill.dosage} — tap to mark as taken` : 'Tap to mark as taken'
              );
            } else {
              playSound(pill.notificationSound);
              showWebNotification(
                `💊 Time for ${pill.name}`,
                pill.dosage
                  ? `${pill.dosage} — tap to open Remedi`
                  : 'Tap to open Remedi and mark as taken'
              );
            }
          }
        });
      });
    };

    // Sync to next minute boundary, then fire every 60s
    const secondsUntilNextMinute = 60 - new Date().getSeconds();
    const timeoutId = setTimeout(() => {
      checkReminders();
      intervalId = window.setInterval(checkReminders, 60 * 1000);
    }, secondsUntilNextMinute * 1000);

    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const savePill = async (pillData: Omit<Pill, 'id' | 'history'> | Pill) => {
    let savedPill: Pill;
    if ('id' in pillData && pillData.id) {
      // Editing existing pill - preserve history
      const existingPill = pills.find(p => p.id === pillData.id);
      savedPill = {
        ...(pillData as Pill),
        history: existingPill?.history || (pillData as Pill).history || [],
      };
      
      // Preserve snoozedUntil from existing reminders
      savedPill.reminders = savedPill.reminders.map(newReminder => {
        const existingReminder = existingPill?.reminders.find(r => r.id === newReminder.id);
        return {
          ...newReminder,
          snoozedUntil: existingReminder?.snoozedUntil,
          taken: false, // Derived from history
        };
      });
      
      // Mark as dirty for offline support
      savedPill = markDirty(savedPill, 'upsert');
      
      setPills(prevPills => prevPills.map(p => (p.id === savedPill.id ? savedPill : p)));
      
      // L-c fix: Broadcast AFTER save with full pill data (one message per change)
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.postMessage(createSyncMessage('pill_changed', userId, savedPill.id, savedPill));
      }
      
      // Cancel old notifications and reschedule
      if (isNative()) {
        const oldPill = pills.find(p => p.id === savedPill.id);
        if (oldPill) await cancelAllPillNotifications(oldPill.id, oldPill.reminders);
        for (const reminder of savedPill.reminders) {
          await scheduleReminderNotifications(
            savedPill.id, savedPill.name, savedPill.dosage,
            reminder.id, reminder.time, reminder.daysOfWeek
          );
        }
      }
    } else {
      const now = Date.now();
      // Use crypto.randomUUID() with crypto.getRandomValues fallback
      let newId: string;
      try {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
          newId = crypto.randomUUID();
        } else if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
          const bytes = new Uint8Array(16);
          crypto.getRandomValues(bytes);
          bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
          bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10
          const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
          newId = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
        } else {
          throw new Error('crypto.randomUUID or crypto.getRandomValues required for pill ID generation');
        }
      } catch (err) {
        setIdGenError(err instanceof Error ? err.message : 'Failed to generate pill ID');
        return;
      }
      savedPill = { ...pillData, id: newId, history: [], createdAt: now };
      savedPill.reminders = savedPill.reminders.map(r => ({
        ...r,
        taken: false,
      }));
      
      // Mark as dirty for offline support
      savedPill = markDirty(savedPill, 'upsert');
      
      setPills(prevPills => [...prevPills, savedPill]);
      
      // L-c fix: Broadcast AFTER save with full pill data (one message per change)
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.postMessage(createSyncMessage('pill_changed', userId, savedPill.id, savedPill));
      }
      
      // Schedule notifications for new pill
      if (isNative()) {
        for (const reminder of savedPill.reminders) {
          await scheduleReminderNotifications(
            savedPill.id, savedPill.name, savedPill.dosage,
            reminder.id, reminder.time, reminder.daysOfWeek
          );
        }
      }
    }
    setAddPillModalOpen(false);
    setPillToEdit(undefined);
    setIdGenError(null);
  };

  const openAddModal = () => { setPillToEdit(undefined); setAddPillModalOpen(true); };
  const openEditModal = (pill: Pill) => { setPillToEdit(pill); setAddPillModalOpen(true); };
  const closeModal = () => { setAddPillModalOpen(false); setPillToEdit(undefined); };

  // Toggle taken (for UI - allows un-marking)
  // N4 fix: markDirty and broadcast moved OUTSIDE the setPills updater
  const toggleReminderTaken = useCallback((pillId: string, reminderId: string) => {
    // First, compute the update using current state from ref
    const currentPill = pillsRef.current.find(p => p.id === pillId);
    if (!currentPill) return;
    
    const history = currentPill.history || [];
    const currentlyTaken = isReminderTakenToday(history, reminderId);
    const reminder = currentPill.reminders.find(r => r.id === reminderId);
    if (!reminder) return;
    
    let updatedPill: Pill;
    if (currentlyTaken) {
      const updatedHistory = removeLatestTakenEntry(history, reminderId);
      updatedPill = {
        ...currentPill,
        reminders: currentPill.reminders.map(r =>
          r.id === reminderId ? { ...r, taken: false } : r
        ),
        history: updatedHistory,
      };
    } else {
      const newHistoryEntry: HistoryEntry = {
        id: `${Date.now()}-${reminderId}`,
        reminderId: reminderId,
        pillName: currentPill.name,
        time: reminder.time,
        action: 'taken',
        timestamp: Date.now(),
      };
      
      const updatedReminders = currentPill.reminders.map(r =>
        r.id === reminderId ? { ...r, snoozedUntil: undefined, taken: true } : r
      );
      
      updatedPill = {
        ...currentPill,
        reminders: updatedReminders,
        history: [...history, newHistoryEntry],
      };
    }
    
    // Mark as dirty OUTSIDE the updater
    const dirtyPill = markDirty(updatedPill, 'upsert');
    
    // Update state
    setPills(prevPills => prevPills.map(p => p.id === pillId ? dirtyPill : p));
    
    // L-c fix: Broadcast AFTER save with full pill data (one message per change)
    if (broadcastChannelRef.current) {
      broadcastChannelRef.current.postMessage(createSyncMessage('pill_changed', userId, pillId, dirtyPill));
    }
  }, [userId, markDirty, setPills]);

  // N4 fix: markDirty and broadcast moved OUTSIDE the setPills updater
  const snoozeReminder = useCallback((pillId: string, reminderId: string, duration: number) => {
    // Compute the update using current state from ref
    const currentPill = pillsRef.current.find(p => p.id === pillId);
    if (!currentPill) return;
    
    const reminder = currentPill.reminders.find(r => r.id === reminderId);
    if (!reminder) return;
    
    const newHistoryEntry: HistoryEntry = {
      id: `${Date.now()}-${reminderId}`,
      reminderId: reminder.id,
      pillName: currentPill.name,
      time: reminder.time,
      action: 'snoozed',
      timestamp: Date.now(),
    };
    
    const updatedReminders = currentPill.reminders.map(r =>
      r.id === reminderId
        ? { ...r, snoozedUntil: Date.now() + duration, taken: false }
        : r
    );
    
    const updatedPill: Pill = {
      ...currentPill,
      reminders: updatedReminders,
      history: [...(currentPill.history || []), newHistoryEntry],
    };
    
    // Mark as dirty OUTSIDE the updater
    const dirtyPill = markDirty(updatedPill, 'upsert');
    
    // Update state
    setPills(prevPills => prevPills.map(p => p.id === pillId ? dirtyPill : p));
    
    // L-c fix: Broadcast AFTER save with full pill data (one message per change)
    if (broadcastChannelRef.current) {
      broadcastChannelRef.current.postMessage(createSyncMessage('pill_changed', userId, pillId, dirtyPill));
    }
  }, [userId, markDirty, setPills]);

  const deletePill = useCallback(async (pillId: string) => {
    const pill = pillsRef.current.find(p => p.id === pillId);
    if (!pill) return;
    
    if (isNative()) {
      await cancelAllPillNotifications(pill.id, pill.reminders);
    }
    
    // Mark as deleted in outbox (tombstone) for explicit cloud delete
    markDirty(pill, 'delete');
    
    // Broadcast delete to other tabs
    if (broadcastChannelRef.current) {
      broadcastChannelRef.current.postMessage(createSyncMessage('pill_deleted', userId, pillId));
    }
    
    // Remove from local state
    setPills(prevPills => prevPills.filter(p => p.id !== pillId));
  }, [userId, markDirty, setPills]);

  // ─── Derive taken status for display ────────────────────────────────────────
  const displayPills = enhancePillsWithDerivedStatus(pills);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-sky-100 font-sans text-slate-800">
      <div className="container mx-auto max-w-2xl p-4 pb-28">
        {/* Sign-out error banner */}
        {signOutError && (
          <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 flex items-start justify-between gap-2">
            <span>{signOutError}</span>
            <button onClick={onClearError} className="text-amber-400 hover:text-amber-600 flex-shrink-0">✕</button>
          </div>
        )}
        
        {/* ID generation error banner */}
        {idGenError && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800 flex items-start justify-between gap-2">
            <span>Failed to create pill: {idGenError}</span>
            <button onClick={() => setIdGenError(null)} className="text-red-400 hover:text-red-600 flex-shrink-0">✕</button>
          </div>
        )}

        {/* Notification permission denied banner (web only) */}
        {!isNative() && !notifDismissed &&
          'Notification' in window &&
          Notification.permission === 'denied' && (
          <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 flex items-start justify-between gap-2">
            <span>🔔 Notifications are blocked. Enable them in your browser settings to receive reminders.</span>
            <button onClick={() => setNotifDismissed(true)} className="text-amber-400 hover:text-amber-600 flex-shrink-0">✕</button>
          </div>
        )}

        {/* Tab-open reminder banner (web only, not yet granted) */}
        {!isNative() && !notifDismissed &&
          'Notification' in window &&
          Notification.permission === 'default' && (
          <div className="mb-3 p-3 bg-sky-50 border border-sky-200 rounded-xl text-sm text-sky-800 flex items-start justify-between gap-2">
            <span>💡 Keep this tab open for reminders. Download the app for alarms that work even when your phone is locked.</span>
            <button onClick={() => setNotifDismissed(true)} className="text-sky-400 hover:text-sky-600 flex-shrink-0">✕</button>
          </div>
        )}

        <div className="flex flex-wrap justify-between items-center gap-2 pt-2 pb-1">
          <Header />
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            {syncStatus === 'syncing' && <span className="text-xs text-sky-500 hidden sm:inline">Syncing...</span>}
            {syncStatus === 'synced' && <span className="text-xs text-green-500">☁<span className="hidden sm:inline"> Saved</span></span>}
            {syncStatus === 'error' && <span className="text-xs text-red-400">⚠<span className="hidden sm:inline"> Sync failed</span></span>}
            <button
              onClick={() => setReportOpen(true)}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-xs text-sky-500 hover:text-sky-700 font-medium border border-sky-200 rounded-lg px-2 sm:px-2 hover:bg-sky-50 transition-colors"
              aria-label="View doctor report"
            >
              <span className="sm:hidden text-base">🩺</span>
              <span className="hidden sm:inline">🩺 Report</span>
            </button>
            <button
              onClick={onSignOut}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-xs text-slate-400 hover:text-slate-600"
              aria-label="Sign out"
            >
              <span className="sm:hidden text-base">🚪</span>
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>

        <main>
          <PillList
            pills={displayPills}
            onToggleTaken={toggleReminderTaken}
            onDeletePill={deletePill}
            onSnoozeReminder={snoozeReminder}
            onEditPill={openEditModal}
          />
        </main>
      </div>

      {isAddPillModalOpen && (
        <AddPillModal onClose={closeModal} onSavePill={savePill} pillToEdit={pillToEdit} userId={user?.id} />
      )}
      {isChatModalOpen && (
        <ChatModal onClose={() => setChatModalOpen(false)} userId={user?.id} />
      )}
      {isReportOpen && (
        <DoctorReport pills={displayPills} onClose={() => setReportOpen(false)} />
      )}

      <div className="fixed bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-sky-100 to-transparent pointer-events-none z-30"></div>
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 z-40">
        <button
          onClick={() => setChatModalOpen(true)}
          className="bg-sky-500 text-white font-semibold rounded-full px-6 py-3 shadow-lg hover:bg-sky-600 transition-transform hover:scale-105 flex items-center gap-2"
        >
          <ChatIcon className="w-6 h-6" /><span>AI Chat</span>
        </button>
        <button
          onClick={openAddModal}
          className="bg-red-500 text-white font-semibold rounded-full px-6 py-3 shadow-lg hover:bg-red-600 transition-transform hover:scale-105 flex items-center gap-2"
        >
          <PlusIcon className="w-6 h-6" /><span>Add Pill</span>
        </button>
      </div>
    </div>
  );
};

export default App;
