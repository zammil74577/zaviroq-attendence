import React, { useEffect, useState } from 'react';
import { Save, CalendarPlus, Trash2 } from 'lucide-react';
import type { Holiday, OfficeSchedule } from '../types';

interface SettingsTabProps {
  onSaved: () => Promise<void>;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({ onSaved }) => {
  const [settings, setSettings] = useState<OfficeSchedule | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [newHolidayDate, setNewHolidayDate] = useState('');
  const [newHolidayName, setNewHolidayName] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadAll = async () => {
    const [sRes, hRes] = await Promise.all([fetch('/api/settings'), fetch('/api/holidays')]);
    if (sRes.ok) setSettings(await sRes.json());
    if (hRes.ok) setHolidays(await hRes.json());
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        setMsg('Settings saved & audited.');
        await onSaved();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHolidayDate || !newHolidayName.trim()) return;
    const res = await fetch('/api/holidays', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: newHolidayDate, name: newHolidayName.trim() }),
    });
    if (res.ok) {
      setNewHolidayDate('');
      setNewHolidayName('');
      await loadAll();
    }
  };

  const handleDeleteHoliday = async (id: number) => {
    await fetch(`/api/holidays/${id}`, { method: 'DELETE' });
    await loadAll();
  };

  if (!settings) {
    return <div className="p-8 text-sm text-slate-400">Loading settings...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Organization & Policy Settings</h1>
        <p className="text-xs text-slate-400">
          Configure office timings, late grace period, break allowances, idle thresholds, late deductions & holidays
        </p>
      </div>

      {msg && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-4 py-2.5 text-xs text-emerald-200">
          {msg}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <form onSubmit={handleSave} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
          <h2 className="text-base font-semibold text-white">Shift, Break & Payroll Policies</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Shift Start" type="time" value={settings.shiftStart} onChange={(v) => setSettings({ ...settings, shiftStart: v })} />
            <Field label="Shift End" type="time" value={settings.shiftEnd} onChange={(v) => setSettings({ ...settings, shiftEnd: v })} />
            <Field label="Late Grace (mins)" type="number" value={String(settings.lateGraceMinutes)} onChange={(v) => setSettings({ ...settings, lateGraceMinutes: Number(v) })} />
            <Field label="Total Break Allowance (mins)" type="number" value={String(settings.totalBreakMinutes)} onChange={(v) => setSettings({ ...settings, totalBreakMinutes: Number(v) })} />
            <Field label="Net Work Hours / Day" type="number" value={String(settings.netWorkHours)} onChange={(v) => setSettings({ ...settings, netWorkHours: Number(v) })} />
            <Field label="Default Idle Threshold (sec)" type="number" value={String(settings.idleThresholdSeconds ?? 60)} onChange={(v) => setSettings({ ...settings, idleThresholdSeconds: Number(v) })} />
            <Field label="Lunch Break Window" type="text" value={settings.lunchBreak} onChange={(v) => setSettings({ ...settings, lunchBreak: v })} />
            <Field label="Tea Break After" type="time" value={settings.teaBreakAfter} onChange={(v) => setSettings({ ...settings, teaBreakAfter: v })} />
          </div>

          <div className="pt-2 border-t border-slate-800 space-y-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">After-Hours Clock-In Policy</label>
              <select
                value={settings.afterHoursClockInMode || 'block'}
                onChange={(e) => setSettings({ ...settings, afterHoursClockInMode: e.target.value })}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
              >
                <option value="block">Block after shift_end + buffer (Default)</option>
                <option value="allow_after_hours">Allow as After-Hours / Overtime session</option>
              </select>
            </div>
            <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(settings.lateDeductionEnabled)}
                onChange={(e) => setSettings({ ...settings, lateDeductionEnabled: e.target.checked })}
                className="rounded border-slate-700 bg-slate-950"
              />
              Enable Late Deduction Policy (every {settings.lateDaysPerHalfDayLop ?? 3} late days = 0.5 day LOP)
            </label>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </form>

        {/* Holiday Calendar */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
          <h2 className="text-base font-semibold text-white">Company Holiday Calendar</h2>
          <p className="text-xs text-slate-400">
            Leave requests automatically skip weekends and holidays listed below.
          </p>

          <form onSubmit={handleAddHoliday} className="flex flex-wrap gap-2">
            <input
              required
              type="date"
              value={newHolidayDate}
              onChange={(e) => setNewHolidayDate(e.target.value)}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
            />
            <input
              required
              placeholder="Holiday Name (e.g. Diwali)"
              value={newHolidayName}
              onChange={(e) => setNewHolidayName(e.target.value)}
              className="flex-1 min-w-[160px] rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-white cursor-pointer"
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              Add
            </button>
          </form>

          <div className="space-y-2 max-h-72 overflow-y-auto">
            {holidays.map((h) => (
              <div key={h.id} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 px-3.5 py-2.5 text-xs">
                <div>
                  <span className="font-mono-num text-indigo-300 font-semibold">{h.date}</span>
                  <span className="ml-2.5 text-white font-medium">{h.name}</span>
                </div>
                <button
                  onClick={() => handleDeleteHoliday(h.id)}
                  className="text-slate-500 hover:text-rose-400 cursor-pointer"
                  aria-label={`Remove ${h.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {holidays.length === 0 && (
              <div className="text-xs text-slate-500 py-4 text-center">No holidays configured yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; type: string; value: string; onChange: (v: string) => void }> = ({
  label,
  type,
  value,
  onChange,
}) => (
  <div>
    <label className="block text-[11px] font-medium text-slate-400 mb-1">{label}</label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white font-mono-num focus:border-indigo-500 focus:outline-none"
    />
  </div>
);
