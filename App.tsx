import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Pill, HistoryEntry } from './types';
import Header from './components/Header';
import PillList from './components/PillList';
import AddPillModal from './components/AddPillModal';
import ChatModal from './components/ChatModal';
import Auth from './components/Auth';
import DoctorReport from './components/DoctorReport';
import { ChatIcon, PlusIcon } from './components/icons/Icons';
import { playSound } from './services/soundService';
import { onAuthStateChange, signOut, cleanupUserData, type User, type SignOutResult } from './services/authService';
import { loadPillsFromCloud, syncPillsToCloud } from './services/pillsService';
import {
  requestNotificationPermission,
  fireImmediateNotification,
  scheduleReminderNotifications,
  cancelAllPillNotifications,
  cancelAllScheduledNotifications,
  scheduleAllPillNotifications,
  registerNotificationListeners,
  isNative,
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
} from './lib/storage';
import {
  isReminderTakenToday,
  recordMissedDoses,
  removeLatestTakenEntry,
  enhancePillsWithDerivedStatus,
} from './lib/pillHelpers';

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
  const [signOutError, setSignOutError] = useState<string | null>(null);
  
  // Track previous user ID to detect user switches
  const prevUserIdRef = useRef<string | null>(null);
  // Flag to block writes during sign-out
  const signingOutRef = useRef(false);
  // Listener registered flag
  const listenerRegisteredRef = useRef(false);

  // ─── Auth listener ──────────────────────────────────────────────────────────
  useEffect(() => {
    const { data: { subscription } } = onAuthStateChange(async (currentUser, event) => {
      const currentUserId = currentUser?.id ?? null;
      const prevUserId = prevUserIdRef.current;
      
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
      
      if (currentUser) {
        // Request notification permission — native or web
        await requestNotificationPermission();
        if (!isNative()) await requestWebNotificationPermission();
        
        // Register native notification tap handler (once)
        if (!listenerRegisteredRef.current) {
          listenerRegisteredRef.current = true;
          registerNotificationListeners(() => {
            // Notification tap handling is done in SignedInApp
          });
        }
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = useCallback(async () => {
    const currentUserId = prevUserIdRef.current;
    signingOutRef.current = true;
    setSignOutError(null);
    
    const result = await signOut(currentUserId ?? undefined);
    
    if (!result.success) {
      setSignOutError(result.error ?? 'Sign out failed');
      signingOutRef.current = false;
    } else if (result.localOnly && result.error) {
      // Partial success - show warning but continue
      setSignOutError(result.error);
    }
    // On success, SIGNED_OUT event will handle the rest
  }, []);

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (authLoading) {
    return (
      <div className="min-h-screen bg-sky-100 flex items-center justify-center">
        <div className="text-slate-500">Loading...</div>
      </div>
    );
  }

  if (!user || !userId) return <Auth />;

  // Key by userId to ensure all state is reset when user changes (S2)
  return (
    <SignedInApp
      key={userId}
      user={user}
      userId={userId}
      signingOutRef={signingOutRef}
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
  signOutError: string | null;
  onSignOut: () => void;
  onClearError: () => void;
}

const SignedInApp: React.FC<SignedInAppProps> = ({
  user,
  userId,
  signingOutRef,
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

  const [pills, setPills] = useState<Pill[]>([]);

  // UI state - all reset per-user due to key={userId} remount
  const [isAddPillModalOpen, setAddPillModalOpen] = useState(false);
  const [isChatModalOpen, setChatModalOpen] = useState(false);
  const [isReportOpen, setReportOpen] = useState(false);
  const [pillToEdit, setPillToEdit] = useState<Pill | undefined>(undefined);

  // Keep ref in sync
  useEffect(() => { pillsRef.current = pills; }, [pills]);

  // ─── Flush pending sync (for visibilitychange/pagehide) ───────────────────
  const flushPendingSync = useCallback(async () => {
    if (signingOutRef.current) return;
    if (!cloudLoadSucceededRef.current) return;
    if (loadedForUserIdRef.current !== userId) return;
    
    // Cancel any pending debounced sync
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = undefined;
    }
    
    // Check if there's actually pending changes
    if (!hasPendingSync(userId)) return;
    
    try {
      const result = await syncPillsToCloud(userId, pillsRef.current, cloudIdsRef.current);
      if (result.success) {
        saveCloudIdsToStorage(userId, new Set(pillsRef.current.map(p => p.id)));
        cloudIdsRef.current = new Set(pillsRef.current.map(p => p.id));
        setPendingSync(userId, false);
      }
    } catch (err) {
      console.error('Flush sync failed:', err);
    }
  }, [userId]);

  // ─── Load from cloud on mount ───────────────────────────────────────────────
  useEffect(() => {
    const loadCloud = async () => {
      // Reset load state
      cloudLoadSucceededRef.current = false;
      loadedForUserIdRef.current = null;
      
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
        
        // Cloud load succeeded - mark this BEFORE any sync can happen
        cloudLoadSucceededRef.current = true;
        loadedForUserIdRef.current = userId;
        
        // Update cloud IDs tracking
        const newCloudIds = new Set<string>(cloudPills.map(p => p.id));
        cloudIdsRef.current = newCloudIds;
        saveCloudIdsToStorage(userId, newCloudIds);
        
        // Use cloud data, enhanced with derived taken status
        const enhancedPills = enhancePillsWithDerivedStatus(cloudPills);
        setPills(enhancedPills);
        savePillsToStorage(userId, enhancedPills);
        
        // Cancel any existing native notifications and reschedule from cloud data
        // This ensures notifications match the user's actual pills
        if (isNative()) {
          await cancelAllScheduledNotifications();
          await scheduleAllPillNotifications(cloudPills);
        }
        
        setSyncStatus('synced');
        
        // Clear any stale pending sync flag
        setPendingSync(userId, false);
      } catch (err) {
        console.error('Failed to load from cloud:', err);
        setSyncStatus('error');
        // DO NOT set cloudLoadSucceededRef.current = true here
        // This prevents destructive sync when load fails
      }
    };
    
    loadCloud();
  }, [userId]); // Only depends on userId, not user object (S6)

  // ─── Persist to localStorage (user-scoped) ──────────────────────────────────
  useEffect(() => {
    // Block writes during sign-out or if we haven't loaded for this user
    if (signingOutRef.current) return;
    if (loadedForUserIdRef.current !== userId) return;
    
    savePillsToStorage(userId, pills);
  }, [pills, userId]);

  // ─── Debounced cloud sync (only after successful load) ──────────────────────
  useEffect(() => {
    // Block sync during sign-out or before load succeeds
    if (signingOutRef.current) return;
    if (!cloudLoadSucceededRef.current) return;
    if (loadedForUserIdRef.current !== userId) return;
    
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
        const result = await syncPillsToCloud(userId, pills, cloudIdsRef.current);
        
        if (result.aborted) {
          // User changed during sync - don't update state
          console.warn('Sync aborted:', result.error);
          setSyncStatus('error');
          return;
        }
        
        if (result.success) {
          const newCloudIds = new Set<string>(pills.map(p => p.id));
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
      if (document.visibilityState === 'hidden') {
        flushPendingSync();
      }
    };
    
    const handlePageHide = () => {
      flushPendingSync();
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [flushPendingSync]);

  // ─── Snooze expiry check (every 30s) — re-triggers alarm when snooze ends ───
  // Uses functional updater to avoid stale state issues (S5)
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const reAlarmItems: { pillName: string; pillSound?: string; reminderTime: string }[] = [];

      setPills(prev => {
        let hasChanges = false;
        
        const updatedPills = prev.map(pill => {
          const newReminders = pill.reminders.map(reminder => {
            if (reminder.snoozedUntil && reminder.snoozedUntil <= now) {
              hasChanges = true;
              reAlarmItems.push({
                pillName: pill.name,
                pillSound: pill.notificationSound,
                reminderTime: reminder.time,
              });
              const { snoozedUntil, ...rest } = reminder;
              return rest;
            }
            return reminder;
          });
          return hasChanges ? { ...pill, reminders: newReminders } : pill;
        });
        
        return hasChanges ? updatedPills : prev;
      });

      // Fire alarms outside the updater
      reAlarmItems.forEach(({ pillName, pillSound, reminderTime }) => {
        if (isNative()) {
          fireImmediateNotification(`⏰ ${pillName}`, `Your snoozed reminder for ${reminderTime} is due!`);
        } else {
          playSound(pillSound);
          showWebNotification(`⏰ ${pillName}`, `Your snoozed reminder for ${reminderTime} is due!`);
        }
      });
    }, 1000 * 30);
    return () => clearInterval(interval);
  }, []);

  // ─── Missed dose sweep on load (covers all days since last sweep) ───────────
  useEffect(() => {
    if (!cloudLoadSucceededRef.current) return;
    if (pills.length === 0) return;
    
    const lastSweep = getLastMissedSweepDate(userId);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getDateString(yesterday);
    
    // Only sweep if we haven't swept up to yesterday
    if (lastSweep === yesterdayStr) return;
    
    const { updatedPills, hasChanges } = recordMissedDoses(pills, lastSweep);
    
    if (hasChanges) {
      setPills(updatedPills);
    }
    
    // Mark that we've swept up to yesterday
    setLastMissedSweepDate(userId, yesterdayStr);
  }, [userId, pills.length]);

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
      
      setPills(prevPills => prevPills.map(p => (p.id === savedPill.id ? savedPill : p)));
      
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
      savedPill = { ...pillData, id: Date.now().toString(), history: [] };
      savedPill.reminders = savedPill.reminders.map(r => ({
        ...r,
        taken: false,
      }));
      setPills(prevPills => [...prevPills, savedPill]);
      
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

  // Mark taken (idempotent - for notification taps)
  const markReminderTaken = useCallback((pillId: string, reminderId: string) => {
    setPills(prevPills => prevPills.map(pill => {
      if (pill.id === pillId) {
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
      }
      return pill;
    }));
  }, []);

  // Toggle taken (for UI - allows un-marking)
  const toggleReminderTaken = useCallback((pillId: string, reminderId: string) => {
    setPills(prevPills => prevPills.map(pill => {
      if (pill.id === pillId) {
        const history = pill.history || [];
        const currentlyTaken = isReminderTakenToday(history, reminderId);
        const reminder = pill.reminders.find(r => r.id === reminderId);
        
        if (!reminder) return pill;
        
        if (currentlyTaken) {
          const updatedHistory = removeLatestTakenEntry(history, reminderId);
          return {
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
          
          return {
            ...pill,
            reminders: updatedReminders,
            history: [...history, newHistoryEntry],
          };
        }
      }
      return pill;
    }));
  }, []);

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
        
        return {
          ...pill,
          reminders: updatedReminders,
          history: [...(pill.history || []), newHistoryEntry],
        };
      }
      return pill;
    }));
  }, []);

  const deletePill = useCallback(async (pillId: string) => {
    const pill = pillsRef.current.find(p => p.id === pillId);
    if (pill && isNative()) {
      await cancelAllPillNotifications(pill.id, pill.reminders);
    }
    setPills(prevPills => prevPills.filter(pill => pill.id !== pillId));
  }, []);

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

        <div className="flex justify-between items-center pt-2 pb-1">
          <Header />
          <div className="flex items-center gap-2">
            {syncStatus === 'syncing' && <span className="text-xs text-sky-500">Syncing...</span>}
            {syncStatus === 'synced' && <span className="text-xs text-green-500">☁ Saved</span>}
            {syncStatus === 'error' && <span className="text-xs text-red-400">Sync failed</span>}
            <button
              onClick={() => setReportOpen(true)}
              className="text-xs text-sky-500 hover:text-sky-700 font-medium border border-sky-200 rounded-lg px-2 py-1 hover:bg-sky-50 transition-colors"
            >
              🩺 Report
            </button>
            <button onClick={onSignOut} className="text-xs text-slate-400 hover:text-slate-600">Sign out</button>
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
        <AddPillModal onClose={closeModal} onSavePill={savePill} pillToEdit={pillToEdit} />
      )}
      {isChatModalOpen && (
        <ChatModal onClose={() => setChatModalOpen(false)} />
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
