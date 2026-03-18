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
  getNotificationPermission,
  fireImmediateNotification,
  scheduleReminderNotifications,
  cancelAllPillNotifications,
  cancelReminderNotifications,
  registerNotificationListeners,
  isNative,
} from './services/notificationService';

const SYNC_DEBOUNCE_MS = 2000;

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

// ─── Missed dose logging ──────────────────────────────────────────────────────
// Key: stores the last date we ran the end-of-day missed-dose sweep
const MISSED_DOSE_SWEEP_KEY = 'remedi_last_missed_sweep';

const getTodayDateString = () => new Date().toDateString();
const getYesterdayDateString = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toDateString();
};

/**
 * At end of day, any reminder that was scheduled today but not marked taken
 * (and not currently snoozed) is recorded as 'missed' in history.
 * We run this check once per day when the app is open, covering yesterday.
 */
const recordMissedDoses = (pills: Pill[], setPills: React.Dispatch<React.SetStateAction<Pill[]>>) => {
  const lastSweep = localStorage.getItem(MISSED_DOSE_SWEEP_KEY);
  const yesterday = getYesterdayDateString();
  if (lastSweep === yesterday) return; // already ran for yesterday

  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayDay = yesterdayDate.getDay();

  const now = Date.now();
  let anyChanges = false;

  const updatedPills = pills.map(pill => {
    const newHistory = [...(pill.history || [])];
    pill.reminders.forEach(reminder => {
      if (!reminder.daysOfWeek.includes(yesterdayDay)) return; // not scheduled yesterday
      if (reminder.taken) return; // taken today resets at midnight — handled separately

      // Check if there's already a 'taken' or 'missed' entry for yesterday
      const yesterdayStart = new Date(yesterdayDate);
      yesterdayStart.setHours(0, 0, 0, 0);
      const yesterdayEnd = new Date(yesterdayDate);
      yesterdayEnd.setHours(23, 59, 59, 999);

      const alreadyLogged = newHistory.some(h =>
        h.reminderId === reminder.id &&
        h.timestamp >= yesterdayStart.getTime() &&
        h.timestamp <= yesterdayEnd.getTime() &&
        (h.action === 'taken' || h.action === 'missed')
      );

      if (!alreadyLogged) {
        newHistory.push({
          id: `missed-${Date.now()}-${reminder.id}`,
          reminderId: reminder.id,
          pillName: pill.name,
          time: reminder.time,
          action: 'missed',
          timestamp: yesterdayEnd.getTime(),
        });
        anyChanges = true;
      }
    });
    return anyChanges ? { ...pill, history: newHistory } : pill;
  });

  if (anyChanges) {
    setPills(updatedPills);
  }
  localStorage.setItem(MISSED_DOSE_SWEEP_KEY, yesterday);
};

// ─── Reset taken status at midnight ──────────────────────────────────────────
const resetTakenAtMidnight = (setPills: React.Dispatch<React.SetStateAction<Pill[]>>) => {
  setPills(prev => prev.map(pill => ({
    ...pill,
    reminders: pill.reminders.map(r => ({
      ...r,
      taken: false,
      snoozedUntil: undefined,
    })),
  })));
};

