import React, { useState } from 'react';
import { Pill } from '../types';
import { PillIcon, ClockIcon, CheckCircleIcon, CircleIcon, TrashIcon, SnoozeIcon, SoundIcon, HistoryIcon, EditIcon } from './icons/Icons';
import { soundOptions } from '../services/soundService';

interface PillItemProps {
  pill: Pill;
  onToggleTaken: (pillId: string, reminderId: string) => void;
  onDeletePill: (pillId: string) => void;
  onSnoozeReminder: (pillId: string, reminderId: string, duration: number) => void;
  onEditPill: (pill: Pill) => void;
}

const formatDaysOfWeek = (days: number[]): string => {
  if (days.length === 7) return "Every Day";
  if (days.length === 5 && days.every(d => d >= 1 && d <= 5)) return "Weekdays";
  if (days.length === 2 && days.includes(0) && days.includes(6)) return "Weekends";
  
  const dayMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return days.map(d => dayMap[d]).join(', ');
};

export const formatTime12Hour = (time: string): string => {
  if (!time) return '';
  const [hourString, minute] = time.split(':');
  let hour = parseInt(hourString, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  hour = hour ? hour : 12; // the hour '0' should be '12'
  return `${hour}:${minute} ${ampm}`;
};

const PillItem: React.FC<PillItemProps> = ({ pill, onToggleTaken, onDeletePill, onSnoozeReminder, onEditPill }) => {
  const [snoozeOptionsOpenFor, setSnoozeOptionsOpenFor] = useState<string | null>(null);
  const [isHistoryVisible, setIsHistoryVisible] = useState(false);
  const sortedReminders = [...pill.reminders].sort((a, b) => a.time.localeCompare(b.time));

  const SNOOZE_OPTIONS = [
    { label: '10m', minutes: 10 },
    { label: '15m', minutes: 15 },
    { label: '30m', minutes: 30 },
  ];
  
  const sortedHistory = pill.history ? [...pill.history].sort((a, b) => b.timestamp - a.timestamp) : [];

  return (
    <>
      <div className="bg-white rounded-xl shadow-md overflow-hidden transition-shadow duration-300 hover:shadow-lg">
        <div className="p-5">
          <div className="flex justify-between items-start">
              <div className="flex items-center">
                <div className="flex-shrink-0 bg-sky-100 p-2 rounded-full">
                  <PillIcon className="w-6 h-6 text-sky-600" />
                </div>
                <div className="ml-4">
                  <h3 className="text-xl font-bold text-slate-800">{pill.name}</h3>
                  <div className="flex items-center gap-3 text-sm text-slate-500 mt-1">
                    {pill.dosage && <p>{pill.dosage}</p>}
                    {pill.notificationSound && soundOptions[pill.notificationSound] && (
                      <div className="flex items-center">
                        <SoundIcon className="w-4 h-4 mr-1 text-slate-400" />
                        <span>{soundOptions[pill.notificationSound].split(' ')[0]}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center">
                <div className="relative group">
                    <button 
                        onClick={() => onEditPill(pill)}
                        className="p-2 text-slate-400 hover:text-sky-500 hover:bg-sky-100 rounded-full transition-colors"
                        aria-label={`Edit ${pill.name}`}
                    >
                        <EditIcon className="w-5 h-5" />
                    </button>
                    <span className="absolute bottom-full right-0 mb-2 px-2 py-1 text-xs font-semibold text-white bg-gray-700 rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                        Edit Pill
                    </span>
                </div>
                 <div className="relative group">
                    <button 
                      onClick={() => setIsHistoryVisible(!isHistoryVisible)}
                      className={`p-2 rounded-full transition-colors ${isHistoryVisible ? 'bg-sky-100 text-sky-500' : 'text-slate-400 hover:text-sky-500 hover:bg-sky-100'}`}
                      aria-label={`View history for ${pill.name}`}
                      aria-expanded={isHistoryVisible}
                    >
                      <HistoryIcon className="w-5 h-5" />
                    </button>
                    <span className="absolute bottom-full right-0 mb-2 px-2 py-1 text-xs font-semibold text-white bg-gray-700 rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                        View History
                    </span>
                </div>
                <div className="relative group">
                    <button 
                        onClick={() => onDeletePill(pill.id)}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-100 rounded-full transition-colors"
                        aria-label={`Delete ${pill.name} reminder`}
                    >
                        <TrashIcon className="w-5 h-5" />
                    </button>
                    <span className="absolute bottom-full right-0 mb-2 px-2 py-1 text-xs font-semibold text-white bg-gray-700 rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                        Delete Pill
                    </span>
                </div>
              </div>
          </div>

          {pill.notes && (
            <div className="mt-3 p-3 bg-slate-50 rounded-lg text-sm text-slate-700 border-l-4 border-slate-200">
              {pill.notes}
            </div>
          )}
          
          <div className="mt-4 space-y-3">
            {sortedReminders.map(reminder => {
              const isSnoozed = reminder.snoozedUntil && reminder.snoozedUntil > Date.now();
              return (
                  <div 
                    key={reminder.id}
                    className={`flex items-center justify-between p-3 rounded-lg transition-all duration-200 ${
                      reminder.taken
                        ? 'bg-sky-50'
                        : isSnoozed
                        ? 'bg-red-50'
                        : 'bg-slate-100'
                    }`}
                  >
                    <div 
                      className="flex items-center flex-grow cursor-pointer"
                      onClick={() => onToggleTaken(pill.id, reminder.id)}
                    >
                      {isSnoozed ? (
                        <SnoozeIcon className="w-5 h-5 mr-3 text-red-500 flex-shrink-0" />
                      ) : (
                        <ClockIcon className={`w-5 h-5 mr-3 flex-shrink-0 ${reminder.taken ? 'text-sky-500' : 'text-slate-400'}`} />
                      )}
                      <div className="flex-grow">
                          <span className={`font-medium ${reminder.taken ? 'line-through text-slate-500' : isSnoozed ? 'text-red-700' : 'text-slate-800'}`}>
                          {isSnoozed ? `Snoozed until ${new Date(reminder.snoozedUntil!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : formatTime12Hour(reminder.time)}
                          </span>
                          <p className={`text-xs ${reminder.taken ? 'text-slate-400' : isSnoozed ? 'text-red-600' : 'text-slate-500'}`}>{formatDaysOfWeek(reminder.daysOfWeek)}</p>
                      </div>
                    </div>

                    <div className="flex items-center ml-2">
                      {!reminder.taken && !isSnoozed && (
                        <div className="relative group">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSnoozeOptionsOpenFor(snoozeOptionsOpenFor === reminder.id ? null : reminder.id);
                            }}
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-100 rounded-full transition-colors"
                            aria-label="Snooze reminder"
                          >
                            <SnoozeIcon className="w-5 h-5" />
                          </button>
                          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs font-semibold text-white bg-gray-700 rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                            Snooze
                          </span>
                          {snoozeOptionsOpenFor === reminder.id && (
                            <div className="absolute bottom-full right-0 mb-2 w-max bg-white border border-slate-200 rounded-lg shadow-lg z-10 p-1 flex gap-1 animate-fade-in-up-sm">
                              {SNOOZE_OPTIONS.map(({ label, minutes }) => (
                                  <button
                                      key={minutes}
                                      onClick={(e) => {
                                          e.stopPropagation();
                                          onSnoozeReminder(pill.id, reminder.id, minutes * 60 * 1000);
                                          setSnoozeOptionsOpenFor(null);
                                      }}
                                      className="px-3 py-1 text-sm rounded-md bg-slate-50 hover:bg-sky-100 hover:text-sky-700 text-slate-700 font-medium transition-colors"
                                  >
                                      {label}
                                  </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="relative group">
                        <button 
                          onClick={() => onToggleTaken(pill.id, reminder.id)}
                          className="p-1"
                          aria-label={reminder.taken ? 'Mark as not taken' : 'Mark as taken'}
                        >
                          {reminder.taken ? (
                            <CheckCircleIcon className="w-7 h-7 text-sky-500" />
                          ) : (
                            <CircleIcon className="w-7 h-7 text-slate-300" />
                          )}
                        </button>
                         <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs font-semibold text-white bg-gray-700 rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                            {reminder.taken ? 'Mark as not taken' : 'Mark as taken'}
                        </span>
                      </div>
                    </div>
                  </div>
              )
            })}
          </div>
        </div>
        <div className={`transition-all duration-300 ease-in-out ${isHistoryVisible ? 'max-h-96' : 'max-h-0'}`} style={{overflow: 'hidden'}}>
            <div className="p-5 pt-0">
                <div className="border-t border-slate-200 pt-4">
                <h4 className="text-sm font-bold text-slate-600 mb-3">History Log</h4>
                {sortedHistory.length > 0 ? (
                    <ul className="space-y-3 max-h-40 overflow-y-auto pr-2">
                    {sortedHistory.map((entry) => (
                        <li key={entry.id} className="flex items-start space-x-3">
                        <div className="flex-shrink-0 mt-0.5">
                            {entry.action === 'taken' ? (
                            <CheckCircleIcon className="w-5 h-5 text-sky-500" />
                            ) : (
                            <SnoozeIcon className="w-5 h-5 text-red-500" />
                            )}
                        </div>
                        <div>
                            <p className="font-semibold text-sm text-slate-700">
                            {entry.action === 'taken' ? 'Marked as Taken' : 'Reminder Snoozed'}
                            <span className="font-normal text-slate-500"> at {formatTime12Hour(entry.time)}</span>
                            </p>
                            <p className="text-xs text-slate-500">
                            {new Date(entry.timestamp).toLocaleString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                            })}
                            </p>
                        </div>
                        </li>
                    ))}
                    </ul>
                ) : (
                    <p className="text-sm text-slate-500 text-center py-4">No history recorded yet.</p>
                )}
                </div>
            </div>
        </div>
        <style>{`
          @keyframes fade-in-up-sm {
            0% {
              opacity: 0;
              transform: translateY(4px) scale(0.98);
            }
            100% {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
          .animate-fade-in-up-sm {
            animation: fade-in-up-sm 0.15s ease-out forwards;
          }
        `}</style>
      </div>
    </>
  );
};

export default PillItem;