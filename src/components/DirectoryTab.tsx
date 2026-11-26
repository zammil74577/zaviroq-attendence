import React, { useEffect, useState } from 'react';
import { UserPlus, Megaphone, Mail, Clock, Search, Edit3, X, Copy, KeyRound, RefreshCw, Monitor } from 'lucide-react';
import type { DeviceTokenInfo, Employee, ViewMode } from '../types';
import { LiveStatusBadge } from './StatusBadge';
import { Avatar } from './Avatar';

function validatePinClient(pin: string): string | null {
  const s = pin.trim();
  if (!/^\d{6}$/.test(s)) return 'PIN must be exactly 6 digits.';
  if (/^(\d)\1{5}$/.test(s)) return 'PIN cannot be all repeated digits.';
  if ('01234567890123456789'.includes(s) || '98765432109876543210'.includes(s)) {
    return 'PIN cannot be a sequential pattern.';
  }
  return null;
}

function generateStrongPinClient(): string {
  for (let i = 0; i < 30; i++) {
    const c = String(Math.floor(100000 + Math.random() * 900000));
    if (!validatePinClient(c)) return c;
  }
  return '849201';
}

interface DirectoryTabProps {
  employees: Employee[];
  currentUser: Employee | null;
  viewMode: ViewMode;
  onRefresh: () => Promise<void>;
  onAddEmployee: (payload: {
    name: string;
    email: string;
    role: 'admin' | 'manager' | 'employee';
    department: string;
    designation: string;
    shift_start: string;
    shift_end: string;
    joining_date?: string;
  }) => Promise<{ emp_code: string; name: string; tempPin?: string } | null>;
  onPostAnnouncement: (payload: { title: string; message: string; priority: 'normal' | 'important' }) => Promise<void>;
}

