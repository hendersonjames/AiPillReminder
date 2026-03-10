import React, { useState, useCallback, useEffect } from 'react';
import { Pill, Reminder, HistoryEntry } from './types';
import Header from './components/Header';
import PillList from './components/PillList';
import AddPillModal from './components/AddPillModal';
import ChatModal from './components/ChatModal';
import { ChatIcon, PlusIcon } from './components/icons/Icons';
import { playSound } from './services/soundService';

const App: React.FC = () => {
  const [pills, setPills] = useState<Pill[]>(() => {
    try {
      const storedPills = localStorage.getItem('pills');
      if (storedPills) {
        return JSON.parse(storedPills);
      }
    } catch (error) {
      console.error("Failed to parse pills from localStorage", error);
    }
    return [];
  });

  const [isAddPillModalOpen, setAddPillModalOpen] = useState(false);
  const [isChatModalOpen, setChatModalOpen] = useState(false);
  const [pillToEdit, setPillToEdit] = useState<Pill | undefined>(undefined);

  // Save pills to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem('pills', JSON.stringify(pills));
    } catch (error) {
      console.error("Failed to save pills to localStorage", error);
    }
  }, [pills]);


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

      if (hasChanges) {
        setPills(updatedPills);
      }
    }, 1000 * 30); // Check every 30 seconds

    return () => clearInterval(interval);
  }, [pills]);

  // Check for due reminders to play notification sounds
  useEffect(() => {
    let intervalId: number | undefined;

    const checkReminders = () => {
      const now = new Date();
      const currentTime = now.toTimeString().substring(0, 5); // "HH:MM"
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

    // Align the timer to the start of the next minute for accuracy
    const secondsUntilNextMinute = 60 - new Date().getSeconds();
    const timeoutId = setTimeout(() => {
      checkReminders(); // Initial check
      intervalId = window.setInterval(checkReminders, 60 * 1000); // Check every minute after that
    }, secondsUntilNextMinute * 1000);

    // This cleanup function is crucial. It runs when the component unmounts
    // or when the `pills` dependency changes, preventing multiple timers.
    return () => {
      clearTimeout(timeoutId);
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [pills]);

  const savePill = (pillData: Omit<Pill, 'id' | 'history'> | Pill) => {
    if ('id' in pillData && pillData.id) { // This is an update
      setPills(prevPills => 
        prevPills.map(p => (p.id === pillData.id ? { ...p, ...pillData } : p))
      );
    } else { // This is a new pill
      const newPill: Pill = { ...pillData, id: Date.now().toString(), history: [] };
      setPills(prevPills => [...prevPills, newPill]);
    }
    setAddPillModalOpen(false);
    setPillToEdit(undefined);
  };
  
  const openAddModal = () => {
    setPillToEdit(undefined);
    setAddPillModalOpen(true);
  };

  const openEditModal = (pill: Pill) => {
    setPillToEdit(pill);
    setAddPillModalOpen(true);
  };

  const closeModal = () => {
    setAddPillModalOpen(false);
    setPillToEdit(undefined);
  };

  const toggleReminderTaken = useCallback((pillId: string, reminderId: string) => {
    setPills(prevPills =>
      prevPills.map(pill => {
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
              if (newReminder.taken) {
                delete newReminder.snoozedUntil;
              }
              return newReminder;
            }
            return reminder;
          });
          
          const updatedHistory = newHistoryEntry
            ? [...(pill.history || []), newHistoryEntry]
            : pill.history;

          return {
            ...pill,
            reminders: updatedReminders,
            history: updatedHistory,
          };
        }
        return pill;
      })
    );
  }, []);
  
  const snoozeReminder = useCallback((pillId: string, reminderId: string, duration: number) => {
    setPills(prevPills =>
      prevPills.map(pill => {
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
              return { 
                ...reminder, 
                snoozedUntil: Date.now() + duration,
                taken: false,
              };
            }
            return reminder;
          });

          const updatedHistory = newHistoryEntry
            ? [...(pill.history || []), newHistoryEntry]
            : pill.history;

          return {
            ...pill,
            reminders: updatedReminders,
            history: updatedHistory
          };
        }
        return pill;
      })
    );
  }, []);

  const deletePill = useCallback((pillId: string) => {
    setPills(prevPills => prevPills.filter(pill => pill.id !== pillId));
  }, []);


  return (
    <div className="min-h-screen bg-sky-100 font-sans text-slate-800">
      <div className="container mx-auto max-w-2xl p-4 pb-28">
        <Header />
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
        <AddPillModal
          onClose={closeModal}
          onSavePill={savePill}
          pillToEdit={pillToEdit}
        />
      )}
      
      {isChatModalOpen && (
        <ChatModal onClose={() => setChatModalOpen(false)} />
      )}

      <div className="fixed bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-sky-100 to-transparent pointer-events-none z-30"></div>
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 z-40">
         <button
          onClick={() => setChatModalOpen(true)}
          className="bg-sky-500 text-white font-semibold rounded-full px-6 py-3 shadow-lg hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 transition-transform duration-200 hover:scale-105 flex items-center gap-2"
          aria-label="Open AI Chat"
        >
          <ChatIcon className="w-6 h-6" />
          <span>AI Chat</span>
        </button>
        <button
          onClick={openAddModal}
          className="bg-red-500 text-white font-semibold rounded-full px-6 py-3 shadow-lg hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-transform duration-200 hover:scale-105 flex items-center gap-2"
          aria-label="Add new pill"
        >
          <PlusIcon className="w-6 h-6" />
          <span>Add Pill</span>
        </button>
      </div>
    </div>
  );
};

export default App;