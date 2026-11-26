import React, { useState } from 'react';
import { Calendar, Download, Search, Edit3, X } from 'lucide-react';
import type { AttendanceStatus, Employee, ViewMode } from '../types';
import { calcProductivity, extractHHMM, formatClockTime, formatHM } from '../utils/format';
import { AttendanceBadge, LiveStatusBadge } from './StatusBadge';
import { Avatar } from './Avatar';

interface AttendanceTabProps {
  employees: Employee[];
  selectedDate: string;
  onChangeDate: (date: string) => void;
  viewMode: ViewMode;
  currentUser: Employee | null;
  onUpdateAttendanceStatus: (
    employeeId: number,
    status: AttendanceStatus,
    clock_in?: string | null,
    clock_out?: string | null
  ) => void;
}

export const AttendanceTab: React.FC<AttendanceTabProps> = ({
  employees,
  selectedDate,
  onChangeDate,
  viewMode,
  currentUser,
  onUpdateAttendanceStatus,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);
  const [editInTime, setEditInTime] = useState('');
  const [editOutTime, setEditOutTime] = useState('');
  const [editStatus, setEditStatus] = useState<AttendanceStatus>('present');

  const openTimeModal = (emp: Employee) => {
    setEditingEmp(emp);
    setEditInTime(extractHHMM(emp.clock_in) || emp.shift_start);
    setEditOutTime(extractHHMM(emp.clock_out) || '');
    setEditStatus(emp.attendance_status);
  };

  const handleSaveEntryExit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmp) return;
    const inIso = editInTime ? new Date(`${selectedDate}T${editInTime}:00`).toISOString() : null;
    const outIso = editOutTime ? new Date(`${selectedDate}T${editOutTime}:00`).toISOString() : null;
    onUpdateAttendanceStatus(editingEmp.id, editStatus, inIso, outIso);
    setEditingEmp(null);
  };

  const visibleEmployees = employees.filter((emp) => {
    if (viewMode === 'employee' && currentUser && emp.id !== currentUser.id) return false;
    const matchesSearch =
      emp.name.toLowerCase().includes(search.toLowerCase()) ||
      emp.emp_code.toLowerCase().includes(search.toLowerCase()) ||
      emp.department.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || emp.attendance_status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Daily Attendance & Shift Logs</h1>
          <p className="text-xs text-slate-400">
            Accurate arrival tracking, net active hours, idle deductions, and overtime
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-1.5">
            <Calendar className="h-4 w-4 text-slate-400" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => onChangeDate(e.target.value)}
              className="bg-transparent text-xs font-medium text-slate-200 focus:outline-none"
            />
          </div>

          {viewMode === 'admin' && (
            <a
              href={`/api/export/attendance?date=${selectedDate}`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-3.5 py-2 text-xs font-semibold text-white transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </a>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by employee name, code, or department..."
            className="w-full rounded-xl border border-slate-800 bg-slate-900/80 pl-9 pr-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none"
        >
          <option value="all">All Attendance Statuses</option>
          <option value="present">Present</option>
          <option value="late">Late</option>
          <option value="half_day">Half Day</option>
          <option value="on_leave">On Leave</option>
          <option value="absent">Absent</option>
        </select>
      </div>

      {/* Mobile Card List (375px+) */}
      <div className="md:hidden space-y-3">
        {visibleEmployees.map((emp) => {
          const prod = calcProductivity(emp.active_seconds, emp.idle_seconds);
          return (
            <div key={emp.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-semibold text-white text-sm">{emp.name}</div>
                  <div className="text-[11px] text-slate-400">{emp.emp_code} • {emp.department}</div>
                </div>
                <LiveStatusBadge status={emp.status} />
              </div>
              <div className="flex items-center justify-between text-xs">
                <AttendanceBadge status={emp.attendance_status} />
                <span className="font-mono-num text-slate-300">
                  In: {formatClockTime(emp.clock_in)} • Out: {formatClockTime(emp.clock_out)}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center text-[11px] font-mono-num">
                <div className="rounded-lg bg-slate-950/70 p-1.5"><div className="text-slate-500 text-[10px]">Active</div><div className="text-emerald-300">{formatHM(emp.active_seconds)}</div></div>
                <div className="rounded-lg bg-slate-950/70 p-1.5"><div className="text-slate-500 text-[10px]">Idle</div><div className="text-amber-300">{formatHM(emp.idle_seconds)}</div></div>
                <div className="rounded-lg bg-slate-950/70 p-1.5"><div className="text-slate-500 text-[10px]">OT</div><div className="text-cyan-300">{formatHM(emp.overtime_seconds)}</div></div>
                <div className="rounded-lg bg-slate-950/70 p-1.5"><div className="text-slate-500 text-[10px]">Focus</div><div className="text-white">{prod}%</div></div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/70">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-3 py-3 whitespace-nowrap">Employee</th>
              <th className="px-3 py-3 whitespace-nowrap">Live State</th>
              <th className="px-3 py-3 whitespace-nowrap">Attendance</th>
              <th className="px-3 py-3 whitespace-nowrap">Enter Time</th>
              <th className="px-3 py-3 whitespace-nowrap">Exit Time</th>
              <th className="px-3 py-3 whitespace-nowrap">Active</th>
              <th className="px-3 py-3 whitespace-nowrap">Idle</th>
              <th className="px-3 py-3 whitespace-nowrap">Break</th>
              <th className="px-3 py-3 whitespace-nowrap">Overtime</th>
              <th className="px-3 py-3 whitespace-nowrap">Productivity</th>
              {viewMode === 'admin' && <th className="px-3 py-3 whitespace-nowrap">Override</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {visibleEmployees.map((emp) => {
              const prod = calcProductivity(emp.active_seconds, emp.idle_seconds);
              return (
                <tr key={emp.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar
                        name={emp.name}
                        color={emp.avatar_color}
                        url={emp.avatar_url}
                        className="h-8 w-8 text-xs"
                      />
                      <div>
                        <div className="font-semibold text-white">{emp.name}</div>
                        <div className="text-[11px] text-slate-400">
                          {emp.emp_code} • {emp.department}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <LiveStatusBadge status={emp.status} />
                      {viewMode === 'admin' && emp.clock_in && !emp.clock_out && (
                        <span
                          className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${
                            emp.tracking_mode === 'desktop'
                              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                              : emp.tracking_mode === 'app_system'
                              ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300'
                              : 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                          }`}
                        >
                          {emp.tracking_mode === 'desktop'
                            ? 'Desktop app'
                            : emp.tracking_mode === 'app_system'
                            ? 'Browser app'
                            : 'Tab'}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <AttendanceBadge status={emp.attendance_status} />
                      {Boolean(emp.missed_clock_out) && (
                        <span className="rounded-md border border-rose-500/40 bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300 whitespace-nowrap">
                          Missed Out
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 font-mono-num text-xs text-slate-300">
                    {formatClockTime(emp.clock_in)}
                  </td>
                  <td className="px-4 py-3.5 font-mono-num text-xs text-slate-300">
                    {formatClockTime(emp.clock_out)}
                  </td>
                  <td className="px-4 py-3.5 font-mono-num text-xs font-semibold text-emerald-300">
                    {formatHM(emp.active_seconds)}
                  </td>
                  <td className="px-4 py-3.5 font-mono-num text-xs font-semibold text-amber-300">
                    {formatHM(emp.idle_seconds)}
                  </td>
                  <td className="px-4 py-3.5 font-mono-num text-xs text-sky-300">
                    <div className="flex items-center gap-1.5">
                      <span>{formatHM(emp.break_seconds)}</span>
                      {emp.break_over_limit && (
                        <span className="rounded bg-rose-500/20 border border-rose-500/40 px-1 py-0.5 text-[9px] font-bold text-rose-300">
                          OVER
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 font-mono-num text-xs font-semibold text-cyan-300">
                    {formatHM(emp.overtime_seconds)}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className={`h-full rounded-full ${
                            prod === null
                              ? 'bg-slate-600'
                              : prod >= 85
                              ? 'bg-emerald-500'
                              : prod >= 70
                              ? 'bg-amber-500'
                              : 'bg-rose-500'
                          }`}
                          style={{ width: `${prod ?? 100}%` }}
                        />
                      </div>
                      <span className="font-mono-num text-xs font-semibold text-slate-200">
                        {prod === null ? '—' : `${prod}%`}
                      </span>
                    </div>
                  </td>
                  {viewMode === 'admin' && (
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <select
                          value={emp.attendance_status}
                          onChange={(e) => onUpdateAttendanceStatus(emp.id, e.target.value as AttendanceStatus)}
                          aria-label={`Set attendance status for ${emp.name}`}
                          className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                        >
                          <option value="present">Present</option>
                          <option value="late">Late</option>
                          <option value="half_day">Half Day</option>
                          <option value="on_leave">On Leave</option>
                          <option value="absent">Absent</option>
                        </select>
                        <button
                          onClick={() => openTimeModal(emp)}
                          title="Edit Enter / Exit Time"
                          className="rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 p-1.5 text-slate-300 cursor-pointer"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {visibleEmployees.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-400">No matching attendance records found.</div>
        )}
      </div>

      {/* Edit Enter / Exit Time Modal */}
      {editingEmp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-white">Enter & Exit Time — {editingEmp.name}</h2>
              <button onClick={() => setEditingEmp(null)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveEntryExit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Enter Time (Clock In)</label>
                <input
                  type="time"
                  value={editInTime}
                  onChange={(e) => setEditInTime(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Exit Time (Clock Out)</label>
                <input
                  type="time"
                  value={editOutTime}
                  onChange={(e) => setEditOutTime(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Attendance Status</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as AttendanceStatus)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                >
                  <option value="present">Present</option>
                  <option value="late">Late</option>
                  <option value="half_day">Half Day</option>
                  <option value="on_leave">On Leave</option>
                  <option value="absent">Absent</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingEmp(null)}
                  className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
                >
                  Save Times
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
