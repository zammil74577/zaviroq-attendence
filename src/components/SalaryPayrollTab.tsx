import React, { useEffect, useState } from 'react';
import { Edit3, Download, Wallet, Lock, Unlock, X } from 'lucide-react';
import type { Employee, MonthlyReportData, SalaryStructure, ViewMode } from '../types';
import { formatCurrency, getCurrentMonthISO } from '../utils/format';

interface SalaryPayrollTabProps {
  viewMode: ViewMode;
  currentUser: Employee | null;
}

export const SalaryPayrollTab: React.FC<SalaryPayrollTabProps> = ({ viewMode, currentUser }) => {
  const [month, setMonth] = useState<string>(getCurrentMonthISO());
  const [report, setReport] = useState<MonthlyReportData | null>(null);
  const [editing, setEditing] = useState<SalaryStructure | null>(null);
  const [saving, setSaving] = useState(false);

  const loadPayroll = async () => {
    const res = await fetch(`/api/reports/monthly?month=${month}`);
    if (res.ok) setReport(await res.json());
  };

  useEffect(() => {
    loadPayroll();
  }, [month]);

  const handleSaveSalary = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/salaries/${editing.employee_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing),
      });
      if (res.ok) {
        setEditing(null);
        await loadPayroll();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleToggleLock = async () => {
    if (!report) return;
    if (report.locked) {
      await fetch(`/api/payroll/lock/${month}`, { method: 'DELETE' });
    } else {
      await fetch('/api/payroll/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month }),
      });
    }
    await loadPayroll();
  };

  const rows =
    report?.rows.filter((r) => viewMode === 'admin' || !currentUser || r.employee_id === currentUser.id) || [];

  const totalGross = rows.reduce((s, r) => s + r.salary.gross_salary, 0);
  const totalOT = rows.reduce((s, r) => s + r.salary.overtime_pay, 0);
  const totalDed = rows.reduce((s, r) => s + r.salary.total_deductions, 0);
  const totalNet = rows.reduce((s, r) => s + r.salary.net_salary, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Salary Setup & Monthly Payroll</h1>
          <p className="text-xs text-slate-400">
            Configure compensation structures, allowances, PF/tax deductions, overtime rates & net payouts
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
          />
          {viewMode === 'admin' && report && (
            <button
              onClick={handleToggleLock}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold cursor-pointer ${
                report.locked
                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
                  : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              {report.locked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
              {report.locked ? 'Unlock Payroll' : 'Lock Payroll'}
            </button>
          )}
          <a
            href={`/api/export/monthly?month=${month}`}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-indigo-600 hover:bg-indigo-500 px-3.5 py-2 text-xs font-semibold text-white"
          >
            <Download className="h-3.5 w-3.5" />
            Payroll CSV
          </a>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-4">
          <div className="text-xs text-slate-400">Gross Compensation</div>
          <div className="mt-1 text-2xl font-bold text-white font-mono-num">{formatCurrency(totalGross)}</div>
        </div>
        <div className="rounded-2xl border border-cyan-500/20 bg-slate-900/75 p-4">
          <div className="text-xs text-slate-400">Overtime Payouts</div>
          <div className="mt-1 text-2xl font-bold text-cyan-300 font-mono-num">+{formatCurrency(totalOT)}</div>
        </div>
        <div className="rounded-2xl border border-rose-500/20 bg-slate-900/75 p-4">
          <div className="text-xs text-slate-400">Total Deductions (PF/Tax/LOP)</div>
          <div className="mt-1 text-2xl font-bold text-rose-300 font-mono-num">-{formatCurrency(totalDed)}</div>
        </div>
        <div className="rounded-2xl border border-emerald-500/25 bg-slate-900/75 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Net Payable Payroll</span>
            <Wallet className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-1 text-2xl font-bold text-emerald-300 font-mono-num">{formatCurrency(totalNet)}</div>
        </div>
      </div>

      {/* Payroll & Salary Table */}
      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/70">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-4 py-3">Employee</th>
              <th className="px-4 py-3">Base</th>
              <th className="px-4 py-3">Allowances</th>
              <th className="px-4 py-3">Gross</th>
              <th className="px-4 py-3">OT Pay</th>
              <th className="px-4 py-3">PF + Tax</th>
              <th className="px-4 py-3">LOP Ded.</th>
              <th className="px-4 py-3">Net Payable</th>
              {viewMode === 'admin' && <th className="px-4 py-3">Setup</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {rows.map((r) => {
              const s = r.salary;
              const allowances = s.hra + s.transport_allowance + s.special_allowance;
              return (
                <tr key={r.employee_id} className="hover:bg-slate-800/30">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-white">{r.name}</div>
                    <div className="text-[11px] text-slate-400">{r.emp_code} • {r.designation}</div>
                  </td>
                  <td className="px-4 py-3 font-mono-num text-xs text-slate-200">
                    {formatCurrency(s.base_monthly_salary, s.currency)}
                  </td>
                  <td className="px-4 py-3 font-mono-num text-xs text-slate-300">
                    {formatCurrency(allowances, s.currency)}
                  </td>
                  <td className="px-4 py-3 font-mono-num text-xs font-semibold text-white">
                    {formatCurrency(s.gross_salary, s.currency)}
                  </td>
                  <td className="px-3 py-3 font-mono-num text-xs whitespace-nowrap text-cyan-300">
                    +{formatCurrency(s.overtime_pay, s.currency)}
                  </td>
                  <td className="px-3 py-3 font-mono-num text-xs whitespace-nowrap text-rose-300">
                    -{formatCurrency(s.pf_deduction + s.tax_deduction, s.currency)}
                  </td>
                  <td className="px-3 py-3 font-mono-num text-xs whitespace-nowrap text-amber-300">
                    -{formatCurrency(s.unpaid_deduction, s.currency)}
                  </td>
                  <td className="px-3 py-3 font-mono-num text-xs whitespace-nowrap font-bold text-emerald-300">
                    <div>{formatCurrency(s.net_salary, s.currency)}</div>
                    {report?.isCurrentMonth && s.prorated_net_salary !== undefined && (
                      <div className="text-[10px] font-normal text-slate-400">
                        MTD: {formatCurrency(s.prorated_net_salary, s.currency)}
                      </div>
                    )}
                  </td>
                  {viewMode === 'admin' && (
                    <td className="px-4 py-3">
                      <button
                        disabled={Boolean(report?.locked)}
                        onClick={() => setEditing({ ...s, employee_id: r.employee_id, name: r.name })}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 px-2.5 py-1.5 text-xs font-medium text-slate-200 cursor-pointer"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Edit Salary Structure Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">Salary Setup — {editing.name}</h2>
              <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveSalary} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <NumField label="Base Monthly Salary" value={editing.base_monthly_salary} onChange={(v) => setEditing({ ...editing, base_monthly_salary: v })} />
                <NumField label="HRA Allowance" value={editing.hra} onChange={(v) => setEditing({ ...editing, hra: v })} />
                <NumField label="Transport Allowance" value={editing.transport_allowance} onChange={(v) => setEditing({ ...editing, transport_allowance: v })} />
                <NumField label="Special Allowance" value={editing.special_allowance} onChange={(v) => setEditing({ ...editing, special_allowance: v })} />
                <NumField label="PF Deduction" value={editing.pf_deduction} onChange={(v) => setEditing({ ...editing, pf_deduction: v })} />
                <NumField label="Tax (TDS) Deduction" value={editing.tax_deduction} onChange={(v) => setEditing({ ...editing, tax_deduction: v })} />
                <NumField label="Overtime Rate (/hr)" value={editing.overtime_hourly_rate} onChange={(v) => setEditing({ ...editing, overtime_hourly_rate: v })} />
                <NumField label="Working Days / Month" value={editing.working_days_per_month} onChange={(v) => setEditing({ ...editing, working_days_per_month: v })} />
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
                >
                  {saving ? 'Saving...' : 'Save Structure'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

const NumField: React.FC<{ label: string; value: number; onChange: (v: number) => void }> = ({
  label,
  value,
  onChange,
}) => (
  <div>
    <label className="block text-[11px] font-medium text-slate-400 mb-1">{label}</label>
    <input
      type="number"
      min={0}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white font-mono-num focus:border-indigo-500 focus:outline-none"
    />
  </div>
);
