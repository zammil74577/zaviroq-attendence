import React, { useEffect, useState } from 'react';
import { Calendar, Download, FileSpreadsheet } from 'lucide-react';
import type { DashboardData, Employee, MonthlyReportData, ViewMode } from '../types';
import { formatClockTime, formatCurrency, formatHM, getCurrentMonthISO } from '../utils/format';
import { AttendanceBadge } from './StatusBadge';

interface ReportsTabProps {
  data: DashboardData;
  selectedDate: string;
  onChangeDate: (date: string) => void;
  viewMode: ViewMode;
  myMonthlyOnly?: boolean;
  currentUser: Employee | null;
}

export const ReportsTab: React.FC<ReportsTabProps> = ({
  data,
  selectedDate,
  onChangeDate,
  viewMode,
  myMonthlyOnly = false,
  currentUser,
}) => {
  const [reportMode, setReportMode] = useState<'daily' | 'monthly'>('monthly');
  const [month, setMonth] = useState<string>(getCurrentMonthISO());
  const [monthly, setMonthly] = useState<MonthlyReportData | null>(null);
  const [loadingMonthly, setLoadingMonthly] = useState<boolean>(true);
  const [errorMonthly, setErrorMonthly] = useState<string | null>(null);

  const loadMonthly = async () => {
    setLoadingMonthly(true);
    setErrorMonthly(null);
    try {
      const endpoint = myMonthlyOnly ? `/api/reports/me?month=${month}` : `/api/reports/monthly?month=${month}`;
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error(`Failed to load monthly report (${res.status})`);
      setMonthly(await res.json());
    } catch (err) {
      setErrorMonthly(err instanceof Error ? err.message : 'Failed to load monthly report');
    } finally {
      setLoadingMonthly(false);
    }
  };

  useEffect(() => {
    loadMonthly();
  }, [month, myMonthlyOnly]);

  const dailyEmployees =
    viewMode === 'employee' && currentUser
      ? data.employees.filter((e) => e.id === currentUser.id)
      : data.employees;

  const monthlyRows =
    monthly?.rows.filter((r) => viewMode === 'admin' || !currentUser || r.employee_id === currentUser.id) || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">
            {myMonthlyOnly ? 'My Monthly Report' : 'Daily & Monthly Reports'}
          </h1>
          <p className="text-xs text-slate-400">
            {myMonthlyOnly
              ? 'Your monthly attendance, attended days, overtime & payslip breakdown'
              : 'Audited entry/exit logs, monthly attendance rollups, overtime, and payroll summaries'}
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {!myMonthlyOnly && (
            <div className="inline-flex rounded-xl border border-slate-800 bg-slate-900 p-1">
              <button
                onClick={() => setReportMode('daily')}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                  reportMode === 'daily' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Daily Report
              </button>
              <button
                onClick={() => setReportMode('monthly')}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                  reportMode === 'monthly' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Monthly Report
              </button>
            </div>
          )}

          {!myMonthlyOnly && reportMode === 'daily' ? (
            <>
              <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-1.5">
                <Calendar className="h-4 w-4 text-slate-400" />
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => onChangeDate(e.target.value)}
                  className="bg-transparent text-xs text-slate-200 focus:outline-none"
                />
              </div>
              <a
                href={`/api/export/attendance?date=${selectedDate}`}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-white"
              >
                <Download className="h-3.5 w-3.5" />
                Daily CSV
              </a>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-1.5">
                <FileSpreadsheet className="h-4 w-4 text-slate-400" />
                <input
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="bg-transparent text-xs text-slate-200 focus:outline-none"
                />
              </div>
            <a
              href={myMonthlyOnly ? `/api/export/me?month=${month}` : `/api/export/monthly?month=${month}`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-white"
            >
              <Download className="h-3.5 w-3.5" />
              {myMonthlyOnly ? 'My CSV' : 'Monthly CSV'}
            </a>
            </>
          )}
        </div>
      </div>

      {!myMonthlyOnly && reportMode === 'daily' ? (
        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/70">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Shift Schedule</th>
                <th className="px-4 py-3">Enter Time</th>
                <th className="px-4 py-3">Exit Time</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">Idle</th>
                <th className="px-4 py-3">Overtime</th>
                <th className="px-4 py-3">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {dailyEmployees.map((emp) => (
                <tr key={emp.id} className="hover:bg-slate-800/30">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-white">{emp.name}</div>
                    <div className="text-[11px] text-slate-400">{emp.emp_code} • {emp.department}</div>
                  </td>
                  <td className="px-4 py-3"><AttendanceBadge status={emp.attendance_status} /></td>
                  <td className="px-4 py-3 font-mono-num text-xs text-slate-400">{emp.shift_start}–{emp.shift_end}</td>
                  <td className="px-4 py-3 font-mono-num text-xs text-emerald-300">{formatClockTime(emp.clock_in)}</td>
                  <td className="px-4 py-3 font-mono-num text-xs text-rose-300">{formatClockTime(emp.clock_out)}</td>
                  <td className="px-4 py-3 font-mono-num text-xs text-slate-200">{formatHM(emp.active_seconds)}</td>
                  <td className="px-4 py-3 font-mono-num text-xs text-amber-300">{formatHM(emp.idle_seconds)}</td>
                  <td className="px-4 py-3 font-mono-num text-xs text-cyan-300">{formatHM(emp.overtime_seconds)}</td>
                  <td className="px-4 py-3 text-xs text-slate-400 max-w-xs truncate">{emp.attendance_notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : errorMonthly ? (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-950/40 p-5 flex items-center justify-between gap-3 text-xs text-rose-200">
          <span>{errorMonthly}</span>
          <button
            onClick={loadMonthly}
            className="rounded-lg bg-rose-600 hover:bg-rose-500 px-3 py-1.5 font-semibold text-white cursor-pointer"
          >
            Retry
          </button>
        </div>
      ) : loadingMonthly && !monthly ? (
        <div className="h-64 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/70 flex items-center justify-center text-xs text-slate-400">
          Loading monthly report...
        </div>
      ) : (
        <div className="space-y-5">
          {myMonthlyOnly && monthlyRows[0] && (() => {
            const s = monthlyRows[0].salary;
            const allowances = s.hra + s.transport_allowance + s.special_allowance;
            return (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="rounded-xl border border-slate-800 bg-slate-900/75 p-3">
                  <div className="text-[11px] text-slate-400">Base Salary</div>
                  <div className="mt-1 text-sm font-bold text-white font-mono-num">{formatCurrency(s.base_monthly_salary, s.currency)}</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/75 p-3">
                  <div className="text-[11px] text-slate-400">Allowances</div>
                  <div className="mt-1 text-sm font-bold text-slate-200 font-mono-num">{formatCurrency(allowances, s.currency)}</div>
                </div>
                <div className="rounded-xl border border-cyan-500/20 bg-slate-900/75 p-3">
                  <div className="text-[11px] text-slate-400">OT Pay</div>
                  <div className="mt-1 text-sm font-bold text-cyan-300 font-mono-num">+{formatCurrency(s.overtime_pay, s.currency)}</div>
                </div>
                <div className="rounded-xl border border-rose-500/20 bg-slate-900/75 p-3">
                  <div className="text-[11px] text-slate-400">PF / Tax</div>
                  <div className="mt-1 text-sm font-bold text-rose-300 font-mono-num">-{formatCurrency(s.pf_deduction + s.tax_deduction, s.currency)}</div>
                </div>
                <div className="rounded-xl border border-amber-500/20 bg-slate-900/75 p-3">
                  <div className="text-[11px] text-slate-400">LOP Deduction</div>
                  <div className="mt-1 text-sm font-bold text-amber-300 font-mono-num">-{formatCurrency(s.unpaid_deduction, s.currency)}</div>
                </div>
                <div className="rounded-xl border border-emerald-500/25 bg-slate-900/75 p-3">
                  <div className="text-[11px] text-slate-400">MTD / Projected Net</div>
                  <div className="mt-1 text-sm font-bold text-emerald-300 font-mono-num">
                    {formatCurrency(s.prorated_net_salary ?? s.net_salary, s.currency)}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono-num">
                    Proj: {formatCurrency(s.net_salary, s.currency)}
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/70">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-3.5 py-3">Employee</th>
                <th className="px-3.5 py-3">Attended</th>
                <th className="px-3.5 py-3">Present</th>
                <th className="px-3.5 py-3">Late</th>
                <th className="px-3.5 py-3">Half</th>
                <th className="px-3.5 py-3">Leave</th>
                <th className="px-3.5 py-3">Absent</th>
                <th className="px-3.5 py-3">Active Hrs</th>
                <th className="px-3.5 py-3">Idle Hrs</th>
                <th className="px-3.5 py-3">OT Hrs</th>
                <th className="px-3.5 py-3">Tasks Done</th>
                <th className="px-3.5 py-3">Net Payable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {monthlyRows.map((r) => (
                <tr key={r.employee_id} className="hover:bg-slate-800/30">
                  <td className="px-3.5 py-3">
                    <div className="font-semibold text-white">{r.name}</div>
                    <div className="text-[11px] text-slate-400">{r.emp_code} • {r.department}</div>
                  </td>
                  <td className="px-3.5 py-3 font-mono-num text-xs font-bold text-indigo-300">
                    {r.present_days + r.late_days + r.half_days}
                  </td>
                  <td className="px-3.5 py-3 font-mono-num text-xs font-semibold text-emerald-300">{r.present_days}</td>
                  <td className="px-3.5 py-3 font-mono-num text-xs text-amber-300">{r.late_days}</td>
                  <td className="px-3.5 py-3 font-mono-num text-xs text-indigo-300">{r.half_days}</td>
                  <td className="px-3.5 py-3 font-mono-num text-xs text-sky-300">{r.leave_days}</td>
                  <td className="px-3.5 py-3 font-mono-num text-xs text-rose-300">{r.absent_days}</td>
                  <td className="px-3.5 py-3 font-mono-num text-xs text-slate-200">
                    {(r.total_active_seconds / 3600).toFixed(1)}h
                  </td>
                  <td className="px-3.5 py-3 font-mono-num text-xs text-amber-300">
                    {(r.total_idle_seconds / 3600).toFixed(1)}h
                  </td>
                  <td className="px-3.5 py-3 font-mono-num text-xs text-cyan-300">
                    {(r.total_overtime_seconds / 3600).toFixed(1)}h
                  </td>
                  <td className="px-3.5 py-3 font-mono-num text-xs text-slate-200">
                    {r.tasks_completed} / {r.tasks_completed + r.tasks_pending}
                  </td>
                  <td className="px-3.5 py-3 font-mono-num text-xs font-bold text-emerald-300 whitespace-nowrap">
                    <div>
                      {monthly?.isCurrentMonth && r.salary.prorated_net_salary !== undefined
                        ? `MTD: ${formatCurrency(r.salary.prorated_net_salary, r.salary.currency)}`
                        : formatCurrency(r.salary.net_salary, r.salary.currency)}
                    </div>
                    {monthly?.isCurrentMonth && (
                      <div className="text-[10px] font-normal text-slate-400">
                        Proj: {formatCurrency(r.salary.net_salary, r.salary.currency)}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
};
