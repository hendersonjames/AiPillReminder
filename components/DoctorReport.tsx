// components/DoctorReport.tsx
// Printable / shareable medication adherence report.
// Shows per-medication adherence rates, monthly calendar, and history log.
// Intended to be shared with a doctor at appointments.

import React, { useMemo, useState } from 'react';
import { Pill, HistoryEntry } from '../types';

interface DoctorReportProps {
  pills: Pill[];
  onClose: () => void;
}

type Period = '30' | '90';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const monthNames = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const formatTime12h = (time: string): string => {
  if (!time) return '';
  const [h, m] = time.split(':');
  let hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return `${hour}:${m} ${ampm}`;
};

const getDaysInRange = (days: number): Date[] => {
  const result: Date[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    result.push(d);
  }
  return result;
};

// ─── Adherence calculator ─────────────────────────────────────────────────────

interface AdherenceResult {
  scheduled: number;
  taken: number;
  missed: number;
  snoozed: number;
  rate: number; // 0-100
}

const calcAdherence = (pill: Pill, datesInRange: Date[]): AdherenceResult => {
  let scheduled = 0;
  let taken = 0;
  let missed = 0;
  let snoozed = 0;

  const history = pill.history || [];

  datesInRange.forEach(date => {
    const dayOfWeek = date.getDay();
    const dayStart = date.getTime();
    const dayEnd = dayStart + 86400000 - 1;

    pill.reminders.forEach(reminder => {
      if (!reminder.daysOfWeek.includes(dayOfWeek)) return;
      scheduled++;

      const dayHistory = history.filter(h =>
        h.reminderId === reminder.id &&
        h.timestamp >= dayStart &&
        h.timestamp <= dayEnd
      );

      if (dayHistory.some(h => h.action === 'taken')) {
        taken++;
      } else if (dayHistory.some(h => h.action === 'missed')) {
        missed++;
      } else if (dayHistory.some(h => h.action === 'snoozed')) {
        snoozed++;
      } else {
        // Unknown — count as missed if in the past
        if (dayEnd < Date.now()) missed++;
        // If today and not yet due, don't count
      }
    });
  });

  const rate = scheduled > 0 ? Math.round((taken / scheduled) * 100) : 0;
  return { scheduled, taken, missed, snoozed, rate };
};

// ─── Calendar day status ──────────────────────────────────────────────────────

type DayStatus = 'taken' | 'partial' | 'missed' | 'not-scheduled' | 'future';

const getDayStatus = (pill: Pill, date: Date): DayStatus => {
  if (date > new Date()) return 'future';

  const dayOfWeek = date.getDay();
  const dayStart = date.getTime();
  const dayEnd = dayStart + 86400000 - 1;

  const history = pill.history || [];
  let totalExpected = 0;
  let totalTaken = 0;
  let anyMissed = false;

  pill.reminders.forEach(reminder => {
    if (!reminder.daysOfWeek.includes(dayOfWeek)) return;
    totalExpected++;

    const dayHistory = history.filter(h =>
      h.reminderId === reminder.id &&
      h.timestamp >= dayStart &&
      h.timestamp <= dayEnd
    );

    if (dayHistory.some(h => h.action === 'taken')) {
      totalTaken++;
    } else if (dayEnd < Date.now()) {
      anyMissed = true;
    }
  });

  if (totalExpected === 0) return 'not-scheduled';
  if (totalTaken === totalExpected) return 'taken';
  if (totalTaken > 0) return 'partial';
  if (anyMissed) return 'missed';
  return 'not-scheduled';
};

const dayStatusColors: Record<DayStatus, string> = {
  'taken': 'bg-emerald-500 text-white',
  'partial': 'bg-amber-400 text-white',
  'missed': 'bg-red-400 text-white',
  'not-scheduled': 'bg-slate-100 text-slate-400',
  'future': 'bg-slate-50 text-slate-300',
};

// ─── Rate badge ───────────────────────────────────────────────────────────────

