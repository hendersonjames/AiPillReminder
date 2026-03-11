import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Pill, Reminder, HistoryEntry } from './types';
import Header from './components/Header';
import PillList from './components/PillList';
import AddPillModal from './components/AddPillModal';
import ChatModal from './components/ChatModal';
import Auth from './components/Auth';
import { ChatIcon, PlusIcon } from './components/icons/Icons';
import { playSound } from './services/soundService';
import { onAuthStateChange, signOut, type User } from './services/authService';
import { loadPillsFromCloud, syncPillsToCloud } from './services/pillsService';

const SYNC_DEBOUNCE_MS = 2000; // wait 2s after last change before syncing

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const syncTimeoutRef = useRef<number | undefined>(undefined);

  const [pills, setPills] = useState<Pill[]>(() => {
    try {
      const storedPills = localStorage.getItem('pills');
      if (storedPills) return JSON.parse(storedPills);
    } catch (error) {
      console.error('Failed to parse pills from localStorage', error);
    }
    return [];
  });

  const [isAddPillModalOpen, setAddPillModalOpen] = useState(false);
  const [isChatModalOpen, setChatModalOpen] = useState(false);
  const [pillToEdit, setPillToEdit] = useState<Pill | undefined>(undefined);

  // Auth state listener
  useEffect(() => {
    const { data: { subscription } } = onAuthStateChange((currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Load pills from cloud when user logs in
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

  // Sync pills to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem('pills', JSON.stringify(pills));
    } catch (error) {
      console.error('Failed to save pills to localStorage', error);
    }
  }, [pills]);

  // Debounced cloud sync when pills change (only if logged in)
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

  // Check for expired snoozes periodically
  useEffect(() => {
    const interval = setInterval(() => {
      let hasChanges = false;
      const now = Date.now();
      const updatedPills = pills.map(pill => {
        const newReminders = pill.reminders.map(reminder => {
          if (reminder.snoozedUntil && reminder.snoozedUntil <= now) {
            hasChanges = true;
            const { snoozedUntil, ...rest } = reminder;
            return rest;
          }
          return reminder;
        });
        return { ...pill, reminders: newReminders };
      });
      if (hasChanges) setPills(updatedPills);
    }, 1000 * 30);
    return () => clearInterval(interval);
  }, [pills]);

  // Check for due reminders
  useEffect(() => {
    let intervalId: number | undefined;
    const checkReminders = () => {
      const now = new Date();
      const currentTime = now.toTimeString().substring(0, 5);
      const currentDay = now.getDay();
      pills.forEach(pill => {
        pill.reminders.forEach(reminder => {
          const isDue = reminder.time === currentTime;
          const isToday = reminder.daysOfWeek.includes(currentDay);
          const isSnoozed = reminder.snoozedUntil && reminder.snoozedUntil > now.getTime();
          if (isDue && isToday && !reminder.taken && !isSnoozed) {
            playSound(pill.notificationSound);
          }
        });
      });
    };
    const secondsUntilNextMinute = 60 - new Date().getSeconds();
    const timeoutId = setTimeout(() => {
      checkReminders();
      intervalId = window.setInterval(checkReminders, 60 * 1000);
    }, secondsUntilNextMinute * 1000);
    return () => { clearTimeout(timeoutId); if (intervalId) clearInterval(intervalId); };
  }, [pills]);

  const savePill = (pillData: Omit<Pill, 'id' | 'history'> | Pill) => {
    if ('id' in pillData && pillData.id) {
      setPills(prevPills => prevPills.map(p => (p.id === pillData.id ? { ...p, ...pillData } : p)));
    } else {
      const newPill: Pill = { ...pillData, id: Date.now().toString(), history: [] };
      setPills(prevPills => [...prevPills, newPill]);
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
              newHistoryEntry = { id: `${Date.now()}-${reminderId}`, reminderId: reminder.id, pillName: pill.name, time: reminder.time, action: 'taken', timestamp: Date.now() };
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
            newHistoryEntry = { id: `${Date.now()}-${reminderId}`, reminderId: reminder.id, pillName: pill.name, time: reminder.time, action: 'snoozed', timestamp: Date.now() };
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

  const deletePill = useCallback((pillId: string) => {
    setPills(prevPills => prevPills.filter(pill => pill.id !== pillId));
  }, []);

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
        <div className="flex justify-between items-center pt-2 pb-1">
          <Header />
          <div className="flex items-center gap-2">
            {syncStatus === 'syncing' && <span className="text-xs text-sky-500">Syncing...</span>}
            {syncStatus === 'synced' && <span className="text-xs text-green-500">☁ Saved</span>}
            {syncStatus === 'error' && <span className="text-xs text-red-400">Sync failed</span>}
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

      <div className="fixed bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-sky-100 to-transparent pointer-events-none z-30"></div>
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 z-40">
        <button onClick={() => setChatModalOpen(true)}
          className="bg-sky-500 text-white font-semibold rounded-full px-6 py-3 shadow-lg hover:bg-sky-600 transition-transform hover:scale-105 flex items-center gap-2">
          <ChatIcon className="w-6 h-6" /><span>AI Chat</span>
        </button>
        <button onClick={openAddModal}
          className="bg-red-500 text-white font-semibold rounded-full px-6 py-3 shadow-lg hover:bg-red-600 transition-transform hover:scale-105 flex items-center gap-2">
          <PlusIcon className="w-6 h-6" /><span>Add Pill</span>
        </button>
      </div>
    </div>
  );
};

export default App;
