import React, { useState, useEffect, useCallback } from 'react';
import { Pill, Reminder } from '../types';
import { getQuickSuggestion } from '../services/geminiService';
import { soundOptions } from '../services/soundService';
import { CloseIcon, PlusIcon, SparklesIcon, TrashIcon } from './icons/Icons';

interface AddPillModalProps {
  onClose: () => void;
  onSavePill: (pill: Omit<Pill, 'id' | 'history'> | Pill) => void;
  pillToEdit?: Pill;
}

// A simple debounce hook
const useDebounce = <T,>(value: T, delay: number): T => {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);
        return () => {
            clearTimeout(handler);
        };
    }, [value, delay]);
    return debouncedValue;
};

const WEEK_DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const DayOfWeekPicker: React.FC<{ selectedDays: number[]; onToggleDay: (dayIndex: number) => void }> = ({ selectedDays, onToggleDay }) => {
  return (
    <div className="flex justify-center gap-1 sm:gap-2">
      {WEEK_DAYS.map((day, index) => (
        <button
          key={index}
          type="button"
          onClick={() => onToggleDay(index)}
          className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full text-sm font-bold transition-colors duration-200 ${
            selectedDays.includes(index)
              ? 'bg-sky-500 text-white'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          {day}
        </button>
      ))}
    </div>
  );
};


const AddPillModal: React.FC<AddPillModalProps> = ({ onClose, onSavePill, pillToEdit }) => {
  const isEditMode = !!pillToEdit;
  
  const [name, setName] = useState(pillToEdit?.name || '');
  const [dosage, setDosage] = useState(pillToEdit?.dosage || '');
  const [notes, setNotes] = useState(pillToEdit?.notes || '');
  const [notificationSound, setNotificationSound] = useState(pillToEdit?.notificationSound || 'default');
  const [reminders, setReminders] = useState(
    pillToEdit?.reminders.map(({ time, daysOfWeek }) => ({ time, daysOfWeek })) || 
    [{ time: '09:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }]
  );
  const [suggestion, setSuggestion] = useState('');
  const [isSuggestionLoading, setSuggestionLoading] = useState(false);

  const debouncedName = useDebounce(name, 500);

  useEffect(() => {
    if (debouncedName && debouncedName !== pillToEdit?.name) {
      setSuggestionLoading(true);
      getQuickSuggestion(debouncedName).then(res => {
        setSuggestion(res);
        setSuggestionLoading(false);
      });
    } else {
      setSuggestion('');
    }
  }, [debouncedName, pillToEdit?.name]);

  const handleAddTime = () => {
    setReminders([...reminders, { time: '17:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }]);
  };

  const handleRemoveTime = (index: number) => {
    setReminders(reminders.filter((_, i) => i !== index));
  };

  const handleReminderChange = (index: number, field: 'time' | 'daysOfWeek', value: string | number[]) => {
    const newReminders = [...reminders];
    if (field === 'time' && typeof value === 'string') {
        newReminders[index].time = value;
    } else if (field === 'daysOfWeek' && Array.isArray(value)) {
        newReminders[index].daysOfWeek = value;
    }
    setReminders(newReminders);
  };

  const handleToggleDay = (reminderIndex: number, dayIndex: number) => {
    const newReminders = [...reminders];
    const currentDays = newReminders[reminderIndex].daysOfWeek;
    const newDays = currentDays.includes(dayIndex)
      ? currentDays.filter(d => d !== dayIndex)
      : [...currentDays, dayIndex];
    handleReminderChange(reminderIndex, 'daysOfWeek', newDays.sort());
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name && reminders.length > 0 && reminders.every(r => r.time && r.daysOfWeek.length > 0)) {
       const pillData = {
        name,
        dosage,
        notes,
        notificationSound,
        reminders: reminders.map(r => ({ ...r, id: Math.random().toString(), taken: false })),
      };

      if (isEditMode && pillToEdit) {
        onSavePill({
          ...pillToEdit, // Keeps original id and history
          ...pillData,   // Overwrites with new form data
        });
      } else {
        onSavePill(pillData);
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md m-auto transform transition-all duration-300 scale-100 animate-fade-in-up max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6 sticky top-0 bg-white py-2 -mt-2">
            <h2 className="text-2xl font-bold text-slate-800">{isEditMode ? 'Edit Pill' : 'Add New Pill'}</h2>
            <div className="relative group">
                <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1" aria-label="Close">
                    <CloseIcon className="w-6 h-6" />
                </button>
                <span className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2 py-1 text-xs font-semibold text-white bg-gray-700 rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                    Close
                </span>
            </div>
          </div>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="pill-name" className="block text-sm font-medium text-slate-600 mb-1">Pill Name</label>
              <input
                id="pill-name"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g., Vitamin D"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                required
              />
              {isSuggestionLoading && <p className="text-sm text-slate-400 mt-2">Getting info...</p>}
              {suggestion && !isSuggestionLoading && (
                <div className="mt-2 text-sm flex items-start p-2 bg-sky-50 rounded-md text-sky-700">
                  <SparklesIcon className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
                  <span>{suggestion}</span>
                </div>
              )}
            </div>
            <div>
              <label htmlFor="dosage" className="block text-sm font-medium text-slate-600 mb-1">Dosage (optional)</label>
              <input
                id="dosage"
                type="text"
                value={dosage}
                onChange={e => setDosage(e.target.value)}
                placeholder="e.g., 500mg"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
              />
            </div>
             <div>
              <label htmlFor="notes" className="block text-sm font-medium text-slate-600 mb-1">Notes (optional)</label>
              <textarea
                id="notes"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="e.g., Take with food"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500 min-h-[60px]"
                rows={2}
              />
            </div>
            <div>
              <label htmlFor="notification-sound" className="block text-sm font-medium text-slate-600 mb-1">Notification Sound</label>
              <select
                id="notification-sound"
                value={notificationSound}
                onChange={e => setNotificationSound(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500 bg-white appearance-none"
                style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em' }}
              >
                {Object.entries(soundOptions).map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-2">Reminder Times</label>
              <div className="space-y-4">
                {reminders.map((reminder, index) => (
                  <div key={index} className="p-4 bg-slate-50 rounded-lg space-y-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        value={reminder.time}
                        onChange={e => handleReminderChange(index, 'time', e.target.value)}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                        required
                      />
                      {reminders.length > 1 && (
                         <div className="relative group">
                            <button type="button" onClick={() => handleRemoveTime(index)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-100 rounded-full transition-colors" aria-label="Remove time">
                                <TrashIcon className="w-5 h-5" />
                            </button>
                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs font-semibold text-white bg-gray-700 rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                                Remove Time
                            </span>
                        </div>
                      )}
                    </div>
                    <DayOfWeekPicker 
                        selectedDays={reminder.daysOfWeek}
                        onToggleDay={(dayIndex) => handleToggleDay(index, dayIndex)}
                    />
                  </div>
                ))}
              </div>
               <button type="button" onClick={handleAddTime} className="mt-3 flex items-center text-sm font-semibold text-sky-600 hover:text-sky-800">
                 <PlusIcon className="w-4 h-4 mr-1"/> Add Time
               </button>
            </div>
            <button type="submit" className="w-full bg-sky-500 text-white font-bold py-3 px-4 rounded-lg hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 transition-colors">
              {isEditMode ? 'Update Pill' : 'Save Pill'}
            </button>
          </form>
        </div>
      </div>
       <style>{`
          @keyframes fade-in-up {
            0% {
              opacity: 0;
              transform: translateY(20px) scale(0.95);
            }
            100% {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
          .animate-fade-in-up {
            animation: fade-in-up 0.3s ease-out forwards;
          }
        `}</style>
    </div>
  );
};

export default AddPillModal;