export const DirectoryTab: React.FC<DirectoryTabProps> = ({
  employees,
  currentUser,
  viewMode,
  onRefresh,
  onAddEmployee,
  onPostAnnouncement,
}) => {
  const [search, setSearch] = useState('');
  const [directorySubTab, setDirectorySubTab] = useState<'team' | 'devices'>('team');
  const [devices, setDevices] = useState<DeviceTokenInfo[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [allEmployees, setAllEmployees] = useState<Employee[] | null>(null);
  const [showEmpModal, setShowEmpModal] = useState(false);
  const [showAnnModal, setShowAnnModal] = useState(false);
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [tempPinInfo, setTempPinInfo] = useState<{ emp_code: string; name: string; tempPin: string } | null>(null);
  const [copiedTempPin, setCopiedTempPin] = useState(false);

  const [resetPinEmp, setResetPinEmp] = useState<Employee | null>(null);
  const [resetPinVal, setResetPinVal] = useState('');
  const [resetPinConfirm, setResetPinConfirm] = useState('');
  const [resetPinErr, setResetPinErr] = useState<string | null>(null);
  const [resetPinSaving, setResetPinSaving] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'manager' | 'employee'>('employee');
  const [department, setDepartment] = useState('Engineering');
  const [designation, setDesignation] = useState('');
  const [shiftStart, setShiftStart] = useState('09:30');
  const [shiftEnd, setShiftEnd] = useState('17:30');
  const [joiningDate, setJoiningDate] = useState('');

  const [annTitle, setAnnTitle] = useState('');
  const [annMsg, setAnnMsg] = useState('');
  const [annPriority, setAnnPriority] = useState<'normal' | 'important'>('important');

  const loadWithInactive = async () => {
    const res = await fetch('/api/dashboard?includeInactive=true');
    if (res.ok) {
      const json = await res.json();
      setAllEmployees(Array.isArray(json.employees) ? json.employees : []);
    }
  };

  useEffect(() => {
    if (showInactive) {
      loadWithInactive();
    } else {
      setAllEmployees(null);
    }
  }, [showInactive, employees]);

  const loadDevices = async () => {
    const r = await fetch('/api/devices');
    if (r.ok) setDevices(await r.json());
  };

  useEffect(() => {
    if (directorySubTab === 'devices') loadDevices();
  }, [directorySubTab]);

  const sourceList = showInactive && allEmployees ? allEmployees : employees;

  const filtered = sourceList.filter(
    (e) =>
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.emp_code.toLowerCase().includes(search.toLowerCase()) ||
      e.department.toLowerCase().includes(search.toLowerCase()) ||
      e.designation.toLowerCase().includes(search.toLowerCase())
  );

  const handleEmpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const created = await onAddEmployee({
      name,
      email,
      role,
      department,
      designation,
      shift_start: shiftStart,
      shift_end: shiftEnd,
      joining_date: joiningDate || undefined,
    });
    setName('');
    setEmail('');
    setDesignation('');
    setJoiningDate('');
    setShowEmpModal(false);
    if (created?.tempPin) {
      setCopiedTempPin(false);
      setTempPinInfo({ emp_code: created.emp_code, name: created.name, tempPin: created.tempPin });
    }
  };

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmp) return;
    const res = await fetch(`/api/employees/${editingEmp.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editingEmp.name,
        department: editingEmp.department,
        designation: editingEmp.designation,
        role: editingEmp.role,
        shift_start: editingEmp.shift_start,
        shift_end: editingEmp.shift_end,
        joining_date: editingEmp.joining_date || undefined,
      }),
    });
    if (res.ok) {
      setEditingEmp(null);
      await onRefresh();
      if (showInactive) await loadWithInactive();
    }
  };

  const handleAnnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onPostAnnouncement({ title: annTitle, message: annMsg, priority: annPriority });
    setAnnTitle('');
    setAnnMsg('');
    setShowAnnModal(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Zaviroq Team Directory</h1>
          <p className="text-xs text-slate-400">
            {employees.length} active workforce members across departments
          </p>
        </div>

        {viewMode === 'admin' && (
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="inline-flex rounded-xl border border-slate-800 bg-slate-900 p-1">
              <button
                type="button"
                onClick={() => setDirectorySubTab('team')}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                  directorySubTab === 'team' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Team
              </button>
              <button
                type="button"
                onClick={() => setDirectorySubTab('devices')}
                className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                  directorySubTab === 'devices' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Monitor className="h-3.5 w-3.5" />
                Devices
              </button>
            </div>
            <button
              onClick={() => setShowAnnModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-200 cursor-pointer"
            >
              <Megaphone className="h-3.5 w-3.5 text-indigo-400" />
              Post Announcement
            </button>
            <button
              onClick={() => setShowEmpModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-3.5 py-2 text-xs font-semibold text-white cursor-pointer"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Add Employee
            </button>
          </div>
        )}
      </div>

      {/* Search + Show Inactive filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employees by name, code, department..."
            className="w-full rounded-xl border border-slate-800 bg-slate-900/80 pl-9 pr-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
          />
        </div>
        {viewMode === 'admin' && (
          <label className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded border-slate-700 bg-slate-950"
            />
            Show inactive
          </label>
        )}
      </div>

      {actionMsg && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-2 text-xs text-amber-200 flex items-center justify-between">
          <span>{actionMsg}</span>
          <button onClick={() => setActionMsg(null)} className="underline cursor-pointer">Dismiss</button>
        </div>
      )}

      {directorySubTab === 'devices' && viewMode === 'admin' ? (
        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/70">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Device</th>
                <th className="px-4 py-3">Platform</th>
                <th className="px-4 py-3">Version</th>
                <th className="px-4 py-3">Last Seen</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-xs">
              {devices.map((d) => (
                <tr key={d.id} className="hover:bg-slate-800/30">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-white">{d.employee_name}</div>
                    <div className="text-[11px] text-slate-400">{d.emp_code} • {d.department}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-200">{d.device_name}</td>
                  <td className="px-4 py-3 capitalize text-slate-300">{d.platform}</td>
                  <td className="px-4 py-3 font-mono-num text-slate-400">{d.app_version}</td>
                  <td className="px-4 py-3 font-mono-num text-slate-400">
                    {d.last_seen_at ? String(d.last_seen_at).slice(0, 16).replace('T', ' ') : 'Never'}
                  </td>
                  <td className="px-4 py-3">
                    {d.revoked_at ? (
                      <span className="rounded-md border border-slate-600 bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
                        Revoked
                      </span>
                    ) : (
                      <span className="rounded-md border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                        Active
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {!d.revoked_at && (
                      <button
                        type="button"
                        onClick={async () => {
                          const r = await fetch(`/api/devices/${d.id}/revoke`, { method: 'POST' });
                          if (r.ok) {
                            setActionMsg(`Revoked device ${d.device_name}.`);
                            await loadDevices();
                          }
                        }}
                        className="rounded-lg border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 px-2.5 py-1 text-[11px] font-semibold text-rose-300 cursor-pointer"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {devices.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400">No desktop devices paired yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((emp) => {
          const isSelf = currentUser?.id === emp.id;
          return (
            <div
              key={emp.id}
              className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-3 hover:border-slate-700 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <Avatar
                    name={emp.name}
                    color={emp.avatar_color}
                    url={emp.avatar_url}
                    className="h-11 w-11 text-sm"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">{emp.name}</span>
                      {(emp.is_active === false || emp.is_active === 0) && (
                        <span className="rounded-md border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
                          Inactive
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400">{emp.designation}</div>
                  </div>
                </div>
                <LiveStatusBadge status={emp.status} />
              </div>

              <div className="space-y-1.5 text-xs text-slate-400 pt-2 border-t border-slate-800/80">
                <div className="flex items-center justify-between">
                  <span>Code & Dept:</span>
                  <span className="text-slate-200 font-medium">
                    {emp.emp_code} • {emp.department}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <Mail className="h-3.5 w-3.5" /> Email:
                  </span>
                  <span className="text-slate-300">{emp.email}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" /> Shift:
                  </span>
                  <span className="font-mono-num text-slate-200">
                    {emp.shift_start} – {emp.shift_end}
                  </span>
                </div>
                {viewMode === 'admin' && emp.clock_in && !emp.clock_out && (
                  <div className="flex items-center justify-between">
                    <span>Tracker:</span>
                    <span className="text-[11px] font-medium text-indigo-300">
                      {emp.tracking_mode === 'desktop'
                        ? 'Desktop app'
                        : emp.tracking_mode === 'app_system'
                        ? 'Browser app'
                        : 'Tab'}
                    </span>
                  </div>
                )}
                {viewMode === 'admin' && (
                  <div className="pt-2 flex items-center gap-2">
                    <button
                      onClick={() => setEditingEmp({ ...emp })}
                      className="inline-flex items-center justify-center gap-1 flex-1 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 py-1.5 text-[11px] font-semibold text-slate-200 cursor-pointer"
                    >
                      <Edit3 className="h-3 w-3" /> Edit
                    </button>
                    <button
                      onClick={() => {
                        setResetPinEmp(emp);
                        setResetPinVal('');
                        setResetPinConfirm('');
                        setResetPinErr(null);
                      }}
                      className="flex-1 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 py-1.5 text-[11px] font-semibold text-slate-200 cursor-pointer"
                    >
                      Reset PIN
                    </button>
                    {(emp.is_active === false || emp.is_active === 0) ? (
                      <button
                        onClick={async () => {
                          const r = await fetch(`/api/employees/${emp.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ is_active: 1 }),
                          });
                          const j = await r.json();
                          if (!r.ok) {
                            setActionMsg(j.error || 'Failed to reactivate employee');
                            return;
                          }
                          setActionMsg(`Reactivated ${emp.name}.`);
                          await onRefresh();
                          await loadWithInactive();
                        }}
                        className="flex-1 rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 py-1.5 text-[11px] font-semibold text-emerald-300 cursor-pointer"
                      >
                        Reactivate
                      </button>
                    ) : (
                      <button
                        disabled={isSelf}
                        title={isSelf ? 'Cannot deactivate your own account' : 'Deactivate employee'}
                        onClick={async () => {
                          if (!window.confirm(`Deactivate ${emp.name}? History will be preserved.`)) return;
                          const r = await fetch(`/api/employees/${emp.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ is_active: 0 }),
                          });
                          const j = await r.json();
                          if (!r.ok) {
                            setActionMsg(j.error || 'Cannot deactivate employee');
                            return;
                          }
                          await onRefresh();
                          if (showInactive) await loadWithInactive();
                        }}
                        className="flex-1 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-40 py-1.5 text-[11px] font-semibold text-rose-300 cursor-pointer"
                      >
                        Deactivate
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* Edit Employee Modal */}
      {editingEmp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">Edit Employee — {editingEmp.emp_code}</h2>
              <button onClick={() => setEditingEmp(null)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleEditSave} className="space-y-3">
              <input
                required
                value={editingEmp.name}
                onChange={(e) => setEditingEmp({ ...editingEmp, name: e.target.value })}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  required
                  value={editingEmp.department}
                  onChange={(e) => setEditingEmp({ ...editingEmp, department: e.target.value })}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
                <input
                  required
                  value={editingEmp.designation}
                  onChange={(e) => setEditingEmp({ ...editingEmp, designation: e.target.value })}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <select
                  value={editingEmp.role}
                  onChange={(e) => setEditingEmp({ ...editingEmp, role: e.target.value as 'admin' | 'manager' | 'employee' })}
                  className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-white"
                >
                  <option value="employee">Employee</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
                <input
                  type="time"
                  value={editingEmp.shift_start}
                  onChange={(e) => setEditingEmp({ ...editingEmp, shift_start: e.target.value })}
                  className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-white"
                />
                <input
                  type="time"
                  value={editingEmp.shift_end}
                  onChange={(e) => setEditingEmp({ ...editingEmp, shift_end: e.target.value })}
                  className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-white"
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs text-slate-400">Joining Date</label>
                <input
                  type="date"
                  value={editingEmp.joining_date ? String(editingEmp.joining_date).slice(0, 10) : ''}
                  onChange={(e) => setEditingEmp({ ...editingEmp, joining_date: e.target.value })}
                  className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-white"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setEditingEmp(null)} className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300">
                  Cancel
                </button>
                <button type="submit" className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-semibold text-white cursor-pointer">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Employee Modal */}
      {showEmpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">Add Zaviroq Employee</h2>
              <button onClick={() => setShowEmpModal(false)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleEmpSubmit} className="space-y-3">
              <input required placeholder="Full Name" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
              <input required type="email" placeholder="Work Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
              <div className="grid grid-cols-2 gap-3">
                <input required placeholder="Department" value={department} onChange={(e) => setDepartment(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
                <input required placeholder="Designation" value={designation} onChange={(e) => setDesignation(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'manager' | 'employee')} className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-white">
                  <option value="employee">Employee</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
                <input type="time" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-white" />
                <input type="time" value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-white" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs text-slate-400">Joining Date</label>
                <input type="date" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-white" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowEmpModal(false)} className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300">Cancel</button>
                <button type="submit" className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-semibold text-white cursor-pointer">Save Employee</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Post Announcement Modal */}
      {showAnnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">Broadcast Team Announcement</h2>
              <button onClick={() => setShowAnnModal(false)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleAnnSubmit} className="space-y-3">
              <input required placeholder="Announcement Title" value={annTitle} onChange={(e) => setAnnTitle(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
              <textarea required rows={3} placeholder="Message to all Zaviroq employees..." value={annMsg} onChange={(e) => setAnnMsg(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
              <select value={annPriority} onChange={(e) => setAnnPriority(e.target.value as 'normal' | 'important')} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
                <option value="important">Important Banner</option>
                <option value="normal">Normal Update</option>
              </select>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowAnnModal(false)} className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300">Cancel</button>
                <button type="submit" className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-semibold text-white cursor-pointer">Publish</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Copy-Once Onboarding PIN Modal */}
      {tempPinInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-emerald-500/40 bg-slate-900 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-emerald-400" />
                Temporary Onboarding PIN
              </h2>
              <button onClick={() => setTempPinInfo(null)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-xs text-slate-300">
              Employee <strong>{tempPinInfo.name}</strong> ({tempPinInfo.emp_code}) created. Share this with the employee; it won&apos;t be shown again. They will be forced to set a new PIN on first login.
            </p>
            <div className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-950 px-4 py-3">
              <span className="font-mono-num text-2xl font-bold tracking-widest text-emerald-300">
                {tempPinInfo.tempPin}
              </span>
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard?.writeText(tempPinInfo.tempPin).catch(() => {});
                  setCopiedTempPin(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white cursor-pointer"
              >
                <Copy className="h-3.5 w-3.5" />
                {copiedTempPin ? 'Copied!' : 'Copy PIN'}
              </button>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setTempPinInfo(null)}
                className="rounded-xl bg-slate-800 hover:bg-slate-700 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset PIN Modal */}
      {resetPinEmp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Reset PIN — {resetPinEmp.name}</h2>
              <button onClick={() => setResetPinEmp(null)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const err = validatePinClient(resetPinVal);
                if (err) {
                  setResetPinErr(err);
                  return;
                }
                if (resetPinVal.trim() !== resetPinConfirm.trim()) {
                  setResetPinErr('PINs do not match.');
                  return;
                }
                setResetPinSaving(true);
                setResetPinErr(null);
                try {
                  const r = await fetch(`/api/employees/${resetPinEmp.id}/reset-pin`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ newPin: resetPinVal.trim() }),
                  });
                  const j = await r.json();
                  if (!r.ok) {
                    setResetPinErr(j.error || 'Failed to reset PIN');
                    return;
                  }
                  setActionMsg(`PIN reset for ${resetPinEmp.name}.`);
                  setResetPinEmp(null);
                } finally {
                  setResetPinSaving(false);
                }
              }}
              className="space-y-3"
            >
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-400">New 6-digit PIN</label>
                <button
                  type="button"
                  onClick={() => {
                    const gen = generateStrongPinClient();
                    setResetPinVal(gen);
                    setResetPinConfirm(gen);
                    setResetPinErr(null);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-300 hover:text-indigo-200 cursor-pointer"
                >
                  <RefreshCw className="h-3 w-3" />
                  Auto-generate
                </button>
              </div>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                required
                placeholder="Enter 6-digit PIN"
                value={resetPinVal}
                onChange={(e) => setResetPinVal(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                required
                placeholder="Confirm 6-digit PIN"
                value={resetPinConfirm}
                onChange={(e) => setResetPinConfirm(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
              {resetPinErr && <div className="text-xs text-rose-300">{resetPinErr}</div>}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResetPinEmp(null)}
                  className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resetPinSaving}
                  className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
                >
                  {resetPinSaving ? 'Saving...' : 'Save PIN'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
