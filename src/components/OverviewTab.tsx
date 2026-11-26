import React from 'react';
import {
  Users,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Coffee,
  Megaphone,
  ArrowRight,
  Zap,
} from 'lucide-react';
import type { DashboardData, Employee, TabId, ViewMode } from '../types';
import { calcProductivity, formatClockTime, formatHM, formatRelativeTime, getInitials } from '../utils/format';
import { AttendanceBadge, LiveStatusBadge, PriorityBadge, TaskStatusBadge } from './StatusBadge';

interface OverviewTabProps {
  data: DashboardData;
  viewMode: ViewMode;
  currentUser: Employee | null;
  onNavigateTab: (tab: TabId) => void;
  onQuickTaskStatus: (taskId: number, status: 'in_progress' | 'completed') => void;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  data,
  viewMode,
  currentUser,
  onNavigateTab,
  onQuickTaskStatus,
}) => {
  const { summary, employees, tasks, logs, announcements } = data;
  const isEmployeeMode = viewMode === 'employee' && currentUser;

  const scopedTasks = isEmployeeMode
    ? tasks.filter((t) => t.assignee_id === currentUser.id)
    : tasks;

  const pendingOrOverdue = scopedTasks.filter((t) => t.status !== 'completed');
  const overdueTasks = pendingOrOverdue.filter((t) => Boolean(t.is_overdue));
  const completedCount = scopedTasks.filter((t) => t.status === 'completed').length;

  const teamProductivity = calcProductivity(summary.totalActiveSeconds, summary.totalIdleSeconds);
  const myProductivity = currentUser
    ? calcProductivity(currentUser.active_seconds, currentUser.idle_seconds)
    : null;

  return (
    <div className="space-y-6">
      {/* Important Announcements Banner */}
      {announcements.length > 0 && (
        <div className="rounded-2xl border border-indigo-500/30 bg-gradient-to-r from-indigo-950/60 via-slate-900 to-slate-900 p-4 flex items-start gap-3">
          <div className="rounded-xl bg-indigo-500/20 p-2 text-indigo-300 shrink-0">
            <Megaphone className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-300">
                {announcements[0].title}
              </span>
              <span className="text-[11px] text-slate-500">
                • Posted by {announcements[0].author_name || 'Admin'}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-slate-300">{announcements[0].message}</p>
          </div>
        </div>
      )}

      {/* Office Timing & Break Policy Strip */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 font-semibold text-slate-200">
          <Clock className="h-4 w-4 text-indigo-400" />
          <span>Zaviroq Office Timing:</span>
          <span className="font-mono-num text-emerald-300">
            {data.officeSchedule?.shiftStart || '09:30'} – {data.officeSchedule?.shiftEnd || '17:30'}
          </span>
          <span className="text-[11px] font-normal text-slate-400">
            ({data.officeSchedule?.lateGraceMinutes ?? 15}m grace)
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-slate-300">
          <span className="flex items-center gap-1.5">
            <Coffee className="h-3.5 w-3.5 text-sky-400" />
            Lunch Break: <strong className="text-white font-mono-num">01:00 PM – 01:45 PM</strong> (45m)
          </span>
          <span className="flex items-center gap-1.5">
            <Coffee className="h-3.5 w-3.5 text-amber-400" />
            Tea Break: <strong className="text-white font-mono-num">15m</strong> after 03:00 PM
          </span>
          <span className="text-slate-400">Net Shift: <strong className="text-indigo-300 font-mono-num">7h 00m</strong></span>
        </div>
      </div>

      {/* Executive KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {isEmployeeMode ? (
          <>
            <KpiCard
              title="Today's Shift Status"
              value={
                currentUser.clock_in
                  ? currentUser.clock_out
                    ? currentUser.missed_clock_out
                      ? 'Auto clocked-out (missed)'
                      : 'Completed'
                    : 'Clocked In'
                  : 'Not Started'
              }
              sub={`In: ${formatClockTime(currentUser.clock_in)} • Shift ${currentUser.shift_start}–${currentUser.shift_end}`}
              icon={<Clock className="h-5 w-5 text-emerald-400" />}
              accent="emerald"
            />
            <KpiCard
              title="Active vs Idle Time"
              value={formatHM(currentUser.active_seconds)}
              sub={`Idle: ${formatHM(currentUser.idle_seconds)} • Break: ${formatHM(currentUser.break_seconds)}`}
              icon={<Activity className="h-5 w-5 text-cyan-400" />}
              accent="cyan"
            />
            <KpiCard
              title="My Pending Tasks"
              value={String(pendingOrOverdue.length)}
              sub={`${overdueTasks.length} overdue • ${completedCount} completed`}
              icon={<AlertTriangle className="h-5 w-5 text-amber-400" />}
              accent="amber"
            />
            <KpiCard
              title="Focus Efficiency"
              value={myProductivity === null ? '—' : `${myProductivity}%`}
              sub="Active time vs total desk time"
              icon={<Zap className="h-5 w-5 text-indigo-400" />}
              accent="indigo"
            />
          </>
        ) : (
          <>
            <KpiCard
              title="Workforce Present"
              value={`${summary.presentCount} / ${summary.totalEmployees}`}
              sub={`${summary.lateCount} late • ${summary.clockedOutCount} clocked out • ${summary.absentCount} absent`}
              icon={<Users className="h-5 w-5 text-emerald-400" />}
              accent="emerald"
            />
            <KpiCard
              title="Live Desk Telemetry"
              value={`${summary.activeNowCount} Active`}
              sub={`${summary.idleNowCount} idle • ${summary.onBreakCount} on break`}
              icon={<Activity className="h-5 w-5 text-cyan-400" />}
              accent="cyan"
            />
            <KpiCard
              title="Pending & Overdue"
              value={String(summary.pendingTasks + summary.inProgressTasks + summary.reviewTasks + summary.blockedTasks)}
              sub={`${summary.overdueTasks} overdue • ${summary.blockedTasks} blocked • ${summary.completedTasks} done`}
              icon={<AlertTriangle className="h-5 w-5 text-amber-400" />}
              accent="amber"
            />
            <KpiCard
              title="Org Productivity"
              value={teamProductivity === null ? '—' : `${teamProductivity}%`}
              sub={`${formatHM(summary.totalActiveSeconds)} active vs ${formatHM(summary.totalIdleSeconds)} idle`}
              icon={<CheckCircle2 className="h-5 w-5 text-indigo-400" />}
              accent="indigo"
            />
          </>
        )}
      </div>

      {/* Main 2-Column Operational Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left 2 cols: Live Team Pulse (Admin) or My Shift & Activity (Employee) */}
        <div className="xl:col-span-2 space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-white">
                  {isEmployeeMode ? 'My Shift & Team Presence' : 'Live Workforce Pulse'}
                </h2>
                <p className="text-xs text-slate-400">
                  Real-time attendance, active desk time, and idle monitoring
                </p>
              </div>
              <button
                onClick={() => onNavigateTab('attendance')}
                className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-400 hover:text-indigo-300 cursor-pointer"
              >
                Full Attendance <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(isEmployeeMode ? [currentUser] : employees).map(
                (emp) => {
                  const total = emp.active_seconds + emp.idle_seconds;
                  const activePct = total > 0 ? Math.round((emp.active_seconds / total) * 100) : null;
                  return (
                    <div
                      key={emp.id}
                      className={`rounded-xl border p-3.5 transition-colors ${
                        currentUser?.id === emp.id
                          ? 'border-indigo-500/40 bg-indigo-950/20'
                          : 'border-slate-800/90 bg-slate-950/60 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                            style={{ backgroundColor: emp.avatar_color }}
                          >
                            {getInitials(emp.name)}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-white">{emp.name}</div>
                            <div className="truncate text-[11px] text-slate-400">
                              {emp.designation} • {emp.department}
                            </div>
                          </div>
                        </div>
                        <LiveStatusBadge status={emp.status} />
                      </div>

                      <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
                        <span className="flex items-center gap-1.5">
                          <AttendanceBadge status={emp.attendance_status} />
                          <span>In: {formatClockTime(emp.clock_in)}</span>
                          <span className="text-slate-500 font-mono-num">
                            ({emp.shift_start || data.officeSchedule?.shiftStart || '09:30'}–{emp.shift_end || data.officeSchedule?.shiftEnd || '17:30'})
                          </span>
                        </span>
                        <span className="font-mono-num text-slate-300">
                          {formatHM(emp.active_seconds)} active / {formatHM(emp.idle_seconds)} idle
                        </span>
                      </div>

                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                        <div
                          className={`h-full rounded-full transition-all ${
                            activePct === null
                              ? 'bg-slate-600'
                              : activePct >= 85
                              ? 'bg-emerald-500'
                              : activePct >= 70
                              ? 'bg-amber-500'
                              : 'bg-rose-500'
                          }`}
                          style={{ width: `${activePct ?? 100}%` }}
                        />
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          </div>

          {/* Pending & Urgent Tasks Spotlight */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-white">
                  {isEmployeeMode ? 'My Pending & Active Tasks' : 'Priority Pending Tasks'}
                </h2>
                <p className="text-xs text-slate-400">
                  Tasks requiring immediate execution or review
                </p>
              </div>
              <button
                onClick={() => onNavigateTab('pending')}
                className="inline-flex items-center gap-1 text-xs font-semibold text-amber-400 hover:text-amber-300 cursor-pointer"
              >
                View All Pending ({pendingOrOverdue.length}) <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="space-y-2.5">
              {pendingOrOverdue.slice(0, 5).map((task) => {
                const isOverdue = Boolean(task.is_overdue);
                return (
                  <div
                    key={task.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-800/90 bg-slate-950/60 p-3.5 hover:border-slate-700"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <PriorityBadge priority={task.priority} />
                        <TaskStatusBadge status={task.status} />
                        {isOverdue && (
                          <span className="rounded-md bg-rose-500/20 border border-rose-500/30 px-2 py-0.5 text-[11px] font-semibold text-rose-300">
                            OVERDUE
                          </span>
                        )}
                      </div>
                      <div className="text-sm font-medium text-white truncate">{task.title}</div>
                      <div className="text-[11px] text-slate-400">
                        Assignee: <span className="text-slate-300">{task.assignee_name}</span> • Due{' '}
                        <span className={isOverdue ? 'text-rose-400 font-semibold' : 'text-slate-300'}>
                          {task.due_date}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {task.status === 'pending' && (
                        <button
                          onClick={() => onQuickTaskStatus(task.id, 'in_progress')}
                          className="rounded-lg border border-indigo-500/40 bg-indigo-500/15 hover:bg-indigo-500/25 px-2.5 py-1.5 text-xs font-semibold text-indigo-300 cursor-pointer"
                        >
                          Start
                        </button>
                      )}
                      {task.status === 'blocked' ? (
                        <button
                          onClick={() => onQuickTaskStatus(task.id, 'in_progress')}
                          className="rounded-lg border border-indigo-500/40 bg-indigo-500/15 hover:bg-indigo-500/25 px-2.5 py-1.5 text-xs font-semibold text-indigo-300 cursor-pointer"
                        >
                          Unblock
                        </button>
                      ) : (
                        <button
                          onClick={() => onQuickTaskStatus(task.id, 'completed')}
                          className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 cursor-pointer"
                        >
                          Complete
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {scopedTasks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-sm text-slate-400">
                  No tasks assigned yet
                </div>
              ) : (
                completedCount > 0 && pendingOrOverdue.length === 0 && (
                  <div className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-sm text-slate-400">
                    All assigned tasks are completed! Great momentum.
                  </div>
                )
              )}
            </div>
          </div>
        </div>

        {/* Right Col: Live Activity & Idle Feed */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-white">Live Activity & Idle Feed</h2>
              <p className="text-xs text-slate-400">Audited clock, idle, break & task events</p>
            </div>
            <button
              onClick={() => onNavigateTab('idle')}
              className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 cursor-pointer"
            >
              Tracker
            </button>
          </div>

          <div className="space-y-3 overflow-y-auto max-h-[540px] pr-1">
            {(isEmployeeMode ? logs.filter((l) => l.employee_id === currentUser.id) : logs).slice(0, 14).map((log) => (
              <div
                key={log.id}
                className="flex items-start gap-3 rounded-xl border border-slate-800/80 bg-slate-950/60 p-3"
              >
                <div className="mt-0.5 rounded-lg bg-slate-800 p-1.5 text-slate-300 shrink-0">
                  {log.type.includes('idle') ? (
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                  ) : log.type.includes('break') ? (
                    <Coffee className="h-3.5 w-3.5 text-sky-400" />
                  ) : (
                    <Activity className="h-3.5 w-3.5 text-emerald-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-white truncate">{log.employee_name}</span>
                    <span className="text-[11px] text-slate-500 shrink-0">
                      {formatRelativeTime(log.timestamp)}
                    </span>
                  </div>
                  <div className="text-[11px] font-medium text-indigo-300 uppercase tracking-wide mt-0.5">
                    {log.type.replace('_', ' ')}
                  </div>
                  {log.reason && <p className="text-xs text-slate-400 mt-0.5 break-words">{log.reason}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const KpiCard: React.FC<{
  title: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  accent: 'emerald' | 'cyan' | 'amber' | 'indigo';
}> = ({ title, value, sub, icon, accent }) => {
  const ring: Record<string, string> = {
    emerald: 'border-emerald-500/20',
    cyan: 'border-cyan-500/20',
    amber: 'border-amber-500/20',
    indigo: 'border-indigo-500/20',
  };
  return (
    <div className={`rounded-2xl border ${ring[accent]} bg-slate-900/75 p-4 shadow-sm`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-400">{title}</span>
        <div className="rounded-xl bg-slate-800/80 p-2">{icon}</div>
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight text-white font-mono-num">{value}</div>
      <div className="mt-1 text-xs text-slate-400 truncate">{sub}</div>
    </div>
  );
};
