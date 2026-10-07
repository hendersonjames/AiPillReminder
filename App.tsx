import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Pill, Reminder, HistoryEntry } from './types';
import Header from './components/Header';
import PillList from './components/PillList';
import AddPillModal from './components/AddPillModal';
import ChatModal from './components/ChatModal';
import Auth from './components/Auth';
import DoctorReport from './components/DoctorReport';
import { ChatIcon, PlusIcon } from './components/icons/Icons';
import { playSound } from './services/soundService';
import { onAuthStateChange, signOut, type User } from './services/authService';
import { loadPillsFromCloud, syncPillsToCloud } from './services/pillsService';
import {
  requestNotificationPermission,
  fireImmediateNotification,
  scheduleReminderNotifications,
  cancelAllPillNotifications,
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
  migrateUnscopedData,
  getDateString,
} from './lib/storage';
import {
  isReminderTakenToday,
  recordMissedDoses,
  removeLatestTakenEntry,
  enhancePillsWithDerivedStatus,
} from './lib/pillHelpers';

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

// ─── App ──────────────────────────────────────────────────────────────────────

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [notifDismissed, setNotifDismissed] = useState(false);
  
  // Track whether initial cloud load succeeded - NEVER sync before this
  const cloudLoadSucceededRef = useRef(false);
  const syncTimeoutRef = useRef<number | undefined>(undefined);
  const pillsRef = useRef<Pill[]>([]);
  const userRef = useRef<User | null>(null);
  const cloudIdsRef = useRef<Set<string>>(new Set());
  const listenerRegisteredRef = useRef(false);

  const [pills, setPills] = useState<Pill[]>([]);

  // Keep refs in sync
  useEffect(() => { pillsRef.current = pills; }, [pills]);
  useEffect(() => { userRef.current = user; }, [user]);

  const [isAddPillModalOpen, setAddPillModalOpen] = useState(false);
  const [isChatModalOpen, setChatModalOpen] = useState(false);
  const [isReportOpen, setReportOpen] = useState(false);
  const [pillToEdit, setPillToEdit] = useState<Pill | undefined>(undefined);

  // ─── Flush pending sync (for visibilitychange/pagehide) ───────────────────
  const flushPendingSync = useCallback(async () => {
    const currentUser = userRef.current;
    if (!currentUser || !cloudLoadSucceededRef.current) return;
    
    // Cancel any pending debounced sync
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = undefined;
    }
    
    // Check if there's actually pending changes
    if (!hasPendingSync(currentUser.id)) return;
    
    try {
      const result = await syncPillsToCloud(pillsRef.current, cloudIdsRef.current);
      if (result.success) {
        // Update cloud IDs after successful sync
        saveCloudIdsToStorage(currentUser.id, new Set(pillsRef.current.map(p => p.id)));
        cloudIdsRef.current = new Set(pillsRef.current.map(p => p.id));
        setPendingSync(currentUser.id, false);
      }
    } catch (err) {
      console.error('Flush sync failed:', err);
    }
  }, []);

  // ─── Auth listener ──────────────────────────────────────────────────────────
  useEffect(() => {
    const { data: { subscription } } = onAuthStateChange(async (currentUser, event) => {
      // Handle sign out - clear was already done in signOut()
      if (event === 'SIGNED_OUT') {
        cloudLoadSucceededRef.current = false;
        setPills([]);
        cloudIdsRef.current = new Set();
        setUser(null);
        setAuthLoading(false);
        return;
      }
      
      setUser(currentUser);
      setAuthLoading(false);
      
      if (currentUser) {
        // Request notification permission — native or web
        await requestNotificationPermission();
        if (!isNative()) await requestWebNotificationPermission();
        
        // Register native notification tap handler (once)
        if (!listenerRegisteredRef.current) {
          listenerRegisteredRef.current = true;
          registerNotificationListeners((pillId, reminderId) => {
            markReminderTaken(pillId, reminderId);
          });
        }
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // ─── Load from cloud on login ───────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    
    const loadCloud = async () => {
      // Reset load state
      cloudLoadSucceededRef.current = false;
      
      // Try to migrate old unscoped data first
      migrateUnscopedData(user.id);
      
      // Load from local storage for this user (immediate UI)
      const localPills = loadPillsFromStorage(user.id);
      if (localPills.length > 0) {
        setPills(enhancePillsWithDerivedStatus(localPills));
      }
      
      // Load cloud IDs from storage
      cloudIdsRef.current = loadCloudIdsFromStorage(user.id);
      
      try {
        setSyncStatus('syncing');
        const cloudPills = await loadPillsFromCloud();
        
        // Cloud load succeeded - mark this BEFORE any sync can happen
        cloudLoadSucceededRef.current = true;
        
        // Update cloud IDs tracking
        const newCloudIds = new Set<string>(cloudPills.map(p => p.id));
        cloudIdsRef.current = newCloudIds;
        saveCloudIdsToStorage(user.id, newCloudIds);
        
        // Use cloud data, enhanced with derived taken status
        const enhancedPills = enhancePillsWithDerivedStatus(cloudPills);
        setPills(enhancedPills);
        savePillsToStorage(user.id, enhancedPills);
        
        setSyncStatus('synced');
        
        // Check for pending sync from a previous session
        if (hasPendingSync(user.id)) {
          // There was an unsaved change - it's now potentially stale
          // The cloud is authoritative after a fresh load
          setPendingSync(user.id, false);
        }
      } catch (err) {
        console.error('Failed to load from cloud:', err);
        setSyncStatus('error');
        // DO NOT set cloudLoadSucceededRef.current = true here
        // This prevents destructive sync when load fails
      }
    };
    
    loadCloud();
  }, [user]);

  // ─── Persist to localStorage (user-scoped) ──────────────────────────────────
  useEffect(() => {
    if (!user) return;
    savePillsToStorage(user.id, pills);
  }, [pills, user]);

  // ─── Debounced cloud sync (only after successful load) ──────────────────────
  useEffect(() => {
    if (!user) return;
    
    // CRITICAL: Never sync if cloud load hasn't succeeded
    if (!cloudLoadSucceededRef.current) return;
    
    // Mark that there's a pending sync
    setPendingSync(user.id, true);
    
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    setSyncStatus('idle');
    
    syncTimeoutRef.current = window.setTimeout(async () => {
      try {
        setSyncStatus('syncing');
        const result = await syncPillsToCloud(pills, cloudIdsRef.current);
        
        if (result.success) {
          // Update cloud IDs after successful sync
          const newCloudIds = new Set<string>(pills.map(p => p.id));
          cloudIdsRef.current = newCloudIds;
          saveCloudIdsToStorage(user.id, newCloudIds);
          setPendingSync(user.id, false);
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
  }, [pills, user]);

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
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      let hasChanges = false;
      const reAlarmPills: { pillName: string; pillSound?: string; reminderTime: string }[] = [];

      const updatedPills = pillsRef.current.map(pill => {
        const newReminders = pill.reminders.map(reminder => {
          if (reminder.snoozedUntil && reminder.snoozedUntil <= now) {
            hasChanges = true;
            reAlarmPills.push({
              pillName: pill.name,
              pillSound: pill.notificationSound,
              reminderTime: reminder.time,
            });
            const { snoozedUntil, ...rest } = reminder;
            return rest;
          }
          return reminder;
        });
        return { ...pill, reminders: newReminders };
      });

      if (hasChanges) {
        setPills(updatedPills);
        // Re-alarm for each expired snooze
        reAlarmPills.forEach(({ pillName, pillSound, reminderTime }) => {
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

  // ─── Missed dose sweep on load (covers all days since last sweep) ───────────
  useEffect(() => {
    if (!user) return;
    if (!cloudLoadSucceededRef.current) return;
    if (pills.length === 0) return;
    
    const lastSweep = getLastMissedSweepDate(user.id);
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
    setLastMissedSweepDate(user.id, yesterdayStr);
  }, [user, pills.length]); // Depend on pills.length to run after initial load

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
              // On native, OS already delivered the notification — just handle in-app feedback
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
  }, []); // runs once — uses pillsRef so always sees latest pills

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const savePill = async (pillData: Omit<Pill, 'id' | 'history'> | Pill) => {
    let savedPill: Pill;
    if ('id' in pillData && pillData.id) {
      // Editing existing pill - preserve history and don't reset taken status
      const existingPill = pills.find(p => p.id === pillData.id);
      savedPill = {
        ...(pillData as Pill),
        history: existingPill?.history || (pillData as Pill).history || [],
      };
      
      // When editing, preserve the reminders' existing state where possible
      savedPill.reminders = savedPill.reminders.map(newReminder => {
        const existingReminder = existingPill?.reminders.find(r => r.id === newReminder.id);
        return {
          ...newReminder,
          // Preserve snoozedUntil if the reminder existed before
          snoozedUntil: existingReminder?.snoozedUntil,
          // Don't store taken flag - it's derived from history
          taken: false,
        };
      });
      
      setPills(prevPills => prevPills.map(p => (p.id === savedPill.id ? savedPill : p)));
      
      // Cancel old notifications and reschedule with updated schedule
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
        taken: false, // Will be derived from history
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
        
        if (alreadyTaken) {
          // Already taken today - no change
          return pill;
        }
        
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
        
        // Clear snooze when marking taken
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
          // Un-marking: remove the taken entry from history
          const updatedHistory = removeLatestTakenEntry(history, reminderId);
          return {
            ...pill,
            reminders: pill.reminders.map(r =>
              r.id === reminderId ? { ...r, taken: false } : r
            ),
            history: updatedHistory,
          };
        } else {
          // Marking taken: add history entry
          const newHistoryEntry: HistoryEntry = {
            id: `${Date.now()}-${reminderId}`,
            reminderId: reminderId,
            pillName: pill.name,
            time: reminder.time,
            action: 'taken',
            timestamp: Date.now(),
          };
          
          // Clear snooze when marking taken
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

  const handleSignOut = useCallback(async () => {
    try {
      // Flush any pending sync before signing out
      await flushPendingSync();
      // Sign out with user id to clear local data
      await signOut(user?.id);
    } catch (err) {
      console.error('Sign out failed:', err);
    }
  }, [user?.id, flushPendingSync]);

  // ─── Derive taken status for display ────────────────────────────────────────
  // The pills state stores the raw data, but we derive taken status for display
  const displayPills = enhancePillsWithDerivedStatus(pills);

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (authLoading) {
    return (
      <div className="min-h-screen bg-sky-100 flex items-center justify-center">
        <div className="text-slate-500">Loading...</div>
      </div>
    );
  }

  if (!user) return <Auth />;

  return (
    <div className="min-h-screen bg-sky-100 font-sans text-slate-800">
      <div className="container mx-auto max-w-2xl p-4 pb-28">
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
            <button onClick={handleSignOut} className="text-xs text-slate-400 hover:text-slate-600">Sign out</button>
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