// ─── App ──────────────────────────────────────────────────────────────────────

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [notifDismissed, setNotifDismissed] = useState(false);
  const syncTimeoutRef = useRef<number | undefined>(undefined);
  const pillsRef = useRef<Pill[]>([]);

  const [pills, setPills] = useState<Pill[]>(() => {
    try {
      const storedPills = localStorage.getItem('pills');
      if (storedPills) return JSON.parse(storedPills);
    } catch (error) {
      console.error('Failed to parse pills from localStorage', error);
    }
    return [];
  });

  // Keep ref in sync for use inside intervals/callbacks
  useEffect(() => { pillsRef.current = pills; }, [pills]);

  const [isAddPillModalOpen, setAddPillModalOpen] = useState(false);
  const [isChatModalOpen, setChatModalOpen] = useState(false);
  const [isReportOpen, setReportOpen] = useState(false);
  const [pillToEdit, setPillToEdit] = useState<Pill | undefined>(undefined);

  // ── Auth listener ──
  useEffect(() => {
    const { data: { subscription } } = onAuthStateChange(async (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
      if (currentUser) {
        // Request notification permission — native or web
        await requestNotificationPermission();
        if (!isNative()) await requestWebNotificationPermission();
        // Register native notification tap handler
        registerNotificationListeners((pillId, reminderId) => {
          toggleReminderTaken(pillId, reminderId);
        });
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // ── Load from cloud on login ──
  useEffect(() => {
    if (!user) return;
    const loadCloud = async () => {
      try {
        setSyncStatus('syncing');
        const cloudPills = await loadPillsFromCloud();
        if (cloudPills.length > 0) {
          setPills(cloudPills);
          localStorage.setItem('pills', JSON.stringify(cloudPills));
        }
        setSyncStatus('synced');
      } catch (err) {
        console.error('Failed to load from cloud:', err);
        setSyncStatus('error');
      }
    };
    loadCloud();
  }, [user]);

  // ── Persist to localStorage ──
  useEffect(() => {
    try {
      localStorage.setItem('pills', JSON.stringify(pills));
    } catch (error) {
      console.error('Failed to save pills to localStorage', error);
    }
  }, [pills]);

  // ── Debounced cloud sync ──
  useEffect(() => {
    if (!user) return;
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    setSyncStatus('idle');
    syncTimeoutRef.current = window.setTimeout(async () => {
      try {
        setSyncStatus('syncing');
        await syncPillsToCloud(pills);
        setSyncStatus('synced');
      } catch (err) {
        console.error('Cloud sync failed:', err);
        setSyncStatus('error');
      }
    }, SYNC_DEBOUNCE_MS);
    return () => { if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current); };
  }, [pills, user]);

  // ── Snooze expiry check (every 30s) — re-triggers alarm when snooze ends ──
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

  // ── Midnight reset + missed dose sweep ──
  useEffect(() => {
    if (!user) return;
    // Run missed dose sweep on load (covers yesterday)
    recordMissedDoses(pillsRef.current, setPills);

    // Schedule midnight reset
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 5, 0); // 5 seconds past midnight
    const msUntilMidnight = midnight.getTime() - now.getTime();

    const midnightTimeout = setTimeout(() => {
      recordMissedDoses(pillsRef.current, setPills);
      resetTakenAtMidnight(setPills);
    }, msUntilMidnight);

    return () => clearTimeout(midnightTimeout);
  }, [user]);

  // ── Due reminder check (fires at each minute boundary) ──
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

          if (isDue && isToday && !reminder.taken && !isSnoozed) {
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
      savedPill = pillData as Pill;
      setPills(prevPills => prevPills.map(p => (p.id === savedPill.id ? { ...p, ...savedPill } : p)));
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

  const toggleReminderTaken = useCallback((pillId: string, reminderId: string) => {
    setPills(prevPills => prevPills.map(pill => {
      if (pill.id === pillId) {
        let newHistoryEntry: HistoryEntry | undefined;
        const updatedReminders = pill.reminders.map(reminder => {
          if (reminder.id === reminderId) {
            const willBeTaken = !reminder.taken;
            if (willBeTaken) {
              newHistoryEntry = {
                id: `${Date.now()}-${reminderId}`,
                reminderId: reminder.id,
                pillName: pill.name,
                time: reminder.time,
                action: 'taken',
                timestamp: Date.now(),
              };
            }
            const newReminder = { ...reminder, taken: willBeTaken };
            if (newReminder.taken) delete newReminder.snoozedUntil;
            return newReminder;
          }
          return reminder;
        });
        const updatedHistory = newHistoryEntry ? [...(pill.history || []), newHistoryEntry] : pill.history;
        return { ...pill, reminders: updatedReminders, history: updatedHistory };
      }
      return pill;
    }));
  }, []);

  const snoozeReminder = useCallback((pillId: string, reminderId: string, duration: number) => {
    setPills(prevPills => prevPills.map(pill => {
      if (pill.id === pillId) {
        let newHistoryEntry: HistoryEntry | undefined;
        const updatedReminders = pill.reminders.map(reminder => {
          if (reminder.id === reminderId) {
            newHistoryEntry = {
              id: `${Date.now()}-${reminderId}`,
              reminderId: reminder.id,
              pillName: pill.name,
              time: reminder.time,
              action: 'snoozed',
              timestamp: Date.now(),
            };
            return { ...reminder, snoozedUntil: Date.now() + duration, taken: false };
          }
          return reminder;
        });
        const updatedHistory = newHistoryEntry ? [...(pill.history || []), newHistoryEntry] : pill.history;
        return { ...pill, reminders: updatedReminders, history: updatedHistory };
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

  // ─── Render ──────────────────────────────────────────────────────────────────

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
            <button onClick={signOut} className="text-xs text-slate-400 hover:text-slate-600">Sign out</button>
          </div>
        </div>

        <main>
          <PillList
            pills={pills}
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
        <DoctorReport pills={pills} onClose={() => setReportOpen(false)} />
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
