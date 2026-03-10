import React from 'react';
import { Pill } from '../types';
import PillItem from './PillItem';
import { BellIcon, CalendarIcon } from './icons/Icons';

interface PillListProps {
  pills: Pill[];
  onToggleTaken: (pillId: string, reminderId: string) => void;
  onDeletePill: (pillId: string) => void;
  onSnoozeReminder: (pillId: string, reminderId: string, duration: number) => void;
  onEditPill: (pill: Pill) => void;
}

const PillList: React.FC<PillListProps> = ({ pills, onToggleTaken, onDeletePill, onSnoozeReminder, onEditPill }) => {
  const today = new Date().getDay(); // 0 for Sunday, 1 for Monday, etc.

  const pillsForToday = pills
    .map(pill => ({
      ...pill,
      reminders: pill.reminders.filter(r => r.daysOfWeek.includes(today))
    }))
    .filter(pill => pill.reminders.length > 0);

  if (pills.length === 0) {
    return (
      <div className="text-center py-16 px-4 bg-white rounded-lg shadow-sm">
        <BellIcon className="w-16 h-16 mx-auto text-slate-300" />
        <h3 className="mt-4 text-xl font-semibold text-slate-700">No Reminders Yet</h3>
        <p className="mt-1 text-slate-500">Tap the red '+' button to add your first pill.</p>
      </div>
    );
  }

  if (pillsForToday.length === 0) {
     return (
      <div className="text-center py-16 px-4 bg-white rounded-lg shadow-sm">
        <CalendarIcon className="w-16 h-16 mx-auto text-slate-300" />
        <h3 className="mt-4 text-xl font-semibold text-slate-700">All Clear for Today</h3>
        <p className="mt-1 text-slate-500">You have no pills scheduled for today. Enjoy your day!</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {pillsForToday.map(pill => (
        <PillItem 
          key={pill.id} 
          pill={pill} 
          onToggleTaken={onToggleTaken} 
          onDeletePill={onDeletePill}
          onSnoozeReminder={onSnoozeReminder}
          onEditPill={onEditPill}
        />
      ))}
    </div>
  );
};

export default PillList;