const AdherenceBadge: React.FC<{ rate: number }> = ({ rate }) => {
  const color = rate >= 80 ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
    : rate >= 60 ? 'text-amber-600 bg-amber-50 border-amber-200'
    : 'text-red-600 bg-red-50 border-red-200';
  const label = rate >= 80 ? 'Good' : rate >= 60 ? 'Fair' : 'Needs attention';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${color}`}>
      {rate}% — {label}
    </span>
  );
};

// ─── Calendar grid (last 30 or 90 days, showing current month) ───────────────

const CalendarGrid: React.FC<{ pill: Pill; datesInRange: Date[] }> = ({ pill, datesInRange }) => {
  // Group dates by month for display
  const months: { label: string; dates: Date[] }[] = [];
  datesInRange.forEach(date => {
    const label = `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
    const existing = months.find(m => m.label === label);
    if (existing) {
      existing.dates.push(date);
    } else {
      months.push({ label, dates: [date] });
    }
  });

  return (
    <div className="space-y-4">
      {months.map(({ label, dates }) => {
        // Pad start of month to align with day of week
        const firstDayOfWeek = dates[0].getDay();
        const pads = Array(firstDayOfWeek).fill(null);
        return (
          <div key={label}>
            <p className="text-xs font-semibold text-slate-500 mb-1">{label}</p>
            <div className="grid grid-cols-7 gap-0.5">
              {dayNames.map(d => (
                <div key={d} className="text-center text-xs text-slate-400 pb-1">{d}</div>
              ))}
              {pads.map((_, i) => <div key={`pad-${i}`} />)}
              {dates.map(date => {
                const status = getDayStatus(pill, date);
                return (
                  <div
                    key={date.toISOString()}
                    title={`${date.toLocaleDateString()} — ${status}`}
                    className={`aspect-square rounded-sm flex items-center justify-center text-xs font-medium ${dayStatusColors[status]}`}
                  >
                    {date.getDate()}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

const DoctorReport: React.FC<DoctorReportProps> = ({ pills, onClose }) => {
  const [period, setPeriod] = useState<Period>('30');

  const daysCount = parseInt(period, 10);
  const datesInRange = useMemo(() => getDaysInRange(daysCount), [daysCount]);

  const reportDate = new Date().toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const handlePrint = () => window.print();

  return (
    <div className="fixed inset-0 bg-slate-900/70 z-50 overflow-y-auto">
      {/* Print styles */}
      <style>{`
        @media print {
          body > * { display: none !important; }
          .print-root { display: block !important; position: fixed; top: 0; left: 0; width: 100%; }
          .no-print { display: none !important; }
          .print-page-break { page-break-before: always; }
        }
      `}</style>

      <div className="print-root min-h-screen bg-white max-w-2xl mx-auto p-6">
        {/* ── Header bar (screen only) ── */}
        <div className="no-print flex justify-between items-center mb-4 sticky top-0 bg-white pt-4 pb-2 border-b border-slate-200 z-10">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 text-sm flex items-center gap-1"
            >
              ← Back
            </button>
            <h1 className="text-lg font-bold text-slate-800">Medication Report</h1>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={period}
              onChange={e => setPeriod(e.target.value as Period)}
              className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700"
            >
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
            <button
              onClick={handlePrint}
              className="bg-sky-500 text-white text-sm font-semibold rounded-lg px-4 py-1.5 hover:bg-sky-600 transition-colors"
            >
              🖨 Print / Save PDF
            </button>
          </div>
        </div>

        {/* ── Report Header (printed) ── */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-800">Medication Adherence Report</h1>
          <p className="text-slate-500 text-sm mt-1">Generated by Remedi · {reportDate} · Last {daysCount} days</p>
        </div>

        {/* ── Disclaimer ── */}
        <div className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          <strong>Note for healthcare providers:</strong> This report is generated from
          self-reported data entered by the patient in the Remedi medication reminder app.
          Data accuracy depends on consistent app usage. This is not a certified medical record.
        </div>

        {/* ── Legend ── */}
        <div className="mb-6 flex flex-wrap gap-3 text-xs text-slate-600">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" /> All doses taken</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-amber-400 inline-block" /> Partial doses</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-400 inline-block" /> Missed</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-slate-100 inline-block" /> Not scheduled</span>
        </div>

        {/* ── Empty state ── */}
        {pills.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <p className="text-lg">No medications added yet.</p>
            <p className="text-sm mt-1">Add pills in the main app to generate a report.</p>
          </div>
        )}

        {/* ── Per-medication sections ── */}
        {pills.map((pill, idx) => {
          const adherence = calcAdherence(pill, datesInRange);
          const recentHistory = (pill.history || [])
            .filter(h => {
              const rangeStart = Date.now() - daysCount * 86400000;
              return h.timestamp >= rangeStart;
            })
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 30);

          return (
            <div key={pill.id} className={`mb-8 ${idx > 0 ? 'pt-6 border-t border-slate-200' : ''}`}>
              {/* Pill header */}
              <div className="flex items-start justify-between flex-wrap gap-2 mb-3">
                <div>
                  <h2 className="text-xl font-bold text-slate-800">{pill.name}</h2>
                  {pill.dosage && <p className="text-slate-500 text-sm">{pill.dosage}</p>}
                </div>
                <AdherenceBadge rate={adherence.rate} />
              </div>

              {/* Schedule */}
              <div className="mb-3 text-sm text-slate-600">
                <strong>Schedule:</strong>{' '}
                {pill.reminders.map(r => (
                  <span key={r.id} className="mr-3">
                    {formatTime12h(r.time)}{' '}
                    ({r.daysOfWeek.length === 7 ? 'daily' : r.daysOfWeek.map(d => dayNames[d]).join(', ')})
                  </span>
                ))}
              </div>

              {/* Adherence stats */}
              <div className="grid grid-cols-4 gap-2 mb-4">
                {[
                  { label: 'Scheduled', value: adherence.scheduled, color: 'text-slate-700' },
                  { label: 'Taken', value: adherence.taken, color: 'text-emerald-600' },
                  { label: 'Missed', value: adherence.missed, color: 'text-red-500' },
                  { label: 'Snoozed', value: adherence.snoozed, color: 'text-amber-500' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-slate-50 rounded-xl p-3 text-center">
                    <p className={`text-2xl font-bold ${color}`}>{value}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>

              {/* Calendar */}
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-2">Daily Calendar</h3>
                <CalendarGrid pill={pill} datesInRange={datesInRange} />
              </div>

              {/* History log */}
              {recentHistory.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">Recent History (last {Math.min(30, recentHistory.length)} events)</h3>
                  <div className="space-y-1 max-h-48 overflow-y-auto no-print">
                    {recentHistory.map(entry => (
                      <div key={entry.id} className="flex items-center gap-2 text-sm py-1 border-b border-slate-100 last:border-0">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          entry.action === 'taken' ? 'bg-emerald-500'
                          : entry.action === 'missed' ? 'bg-red-400'
                          : 'bg-amber-400'
                        }`} />
                        <span className="text-slate-500 tabular-nums">
                          {new Date(entry.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          {' '}
                          {new Date(entry.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className={`capitalize font-medium ${
                          entry.action === 'taken' ? 'text-emerald-700'
                          : entry.action === 'missed' ? 'text-red-600'
                          : 'text-amber-600'
                        }`}>{entry.action}</span>
                        <span className="text-slate-400">· {formatTime12h(entry.time)} reminder</span>
                      </div>
                    ))}
                  </div>
                  {/* Print version — show all history flat */}
                  <div className="hidden print:block">
                    {recentHistory.map(entry => (
                      <div key={entry.id} className="flex items-center gap-2 text-xs py-0.5">
                        <span>{entry.action === 'taken' ? '✓' : entry.action === 'missed' ? '✗' : '~'}</span>
                        <span>{new Date(entry.timestamp).toLocaleDateString()} {new Date(entry.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
                        <span className="capitalize">{entry.action}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {recentHistory.length === 0 && (
                <p className="text-sm text-slate-400 italic">No history recorded in this period. Mark doses as taken in the app to build history.</p>
              )}
            </div>
          );
        })}

        {/* ── Report footer ── */}
        <div className="mt-8 pt-4 border-t border-slate-200 text-xs text-slate-400 text-center">
          <p>This report was generated from self-reported data entered by the user in the Remedi medication reminder app.</p>
          <p className="mt-1">It is for personal reference only and is not a substitute for professional medical advice, diagnosis, or treatment.</p>
          <p className="mt-1">Generated {reportDate} · Remedi App</p>
        </div>
      </div>
    </div>
  );
};

export default DoctorReport;
