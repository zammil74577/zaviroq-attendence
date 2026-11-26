import React, { useEffect, useMemo, useState } from 'react';
import { CalendarPlus, Check, X as XIcon, CalendarDays } from 'lucide-react';
import type { Employee, Holiday, LeaveBalance, LeaveRequest, LeaveType, ViewMode } from '../types';

function getTomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface LeavesTabProps {
  viewMode: ViewMode;
  currentUser: Employee | null;
  employees: Employee[];
  onRefreshDashboard: () => Promise<void>;
}

export const LeavesTab: React.FC<LeavesTabProps> = ({
  viewMode,
  currentUser,
  employees,
  onRefreshDashboard,
}) => {
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const [empId, setEmpId] = useState<number>(currentUser?.id || employees[0]?.id || 1);
  const [leaveType, setLeaveType] = useState<LeaveType>('casual');
  const [startDate, setStartDate] = useState(getTomorrowISO());
  const [endDate, setEndDate] = useState(getTomorrowISO());
  const [reason, setReason] = useState('');
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [applyError, setApplyError] = useState<string | null>(null);

  const loadLeaves = async () => {
    setLoading(true);
    try {
      const [res, hRes] = await Promise.all([fetch('/api/leaves'), fetch('/api/holidays')]);
      if (res.ok) {
        const json = await res.json();
        setLeaves(json.leaves || []);
        setBalances(json.balances || []);
      }
      if (hRes.ok) {
        setHolidays(await hRes.json());
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLeaves();
  }, []);

  const workingDaysCount = useMemo(() => {
    if (!startDate || !endDate || endDate < startDate) return 0;
    const holidaySet = new Set(holidays.map((h) => h.date));
    const s = new Date(`${startDate}T00:00:00`);
    const e = new Date(`${endDate}T00:00:00`);
    let cnt = 0;
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (d.getDay() !== 0 && d.getDay() !== 6 && !holidaySet.has(ds)) cnt += 1;
    }
    return cnt;
  }, [startDate, endDate, holidays]);

  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();
    setApplyError(null);
    if (endDate < startDate) {
      setApplyError('End date must be on or after start date.');
      return;
    }
    const res = await fetch('/api/leaves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: viewMode === 'employee' && currentUser ? currentUser.id : empId,
        leave_type: leaveType,
        start_date: startDate,
        end_date: endDate,
        reason,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setApplyError(j.error || 'Failed to submit leave request.');
      return;
    }
    setReason('');
    setShowModal(false);
    await loadLeaves();
  };

  const handleDecision = async (id: number, status: 'approved' | 'rejected') => {
    const comment = window.prompt(`Optional comment for ${status} leave:`, '') ?? '';
    const res = await fetch(`/api/leaves/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, comment }),
    });
    if (res.ok) {
      if (status === 'approved') {
        const target = leaves.find((l) => l.id === id);
        window.dispatchEvent(
          new CustomEvent('zaviroq:celebrate', {
            detail: {
              id: `leave-approved-${id}-${Date.now()}`,
              kind: 'leave_granted',
              title: `Leave Granted${target?.employee_name ? ` for ${target.employee_name}` : ''}! 🌴`,
              message: target
                ? `${target.leave_type} leave (${target.start_date} to ${target.end_date}) has been approved. Enjoy the time off!`
                : 'Leave request approved — enjoy your time off!',
              sender: currentUser?.name || 'Admin',
              dropItems: true,
            },
          })
        );
      }
      await loadLeaves();
      await onRefreshDashboard();
    }
  };

  const visibleLeaves =
    viewMode === 'employee' && currentUser
      ? leaves.filter((l) => l.employee_id === currentUser.id)
      : leaves;

  const visibleBalances =
    viewMode === 'employee' && currentUser
      ? balances.filter((b) => b.employee_id === currentUser.id)
      : balances;

  const statusBadge = (status: string) => {
    if (status === 'approved')
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    if (status === 'rejected')
      return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
    return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Leaves & Time-Off Management</h1>
          <p className="text-xs text-slate-400">
            Track annual leave balances, submit requests, and sync approvals directly with attendance
          </p>
        </div>

        <button
          onClick={() => {
            setEmpId(currentUser?.id || employees[0]?.id || 1);
            setShowModal(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
        >
          <CalendarPlus className="h-4 w-4" />
          Apply Leave
        </button>
      </div>

      {/* Leave Balances */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {visibleBalances.map((b) => (
          <div key={b.employee_id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-white">{b.name}</div>
                <div className="text-[11px] text-slate-400">{b.emp_code} • {b.department}</div>
              </div>
              <CalendarDays className="h-4 w-4 text-indigo-400" />
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="rounded-xl bg-slate-950/70 border border-slate-800/80 p-2">
                <div className="text-[10px] text-slate-400">Casual</div>
                <div className="text-xs font-bold text-emerald-300 font-mono-num">
                  {b.casual_total - b.casual_used}/{b.casual_total}
                </div>
              </div>
              <div className="rounded-xl bg-slate-950/70 border border-slate-800/80 p-2">
                <div className="text-[10px] text-slate-400">Sick</div>
                <div className="text-xs font-bold text-cyan-300 font-mono-num">
                  {b.sick_total - b.sick_used}/{b.sick_total}
                </div>
              </div>
              <div className="rounded-xl bg-slate-950/70 border border-slate-800/80 p-2">
                <div className="text-[10px] text-slate-400">Earned</div>
                <div className="text-xs font-bold text-indigo-300 font-mono-num">
                  {b.earned_total - b.earned_used}/{b.earned_total}
                </div>
              </div>
              <div className="rounded-xl bg-slate-950/70 border border-slate-800/80 p-2">
                <div className="text-[10px] text-slate-400">Unpaid</div>
                <div className="text-xs font-bold text-amber-300 font-mono-num">{b.unpaid_used}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Mobile Leave Cards */}
      <div className="md:hidden space-y-3">
        {visibleLeaves.map((l) => (
          <div key={l.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-semibold text-white text-sm">{l.employee_name}</div>
                <div className="text-[11px] text-slate-400 capitalize">{l.leave_type} • {l.days}d</div>
              </div>
              <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${statusBadge(l.status)}`}>
                {l.status}
              </span>
            </div>
            <div className="font-mono-num text-xs text-slate-300">{l.start_date} → {l.end_date}</div>
            {l.reason && <div className="text-xs text-slate-400">{l.reason}</div>}
          </div>
        ))}
      </div>

      {/* Leave Requests Table */}
      <div className="hidden md:block overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/70">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-3 py-3">Employee</th>
              <th className="px-3 py-3">Type</th>
              <th className="px-3 py-3">Dates</th>
              <th className="px-3 py-3">Days</th>
              <th className="px-3 py-3">Reason</th>
              <th className="px-3 py-3">Status</th>
              {viewMode === 'admin' && <th className="px-3 py-3">Action</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {visibleLeaves.map((l) => (
              <tr key={l.id} className="hover:bg-slate-800/30">
                <td className="px-4 py-3">
                  <div className="font-semibold text-white">{l.employee_name}</div>
                  <div className="text-[11px] text-slate-400">{l.emp_code} • {l.department}</div>
                </td>
                <td className="px-4 py-3 capitalize text-xs font-medium text-indigo-300">{l.leave_type}</td>
                <td className="px-4 py-3 font-mono-num text-xs text-slate-300 whitespace-nowrap">
                  {l.start_date} → {l.end_date}
                </td>
                <td className="px-4 py-3 font-mono-num text-xs font-semibold text-white">{l.days}d</td>
                <td className="px-4 py-3 text-xs text-slate-300 max-w-xs truncate">{l.reason || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${statusBadge(l.status)}`}>
                    {l.status}
                  </span>
                </td>
                {viewMode === 'admin' && (
                  <td className="px-4 py-3">
                    {l.status === 'pending' ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleDecision(l.id, 'approved')}
                          className="rounded-lg bg-emerald-600/90 hover:bg-emerald-500 p-1.5 text-white cursor-pointer"
                          title="Approve Leave"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDecision(l.id, 'rejected')}
                          className="rounded-lg bg-rose-600/90 hover:bg-rose-500 p-1.5 text-white cursor-pointer"
                          title="Reject Leave"
                        >
                          <XIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-500">Reviewed</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && visibleLeaves.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-400">No leave requests found.</div>
        )}
      </div>

      {/* Apply Leave Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">Submit Leave Request</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white">
                <XIcon className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleApply} className="space-y-3.5">
              {viewMode === 'admin' && (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Employee</label>
                  <select
                    value={empId}
                    onChange={(e) => setEmpId(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  >
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>{e.name} ({e.emp_code})</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Leave Type</label>
                <select
                  value={leaveType}
                  onChange={(e) => setLeaveType(e.target.value as LeaveType)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                >
                  <option value="casual">Casual Leave (Paid)</option>
                  <option value="sick">Sick Leave (Paid)</option>
                  <option value="earned">Earned Leave (Paid)</option>
                  <option value="unpaid">Unpaid Leave (LOP)</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Start Date</label>
                  <input
                    required
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      const next = e.target.value;
                      setStartDate(next);
                      if (endDate < next) setEndDate(next);
                    }}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">End Date</label>
                  <input
                    required
                    type="date"
                    min={startDate}
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  />
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-300 flex items-center justify-between">
                <span>Working days requested:</span>
                <span className="font-mono-num font-bold text-indigo-300">{workingDaysCount} day{workingDaysCount === 1 ? '' : 's'}</span>
              </div>
              {applyError && (
                <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
                  {applyError}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Reason</label>
                <textarea
                  required
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason for leave..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
                >
                  Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
