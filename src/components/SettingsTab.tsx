import React, { useEffect, useState } from 'react';
import { Save, CalendarPlus, Trash2, Bell, BellRing, Monitor, Download } from 'lucide-react';
import type { AlertRule, DeviceTokenInfo, Holiday, OfficeSchedule } from '../types';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function parseJsonVal<T>(v: T | string, fallback: T): T {
  if (typeof v !== 'string') return v ?? fallback;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}

interface SettingsTabProps {
  onSaved: () => Promise<void>;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({ onSaved }) => {
  const [activeSubTab, setActiveSubTab] = useState<'general' | 'alerts' | 'desktop'>('general');
  const [settings, setSettings] = useState<OfficeSchedule | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [devices, setDevices] = useState<DeviceTokenInfo[]>([]);
  const [totalActiveEmployees, setTotalActiveEmployees] = useState<number>(0);
  const [pushEnabled, setPushEnabled] = useState<boolean>(false);
  const [pushBusy, setPushBusy] = useState<boolean>(false);
  const [newHolidayDate, setNewHolidayDate] = useState('');
  const [newHolidayName, setNewHolidayName] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadAll = async () => {
    const [sRes, hRes, aRes, dRes, dashRes] = await Promise.all([
      fetch('/api/settings'),
      fetch('/api/holidays'),
      fetch('/api/alert-rules'),
      fetch('/api/devices'),
      fetch('/api/dashboard'),
    ]);
    if (sRes.ok) setSettings(await sRes.json());
    if (hRes.ok) setHolidays(await hRes.json());
    if (dRes.ok) setDevices(await dRes.json());
    if (dashRes.ok) {
      const dj = await dashRes.json();
      setTotalActiveEmployees(Array.isArray(dj.employees) ? dj.employees.length : 0);
    }
    if (aRes.ok) {
      const raw: AlertRule[] = await aRes.json();
      setAlertRules(
        raw.map((r) => ({
          ...r,
          enabled: Boolean(r.enabled),
          channels: parseJsonVal<string[]>(r.channels, ['in_app']),
          quiet_hours: parseJsonVal<{ start: string; end: string }>(r.quiet_hours, { start: '22:00', end: '08:00' }),
        }))
      );
    }
  };

  useEffect(() => {
    loadAll();
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      navigator.serviceWorker.ready
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => setPushEnabled(Boolean(sub)))
        .catch(() => {});
    }
  }, []);

  const handleTogglePush = async () => {
    setPushBusy(true);
    setMsg(null);
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setMsg('Web Push is not supported in this browser.');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: existing.endpoint }),
        });
        await existing.unsubscribe();
        setPushEnabled(false);
        setMsg('Push notifications disabled.');
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setMsg('Notification permission denied.');
        return;
      }
      const keyRes = await fetch('/api/push/vapid-key');
      const { publicKey } = await keyRes.json();
      if (!publicKey) {
        setMsg('VAPID_PUBLIC_KEY is not configured on the server.');
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const subJson = sub.toJSON();
      const saveRes = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subJson),
      });
      if (saveRes.ok) {
        setPushEnabled(true);
        setMsg('Push notifications enabled for this device.');
      }
    } finally {
      setPushBusy(false);
    }
  };

  const handleSaveRule = async (rule: AlertRule) => {
    const res = await fetch(`/api/alert-rules/${rule.type}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: Boolean(rule.enabled),
        threshold_minutes: Number(rule.threshold_minutes),
        channels: rule.channels,
        quiet_hours: rule.quiet_hours,
        recipients: rule.recipients,
      }),
    });
    if (res.ok) {
      setMsg(`Saved alert rule "${rule.type}".`);
      await loadAll();
    }
  };

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Organization &amp; Policy Settings</h1>
          <p className="text-xs text-slate-400">
            Configure office timings, late grace period, break allowances, idle thresholds, alerts &amp; holidays
          </p>
        </div>

        <div className="inline-flex rounded-xl border border-slate-800 bg-slate-900 p-1">
          <button
            type="button"
            onClick={() => setActiveSubTab('general')}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer ${
              activeSubTab === 'general' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Policies &amp; Holidays
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('alerts')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer ${
              activeSubTab === 'alerts' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Bell className="h-3.5 w-3.5" />
            Alerts
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('desktop')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer ${
              activeSubTab === 'desktop' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Monitor className="h-3.5 w-3.5" />
            Desktop App
          </button>
        </div>
      </div>

      {msg && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-4 py-2.5 text-xs text-emerald-200">
          {msg}
        </div>
      )}

      {activeSubTab === 'alerts' ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-white">Browser &amp; Mobile Push Notifications</h2>
              <p className="text-xs text-slate-400">
                Receive real-time alerts on desktop, Android, and installed iOS apps.
              </p>
            </div>
            <button
              type="button"
              disabled={pushBusy}
              onClick={handleTogglePush}
              className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold cursor-pointer ${
                pushEnabled
                  ? 'border border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white'
              }`}
            >
              <BellRing className="h-3.5 w-3.5" />
              {pushBusy ? 'Updating...' : pushEnabled ? 'Notifications Enabled ✓' : 'Enable notifications'}
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {alertRules.map((rule) => {
              const channels = Array.isArray(rule.channels) ? rule.channels : [];
              const qh = typeof rule.quiet_hours === 'object' && rule.quiet_hours ? rule.quiet_hours : { start: '22:00', end: '08:00' };
              const updateRule = (patch: Partial<AlertRule>) =>
                setAlertRules((prev) => prev.map((r) => (r.type === rule.type ? { ...r, ...patch } : r)));

              return (
                <div key={rule.type} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-white font-mono-num">{rule.type}</span>
                    <label className="inline-flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(rule.enabled)}
                        onChange={(e) => updateRule({ enabled: e.target.checked })}
                      />
                      Enabled
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 text-xs">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Threshold (mins)</label>
                      <input
                        type="number"
                        value={rule.threshold_minutes}
                        onChange={(e) => updateRule({ threshold_minutes: Number(e.target.value) })}
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Recipients</label>
                      <select
                        value={rule.recipients || 'all'}
                        onChange={(e) => updateRule({ recipients: e.target.value })}
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white"
                      >
                        <option value="all">Admins &amp; Managers (dept)</option>
                        <option value="admins">Admins Only</option>
                        <option value="managers">Managers Only (dept)</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 text-xs">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Quiet Start</label>
                      <input
                        type="time"
                        value={qh.start}
                        onChange={(e) => updateRule({ quiet_hours: { ...qh, start: e.target.value } })}
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Quiet End</label>
                      <input
                        type="time"
                        value={qh.end}
                        onChange={(e) => updateRule({ quiet_hours: { ...qh, end: e.target.value } })}
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-3 text-xs text-slate-300">
                      {(['in_app', 'push', 'email'] as const).map((ch) => (
                        <label key={ch} className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={channels.includes(ch)}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...new Set([...channels, ch])]
                                : channels.filter((c) => c !== ch);
                              updateRule({ channels: next });
                            }}
                          />
                          {ch}
                        </label>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSaveRule(rule)}
                      className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white cursor-pointer"
                    >
                      Save Rule
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : activeSubTab === 'desktop' ? (() => {
        const connectedEmpIds = new Set(devices.filter((d) => !d.revoked_at).map((d) => d.employee_id));
        const connectedCount = connectedEmpIds.size;
        const notConnectedCount = Math.max(0, totalActiveEmployees - connectedCount);
        const releaseBase = 'https://github.com/zammil74577/zaviroq-attendence/releases/latest';
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                <div className="text-xs text-slate-400">Current Agent Version</div>
                <div className="mt-1 text-xl font-bold text-white font-mono-num">v1.0.0</div>
              </div>
              <div className="rounded-2xl border border-emerald-500/25 bg-slate-900/70 p-4">
                <div className="text-xs text-slate-400">Employees Connected</div>
                <div className="mt-1 text-xl font-bold text-emerald-300 font-mono-num">{connectedCount}</div>
              </div>
              <div className="rounded-2xl border border-amber-500/25 bg-slate-900/70 p-4">
                <div className="text-xs text-slate-400">Not Connected</div>
                <div className="mt-1 text-xl font-bold text-amber-300 font-mono-num">{notConnectedCount}</div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
              <div>
                <h2 className="text-base font-semibold text-white">Zaviroq Desktop Agent Distribution</h2>
                <p className="text-xs text-slate-400">
                  Lightweight Windows &amp; macOS tray app for reliable system idle detection, auto-start at login, and offline heartbeat queuing.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <a
                  href={releaseBase}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 text-xs font-semibold text-white"
                >
                  <Download className="h-4 w-4" />
                  Download for Windows (.exe / .msi)
                </a>
                <a
                  href={releaseBase}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-4 py-2.5 text-xs font-semibold text-white"
                >
                  <Download className="h-4 w-4" />
                  Download for macOS (.dmg Universal)
                </a>
              </div>
            </div>
          </div>
        );
      })() : (
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
            <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.prorateAnnualLeave !== false}
                onChange={(e) => setSettings({ ...settings, prorateAnnualLeave: e.target.checked })}
                className="rounded border-slate-700 bg-slate-950"
              />
              Prorate annual leave for joiners (annual × remaining months / 12, rounded down to 0.5)
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
      )}
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
