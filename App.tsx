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
  savePillsToStorage,
  loadCloudIdsFromStorage,
  saveCloudIdsToStorage,
  getLastMissedSweepDate,
  setLastMissedSweepDate,
  setPendingSync,
  hasPendingSync,
  purgeLegacyUnscopedData,
  getDateString,
  loadOutboxFromStorage,
  addToOutbox,
  loadQueuedTapsFromStorage,
  saveQueuedTapsToStorage,
  addQueuedTap,
  clearQueuedTaps,
} from './lib/storage';
import {
  mergePills,
  markPillDirty,
  flushOutbox,
  initBroadcastChannel,
  broadcastPillChange,
  broadcastPillsLoaded,
  hasUnsyncedChanges,
  type SyncMessage,
} from './lib/syncEngine';
import {
  isReminderTakenToday,
  recordMissedDoses,
  removeLatestTakenEntry,
  enhancePillsWithDerivedStatus,
} from './lib/pillHelpers';
import {
  shouldQueueTap,
  applyTakenMarkToPill,
  orchestrateAfterCloudLoad,
  type QueuedTap,
} from './lib/loadOrchestration';

// Purge legacy unscoped data at module load, BEFORE auth
// This prevents data from old versions being shown to any user
purgeLegacyUnscopedData();

const SYNC_DEBOUNCE_MS = 1500;

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
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [notifDismissed, setNotifDismissed] = useState(false);
  
  // Track whether initial cloud load succeeded - NEVER sync before this
  const cloudLoadSucceededRef = useRef(false);
  // Track which user ID we loaded for (prevents cross-user writes)
  const loadedForUserIdRef = useRef<string | null>(null);
  const syncTimeoutRef = useRef<number | undefined>(undefined);
  const pillsRef = useRef<Pill[]>([]);
  const cloudIdsRef = useRef<Set<string>>(new Set());
  // Notification listener handle for cleanup
  const notifListenerRef = useRef<NotificationListenerHandle | null>(null);
  // Queue for notification taps that arrive before cloud load completes
  const pendingNotifTapsRef = useRef<QueuedTap[]>([]);
  // Track if missed dose sweep has run after this load
  const missedSweepDoneRef = useRef(false);

  const [pills, setPills] = useState<Pill[]>([]);

  // UI state - all reset per-user due to key={userId} remount
  const [isAddPillModalOpen, setAddPillModalOpen] = useState(false);
  const [isChatModalOpen, setChatModalOpen] = useState(false);
  const [isReportOpen, setReportOpen] = useState(false);
  const [pillToEdit, setPillToEdit] = useState<Pill | undefined>(undefined);

  // Keep ref in sync
  useEffect(() => { pillsRef.current = pills; }, [pills]);

  // ─── Mark taken handler (for notification taps) ─────────────────────────────
  // If cloud load hasn't completed, queue the tap to apply after load
  // Persists queued taps to localStorage so they survive reload/failed load
  // Uses shouldQueueTap from loadOrchestration for testability
  const markReminderTaken = useCallback((pillId: string, reminderId: string) => {
    if (shouldQueueTap(cloudLoadSucceededRef.current)) {
      const tap = { pillId, reminderId, userId };
      pendingNotifTapsRef.current.push(tap);
      addQueuedTap(userId, tap);
      return;
    }
    
    applyTakenMark(pillId, reminderId);
  }, [userId]);
  
  // Apply taken mark to pills state (used directly and for queued taps)
  // Uses applyTakenMarkToPill from loadOrchestration for testability
  const applyTakenMark = useCallback((pillId: string, reminderId: string) => {
    setPills(prevPills => prevPills.map(pill => {
      if (pill.id === pillId) {
        return applyTakenMarkToPill(pill, reminderId);
      }
      return pill;
    }));
  }, []);

  // ─── Register notification listener inside SignedInApp (B2 fix) ─────────────
  useEffect(() => {
    const setupListener = async () => {
      if (isNative()) {
        notifListenerRef.current = await registerNotificationListeners(markReminderTaken);
      }
    };
    setupListener();
    
    return () => {
      // Clean up listener on unmount (sign-out or user change)
      if (notifListenerRef.current) {
        notifListenerRef.current.remove();
        notifListenerRef.current = null;
      }
    };
  }, [markReminderTaken]);

  // ─── Multi-tab coordination via BroadcastChannel ────────────────────────────
  useEffect(() => {
    const handleSyncMessage = (msg: SyncMessage) => {
      // Ignore messages from other users
      if (msg.userId !== userId) return;
      
      if (msg.type === 'pill_changed' && msg.pill) {
        // Another tab changed a pill - update our state if not in outbox
        const outbox = loadOutboxFromStorage(userId);
        const inOurOutbox = outbox.some(e => e.id === msg.pillId);
        if (!inOurOutbox) {
          setPills(prevPills => {
            const exists = prevPills.some(p => p.id === msg.pillId);
            if (exists) {
              return prevPills.map(p => p.id === msg.pillId ? msg.pill! : p);
            } else {
              return [...prevPills, msg.pill!];
            }
          });
        }
      } else if (msg.type === 'pill_deleted' && msg.pillId) {
        // Another tab deleted a pill - remove from our state
        setPills(prevPills => prevPills.filter(p => p.id !== msg.pillId));
      } else if (msg.type === 'pills_loaded') {
        // Another tab loaded from cloud - reload our local storage
        const refreshedPills = loadPillsFromStorage(userId);
        setPills(enhancePillsWithDerivedStatus(refreshedPills));
      }
    };
    
    const cleanup = initBroadcastChannel(handleSyncMessage);
    return cleanup;
  }, [userId]);

  // ─── Flush pending sync (for visibilitychange/pagehide AND sign-out) ────────
  // Only flushes the outbox - no full-list sync
  const flushPendingSync = useCallback(async (): Promise<boolean> => {
    // Allow flush during sign-out (we WANT to save before clearing)
    // But don't flush if not for this user
    if (!cloudLoadSucceededRef.current) return false;
    if (loadedForUserIdRef.current !== userId) return false;
    
    // Cancel any pending debounced sync
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = undefined;
    }
    
    // Flush the outbox (per-pill upserts/deletes only)
    try {
      const result = await flushOutbox(userId);
      if (result.success) {
        setPendingSync(userId, false);
        return true;
      }
      return false;
    } catch (err) {
      console.error('Flush sync failed:', err);
      return false;
    }
  }, [userId]);

  // Register flush callback for sign-out to use
  useEffect(() => {
    flushCallbackRef.current = flushPendingSync;
    return () => {
      flushCallbackRef.current = null;
    };
  }, [flushPendingSync, flushCallbackRef]);

  // ─── Load from cloud on mount ───────────────────────────────────────────────
  useEffect(() => {
    const loadCloud = async () => {
      // Reset load state
      cloudLoadSucceededRef.current = false;
      loadedForUserIdRef.current = null;
      missedSweepDoneRef.current = false;
      
      // Load persisted queued taps (from failed loads or offline taps)
      const persistedTaps = loadQueuedTapsFromStorage(userId);
      pendingNotifTapsRef.current = [...persistedTaps];
      
      // Load from local storage for this user (immediate UI)
      const localPills = loadPillsFromStorage(userId);
      if (localPills.length > 0) {
        setPills(enhancePillsWithDerivedStatus(localPills));
      }
      
      // Load cloud IDs from storage
      cloudIdsRef.current = loadCloudIdsFromStorage(userId);
      
      try {
        setSyncStatus('syncing');
        const cloudPills = await loadPillsFromCloud();
        
        // Merge cloud pills with local dirty changes
        // This preserves offline edits instead of overwriting them
        const outbox = loadOutboxFromStorage(userId);
        const { pills: mergedPills, hasLocalChanges } = mergePills(
          localPills,
          cloudPills,
          outbox
        );
        
        // Cloud load succeeded - mark this BEFORE any sync can happen
        cloudLoadSucceededRef.current = true;
        loadedForUserIdRef.current = userId;
        
        // Update cloud IDs tracking
        const newCloudIds = new Set<string>(cloudPills.map(p => p.id));
        cloudIdsRef.current = newCloudIds;
        saveCloudIdsToStorage(userId, newCloudIds);
        
        // Run orchestration: sweep + apply queued taps
        // Uses orchestrateAfterCloudLoad from loadOrchestration for testability
        const lastSweep = getLastMissedSweepDate(userId);
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = getDateString(yesterday);
        
        // Get taps to apply before clearing
        const tapsToApply = [...pendingNotifTapsRef.current];
        
        const orchestrationResult = orchestrateAfterCloudLoad(
          mergedPills,
          lastSweep,
          yesterdayStr,
          tapsToApply,
          userId,
          recordMissedDoses
        );
        
        if (orchestrationResult.sweepRan) {
          setLastMissedSweepDate(userId, yesterdayStr);
        }
        missedSweepDoneRef.current = true;
        
        // Mark pills changed by sweep or taps as dirty so they sync to cloud
        // This ensures both swept missed doses AND queued taps reach the cloud
        for (const pill of orchestrationResult.pills) {
          if (orchestrationResult.changedPillIds.has(pill.id)) {
            markPillDirty(userId, pill, 'upsert');
          }
        }
        
        // NOW clear queued taps from memory and storage
        pendingNotifTapsRef.current = [];
        clearQueuedTaps(userId);
        
        // Use orchestrated pills, enhanced with derived taken status
        const enhancedPills = enhancePillsWithDerivedStatus(orchestrationResult.pills);
        setPills(enhancedPills);
        savePillsToStorage(userId, enhancedPills);
        
        // Cancel any existing native notifications and reschedule from cloud data
        // This ensures notifications match the user's actual pills
        if (isNative()) {
          await cancelAllScheduledNotifications();
          await scheduleAllPillNotifications(orchestrationResult.pills);
        }
        
        // Flush outbox (includes local changes + tapped pills)
        const currentOutbox = loadOutboxFromStorage(userId);
        if (currentOutbox.length > 0 || hasLocalChanges) {
          const flushResult = await flushOutbox(userId);
          if (flushResult.success) {
            setSyncStatus('synced');
          } else {
            setSyncStatus('error');
          }
        } else {
          setSyncStatus('synced');
        }
        
        // Clear any stale pending sync flag
        setPendingSync(userId, false);
        
        // Broadcast to other tabs that we loaded
        broadcastPillsLoaded(userId);
      } catch (err) {
        console.error('Failed to load from cloud:', err);
        setSyncStatus('error');
        // DO NOT set cloudLoadSucceededRef.current = true here
        // This prevents destructive sync when load fails
        
        // On load failure, apply queued taps to local state so user's action isn't lost
        // Taps remain persisted in localStorage for next successful load
        // Uses applyQueuedTapsToPills from loadOrchestration for testability
        const { filterTapsForUser, applyQueuedTapsToPills } = await import('./lib/loadOrchestration');
        const tapsForUser = filterTapsForUser(pendingNotifTapsRef.current, userId);
        pendingNotifTapsRef.current = [];
        // Don't clear queued taps from storage - they need to persist for next load
        if (tapsForUser.length > 0) {
          setPills(prevPills => {
            const updated = applyQueuedTapsToPills(prevPills, tapsForUser);
            savePillsToStorage(userId, updated);
            return updated;
          });
        }
      }
    };
    
    loadCloud();
  }, [userId, applyTakenMark]); // Only depends on userId, not user object (S6)

  // ─── Persist to localStorage (user-scoped) ──────────────────────────────────
  useEffect(() => {
    // Block writes during sign-out or if we haven't loaded for this user
    if (signingOutRef.current) return;
    if (loadedForUserIdRef.current !== userId) return;
    
    savePillsToStorage(userId, pills);
  }, [pills, userId]);

  // ─── Debounced outbox flush (only after successful load) ─────────────────────
  // Only syncs items in the outbox - no full-list re-upload
  useEffect(() => {
    // Block sync during sign-out or before load succeeds
    if (signingOutRef.current) return;
    if (!cloudLoadSucceededRef.current) return;
    if (loadedForUserIdRef.current !== userId) return;
    
    // Check if outbox has items to sync
    const outbox = loadOutboxFromStorage(userId);
    if (outbox.length === 0) return;
    
    // Mark that there's a pending sync
    setPendingSync(userId, true);
    
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    setSyncStatus('idle');
    
    syncTimeoutRef.current = window.setTimeout(async () => {
      // Double-check we should still sync
      if (signingOutRef.current) return;
      if (loadedForUserIdRef.current !== userId) return;
      
      try {
        setSyncStatus('syncing');
        const result = await flushOutbox(userId);
        
        if (result.aborted) {
          console.warn('Sync aborted:', result.error);
          setSyncStatus('error');
          return;
        }
        
        if (result.success) {
          // Update cloud IDs based on current pills (non-deleted)
          const currentPills = pillsRef.current.filter(p => !p.deleted);
          const newCloudIds = new Set<string>(currentPills.map(p => p.id));
          cloudIdsRef.current = newCloudIds;
          saveCloudIdsToStorage(userId, newCloudIds);
          setPendingSync(userId, false);
          setSyncStatus('synced');
        } else {
          console.error('Cloud sync failed:', result.error);
          setSyncStatus('error');
        }
      } catch (err) {
        console.error('Cloud sync failed:', err);
        setSyncStatus('error');
      }
    }, SYNC_DEBOUNCE_MS);
    
    return () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, [pills, userId]);

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
  }, [flushPendingSync]);

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
      savedPill = markPillDirty(userId, savedPill, 'upsert');
      
      setPills(prevPills => prevPills.map(p => (p.id === savedPill.id ? savedPill : p)));
      
      // Broadcast change to other tabs
      broadcastPillChange('pill_changed', userId, savedPill.id, savedPill);
      
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
      savedPill = { ...pillData, id: now.toString(), history: [], createdAt: now };
      savedPill.reminders = savedPill.reminders.map(r => ({
        ...r,
        taken: false,
      }));
      
      // Mark as dirty for offline support
      savedPill = markPillDirty(userId, savedPill, 'upsert');
      
      setPills(prevPills => [...prevPills, savedPill]);
      
      // Broadcast change to other tabs
      broadcastPillChange('pill_changed', userId, savedPill.id, savedPill);
      
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
  };

  const openAddModal = () => { setPillToEdit(undefined); setAddPillModalOpen(true); };
  const openEditModal = (pill: Pill) => { setPillToEdit(pill); setAddPillModalOpen(true); };
  const closeModal = () => { setAddPillModalOpen(false); setPillToEdit(undefined); };

  // Toggle taken (for UI - allows un-marking)
  const toggleReminderTaken = useCallback((pillId: string, reminderId: string) => {
    setPills(prevPills => prevPills.map(pill => {
      if (pill.id === pillId) {
        const history = pill.history || [];
        const currentlyTaken = isReminderTakenToday(history, reminderId);
        const reminder = pill.reminders.find(r => r.id === reminderId);
        
        if (!reminder) return pill;
        
        let updatedPill: Pill;
        if (currentlyTaken) {
          const updatedHistory = removeLatestTakenEntry(history, reminderId);
          updatedPill = {
            ...pill,
            reminders: pill.reminders.map(r =>
              r.id === reminderId ? { ...r, taken: false } : r
            ),
            history: updatedHistory,
          };
        } else {
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
          
          updatedPill = {
            ...pill,
            reminders: updatedReminders,
            history: [...history, newHistoryEntry],
          };
        }
        
        // Mark as dirty for sync
        const dirtyPill = markPillDirty(userId, updatedPill, 'upsert');
        broadcastPillChange('pill_changed', userId, dirtyPill.id, dirtyPill);
        return dirtyPill;
      }
      return pill;
    }));
  }, [userId]);

  const snoozeReminder = useCallback((pillId: string, reminderId: string, duration: number) => {
    setPills(prevPills => prevPills.map(pill => {
      if (pill.id === pillId) {
        const reminder = pill.reminders.find(r => r.id === reminderId);
        if (!reminder) return pill;
        
        const newHistoryEntry: HistoryEntry = {
          id: `${Date.now()}-${reminderId}`,
          reminderId: reminder.id,
          pillName: pill.name,
          time: reminder.time,
          action: 'snoozed',
          timestamp: Date.now(),
        };
        
        const updatedReminders = pill.reminders.map(r =>
          r.id === reminderId
            ? { ...r, snoozedUntil: Date.now() + duration, taken: false }
            : r
        );
        
        const updatedPill: Pill = {
          ...pill,
          reminders: updatedReminders,
          history: [...(pill.history || []), newHistoryEntry],
        };
        
        // Mark as dirty for sync
        const dirtyPill = markPillDirty(userId, updatedPill, 'upsert');
        broadcastPillChange('pill_changed', userId, dirtyPill.id, dirtyPill);
        return dirtyPill;
      }
      return pill;
    }));
  }, [userId]);

  const deletePill = useCallback(async (pillId: string) => {
    const pill = pillsRef.current.find(p => p.id === pillId);
    if (!pill) return;
    
    if (isNative()) {
      await cancelAllPillNotifications(pill.id, pill.reminders);
    }
    
    // Mark as deleted in outbox (tombstone) for explicit cloud delete
    markPillDirty(userId, pill, 'delete');
    
    // Broadcast delete to other tabs
    broadcastPillChange('pill_deleted', userId, pillId);
    
    // Remove from local state
    setPills(prevPills => prevPills.filter(p => p.id !== pillId));
  }, [userId]);

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
