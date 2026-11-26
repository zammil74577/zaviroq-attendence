import React from 'react';
import {
  Users,
  Activity,
  AlertTriangle,
  Clock,
  Coffee,
  Megaphone,
  ArrowRight,
  Zap,
  Calendar,
  Play,
  Pause,
  Check,
  ClipboardList,
  BarChart3,
  Monitor,
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

function getIstGreeting(): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 12);
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  } catch {
    return 'Welcome';
  }
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

  const greeting = getIstGreeting();
  const displayName = currentUser?.name || (isEmployeeMode ? 'Teammate' : 'Master Admin');

  const schedule = data.officeSchedule;

  return (
    <div className="space-y-5">
      {/* Hero Banner */}
      <section className="relative overflow-hidden rounded-[24px] border border-[var(--zv-border)] bg-gradient-to-r from-[#EFEAFF] via-[#F7F5FF] to-[var(--zv-surface)] shadow-[var(--zv-shadow)] min-h-[140px] flex items-center">
        <div className="relative z-10 px-6 sm:px-8 py-6 max-w-2xl">
          <div className="text-sm font-semibold text-[#4B4668] flex items-center gap-1.5">
            <span>👋</span>
            <span>{greeting}, {displayName}!</span>
          </div>
          <h1 className="mt-1 text-2xl sm:text-[34px] sm:leading-[1.15] font-extrabold font-heading tracking-tight text-[#1A1635]">
            {isEmployeeMode ? 'Your Day at a Glance' : 'Your Workforce at a Glance'}
          </h1>
          <p className="mt-1.5 text-xs sm:text-sm text-[#6B6785]">
            Track attendance, productivity, and team activity — all in one place.
          </p>
        </div>
        <div className="hidden md:block absolute inset-y-0 right-0 w-[52%] pointer-events-none">
          <img
            src="/hero-office.webp"
            alt=""
            loading="lazy"
            className="h-full w-full object-cover object-right"
          />
          <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-[#F7F5FF] via-[#F7F5FF]/70 to-transparent" />
        </div>
      </section>

      {/* Important Announcements Banner */}
      {announcements.length > 0 && (
        <div className="zv-card p-4 flex items-start gap-3.5 border-l-4 border-l-[#6D4AFF] bg-gradient-to-r from-[#EFEAFF]/55 via-[var(--zv-surface)] to-[var(--zv-surface)]">
          <div className="zv-icon-chip h-10 w-10 rounded-xl bg-[#EFEAFF] text-[#6D4AFF] flex items-center justify-center shrink-0">
            <Megaphone className="h-4 w-4" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="rounded-full bg-[#EFEAFF] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#6D4AFF]">
                {announcements[0].title}
              </span>
              <span className="text-[11px] text-[var(--zv-muted)]">
                &bull; Posted by {announcements[0].author_name || 'Admin'}
              </span>
            </div>
            <p className="mt-1 text-sm text-[var(--zv-text-secondary)]">{announcements[0].message}</p>
          </div>
        </div>
      )}

      {/* Office Timing Strip */}
      <div className="zv-card px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-xs bg-gradient-to-r from-[var(--zv-surface)] via-[#FAF8FF] to-[var(--zv-surface)]">
        <div className="flex items-center gap-2.5 font-semibold text-[var(--zv-text)]">
          <span className="h-8 w-8 rounded-xl bg-[#EFEAFF] text-[#6D4AFF] flex items-center justify-center shrink-0">
            <Calendar className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <span className="text-[var(--zv-muted)] font-medium">Zaviroq Office Timing:</span>
          <span className="font-mono-num font-bold text-[#1A1635]">
            {schedule?.shiftStart || '09:30'} – {schedule?.shiftEnd || '17:30'} (IST)
          </span>
          <span className="rounded-full bg-[#F3F0FF] px-2 py-0.5 text-[10px] font-semibold text-[#6D4AFF]">
            {schedule?.lateGraceMinutes ?? 15}m grace
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 text-[var(--zv-text-secondary)]">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--zv-border)] bg-[var(--zv-surface)] px-3 py-1">
            <Clock className="h-3.5 w-3.5 text-[#2563EB]" strokeWidth={1.75} />
            <span className="text-[var(--zv-muted)]">Lunch:</span>
            <strong className="text-[var(--zv-text)] font-mono-num">{schedule?.lunchBreak || '13:00'} ({schedule?.lunchMinutes ?? 45}m)</strong>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--zv-border)] bg-[var(--zv-surface)] px-3 py-1">
            <Coffee className="h-3.5 w-3.5 text-[#D97706]" strokeWidth={1.75} />
            <span className="text-[var(--zv-muted)]">Tea:</span>
            <strong className="text-[var(--zv-text)] font-mono-num">{schedule?.teaMinutes ?? 15}m</strong>
            <span className="text-[var(--zv-muted)]">after {schedule?.teaBreakAfter || '15:00'}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#DDD6FE] bg-[#EFEAFF]/70 px-3 py-1 text-[#6D4AFF]">
            <span>Net Shift:</span>
            <strong className="font-mono-num">{schedule?.netWorkHours ?? 7}h</strong>
          </span>
        </div>
      </div>

      {/* Executive KPI Strip (4 across, 2 on tablet, 1 on mobile) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 zv-stagger">
        {isEmployeeMode ? (
          <>
            <KpiCard
              title="Today's Shift Status"
              value={
                currentUser.clock_in
                  ? currentUser.clock_out
                    ? currentUser.missed_clock_out
                      ? 'Auto clocked-out'
                      : 'Completed'
                    : 'Clocked In'
                  : 'Not Started'
              }
              sub={`In: ${formatClockTime(currentUser.clock_in)} • Shift ${currentUser.shift_start}–${currentUser.shift_end}`}
              icon={<Clock className="h-5 w-5 text-white" strokeWidth={1.75} />}
              accent="purple"
              featured
            />
            <KpiCard
              title="Active vs Idle Time"
              value={formatHM(currentUser.active_seconds)}
              sub={`Idle: ${formatHM(currentUser.idle_seconds)} • Break: ${formatHM(currentUser.break_seconds)}`}
              icon={<Monitor className="h-5 w-5 text-[#16A34A]" strokeWidth={1.75} />}
              accent="green"
            />
            <KpiCard
              title="My Pending Tasks"
              value={String(pendingOrOverdue.length)}
              sub={`${overdueTasks.length} overdue • ${completedCount} completed`}
              icon={<ClipboardList className="h-5 w-5 text-[#EA580C]" strokeWidth={1.75} />}
              accent="orange"
            />
            <KpiCard
              title="Focus Efficiency"
              value={myProductivity === null ? '—' : `${myProductivity}%`}
              sub="Active time vs total desk time"
              icon={<Zap className="h-5 w-5 text-[#2563EB]" strokeWidth={1.75} />}
              accent="blue"
            />
          </>
        ) : (
          <>
            <KpiCard
              title="Workforce Present"
              value={`${summary.presentCount} / ${summary.totalEmployees}`}
              sub={`${summary.lateCount} late • ${summary.clockedOutCount} clocked out • ${summary.absentCount} absent`}
              icon={<Users className="h-5 w-5 text-white" strokeWidth={1.75} />}
              accent="purple"
              featured
              avatars={employees.slice(0, 3).map((e) => ({ name: e.name, color: e.avatar_color }))}
              extraCount={Math.max(0, summary.totalEmployees - 3)}
            />
            <KpiCard
              title="Live Desk Telemetry"
              value={`${summary.activeNowCount} Active`}
              sub={`${summary.idleNowCount} idle • ${summary.onBreakCount} on break`}
              icon={<Monitor className="h-5 w-5 text-[#16A34A]" strokeWidth={1.75} />}
              accent="green"
            />
            <KpiCard
              title="Pending & Overdue"
              value={String(summary.pendingTasks + summary.inProgressTasks + summary.reviewTasks + summary.blockedTasks)}
              sub={`${summary.overdueTasks} overdue • ${summary.blockedTasks} blocked • ${summary.completedTasks} done`}
              icon={<ClipboardList className="h-5 w-5 text-[#EA580C]" strokeWidth={1.75} />}
              accent="orange"
            />
            <KpiCard
              title="Org Productivity"
              value={teamProductivity === null ? '—' : `${teamProductivity}%`}
              sub={`${formatHM(summary.totalActiveSeconds)} active vs ${formatHM(summary.totalIdleSeconds)} idle`}
              icon={<BarChart3 className="h-5 w-5 text-[#2563EB]" strokeWidth={1.75} />}
              accent="blue"
            />
          </>
        )}
      </div>

      {/* Main 2-Column Operational Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Left 2 cols: Live Workforce Pulse + Priority Pending Tasks */}
        <div className="xl:col-span-2 space-y-5">
          <div className="zv-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-[#EFEAFF] text-[#6D4AFF] flex items-center justify-center shrink-0">
                  <Activity className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <div>
                  <h2 className="text-[18px] font-bold font-heading text-[var(--zv-text)]">
                    {isEmployeeMode ? 'My Shift & Team Presence' : 'Live Workforce Pulse'}
                  </h2>
                  <p className="text-xs text-[var(--zv-muted)]">
                    Real-time attendance, active desk time, and idle monitoring
                  </p>
                </div>
              </div>
              <button
                onClick={() => onNavigateTab('attendance')}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#6D4AFF] hover:underline cursor-pointer"
              >
                Full Attendance <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {(isEmployeeMode ? [currentUser] : employees).map((emp) => {
                const total = emp.active_seconds + emp.idle_seconds;
                const activePct = total > 0 ? Math.round((emp.active_seconds / total) * 100) : null;
                return (
                  <div
                    key={emp.id}
                    className={`rounded-2xl border p-4 transition-all duration-150 hover:-translate-y-0.5 ${
                      currentUser?.id === emp.id
                        ? 'border-[#DDD6FE] bg-[#FAF8FF] shadow-xs'
                        : 'border-[var(--zv-border)] bg-[var(--zv-surface)] hover:shadow-md'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className="h-10 w-10 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 zv-text-white-keep"
                          style={{ backgroundColor: emp.avatar_color }}
                        >
                          {getInitials(emp.name)}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-[var(--zv-text)]">{emp.name}</div>
                          <div className="truncate text-[11px] text-[var(--zv-muted)]">
                            {emp.designation} &bull; {emp.department}
                          </div>
                        </div>
                      </div>
                      <LiveStatusBadge status={emp.status} />
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--zv-muted)]">
                      <span className="flex items-center gap-1.5">
                        <AttendanceBadge status={emp.attendance_status} />
                        <span className="font-medium text-[var(--zv-text-secondary)]">In: {formatClockTime(emp.clock_in)}</span>
                        <span className="font-mono-num">
                          ({emp.shift_start || schedule?.shiftStart || '09:30'}–{emp.shift_end || schedule?.shiftEnd || '17:30'})
                        </span>
                      </span>
                      <span className="font-mono-num font-medium text-[var(--zv-text-secondary)]">
                        {formatHM(emp.active_seconds)} active / {formatHM(emp.idle_seconds)} idle
                      </span>
                    </div>

                    <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-[#EFEAFF]">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          activePct === null
                            ? 'bg-[#D1D5DB]'
                            : 'bg-gradient-to-r from-[#6D4AFF] to-[#8B5CF6]'
                        }`}
                        style={{ width: `${activePct ?? 0}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Priority Pending Tasks Spotlight */}
          <div className="zv-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-[#EFEAFF] text-[#6D4AFF] flex items-center justify-center shrink-0">
                  <ClipboardList className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <div>
                  <h2 className="text-[18px] font-bold font-heading text-[var(--zv-text)]">
                    {isEmployeeMode ? 'My Pending & Active Tasks' : 'Priority Pending Tasks'}
                  </h2>
                  <p className="text-xs text-[var(--zv-muted)]">
                    Tasks requiring immediate execution or review
                  </p>
                </div>
              </div>
              <button
                onClick={() => onNavigateTab('pending')}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#6D4AFF] hover:underline cursor-pointer"
              >
                View All Pending ({pendingOrOverdue.length}) <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="space-y-3">
              {pendingOrOverdue.slice(0, 5).map((task) => {
                const isOverdue = Boolean(task.is_overdue);
                return (
                  <div
                    key={task.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-[var(--zv-border)] bg-[var(--zv-surface-subtle)] p-4 hover:border-[#DDD6FE] transition-colors"
                  >
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <PriorityBadge priority={task.priority} />
                        <TaskStatusBadge status={task.status} />
                        {isOverdue && (
                          <span className="rounded-full bg-[#FDECEC] border border-[#FECACA] px-2.5 py-0.5 text-[11px] font-semibold text-[#DC2626]">
                            Overdue
                          </span>
                        )}
                      </div>
                      <div className="text-sm font-bold text-[var(--zv-text)] truncate">{task.title}</div>
                      <div className="text-xs text-[var(--zv-muted)]">
                        Assignee: <span className="font-medium text-[var(--zv-text-secondary)]">{task.assignee_name}</span> &bull; Due:{' '}
                        <span className={`font-mono-num ${isOverdue ? 'text-[#DC2626] font-semibold' : 'text-[var(--zv-text-secondary)]'}`}>
                          {task.due_date}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {task.status === 'pending' && (
                        <button
                          onClick={() => onQuickTaskStatus(task.id, 'in_progress')}
                          className="rounded-xl border border-[#DDD6FE] bg-[var(--zv-surface)] hover:bg-[#EFEAFF] px-3.5 py-1.5 text-xs font-semibold text-[#4B4668] cursor-pointer transition-colors"
                        >
                          Start
                        </button>
                      )}
                      {task.status === 'blocked' ? (
                        <button
                          onClick={() => onQuickTaskStatus(task.id, 'in_progress')}
                          className="rounded-xl border border-[#DDD6FE] bg-[var(--zv-surface)] hover:bg-[#EFEAFF] px-3.5 py-1.5 text-xs font-semibold text-[#6D4AFF] cursor-pointer transition-colors"
                        >
                          Unblock
                        </button>
                      ) : (
                        <button
                          onClick={() => onQuickTaskStatus(task.id, 'completed')}
                          className="inline-flex items-center gap-1 rounded-xl zv-btn-primary px-3.5 py-1.5 text-xs font-semibold text-white cursor-pointer"
                        >
                          <Check className="h-3.5 w-3.5" />
                          Complete
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {scopedTasks.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[#DDD6FE] bg-[var(--zv-surface-subtle)] p-8 text-center">
                  <div className="mx-auto mb-2 h-11 w-11 rounded-2xl bg-[#EFEAFF] text-[#6D4AFF] flex items-center justify-center">
                    <ClipboardList className="h-5 w-5" strokeWidth={1.75} />
                  </div>
                  <div className="text-sm font-semibold text-[var(--zv-text)]">No tasks assigned yet</div>
                  <p className="text-xs text-[var(--zv-muted)] mt-0.5">Tasks assigned to this workspace will appear here.</p>
                </div>
              ) : (
                completedCount > 0 && pendingOrOverdue.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-[#BBF7D0] bg-[#E8F8EE]/50 p-6 text-center text-sm font-medium text-[#16A34A]">
                    All assigned tasks are completed! Great momentum.
                  </div>
                )
              )}
            </div>
          </div>
        </div>

        {/* Right Col: Live Activity & Idle Feed */}
        <div className="zv-card p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-[#EFEAFF] text-[#6D4AFF] flex items-center justify-center shrink-0">
                <Users className="h-5 w-5" strokeWidth={1.75} />
              </div>
              <div>
                <h2 className="text-[18px] font-bold font-heading text-[var(--zv-text)]">Live Activity &amp; Idle Feed</h2>
                <p className="text-xs text-[var(--zv-muted)]">Audited clock, idle, break &amp; task events</p>
              </div>
            </div>
            <button
              onClick={() => onNavigateTab('idle')}
              className="rounded-full border border-[#DDD6FE] bg-[#EFEAFF] hover:bg-[#E4DCFF] px-3 py-1 text-xs font-semibold text-[#6D4AFF] cursor-pointer transition-colors"
            >
              Tracker
            </button>
          </div>

          <div className="space-y-2.5 overflow-y-auto max-h-[540px] pr-1">
            {(isEmployeeMode ? logs.filter((l) => l.employee_id === currentUser.id) : logs).slice(0, 14).map((log) => {
              const isIdleEnd = log.type === 'idle_end' || log.type === 'break_end' || log.type === 'clock_in';
              const isIdleStart = log.type === 'idle_start';
              const isBreak = log.type.includes('break');
              const iconWrap = isBreak
                ? 'bg-[#E8F0FF] text-[#2563EB]'
                : isIdleStart
                ? 'bg-[#FFF4E0] text-[#D97706]'
                : isIdleEnd
                ? 'bg-[#E8F8EE] text-[#16A34A]'
                : 'bg-[#FFF4E0] text-[#D97706]';

              return (
                <div
                  key={log.id}
                  className="flex items-start gap-3 rounded-2xl border border-[var(--zv-border)] bg-[var(--zv-surface-subtle)] p-3 hover:border-[#DDD6FE] transition-colors"
                >
                  <div className={`mt-0.5 h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${iconWrap}`}>
                    {isBreak ? (
                      <Coffee className="h-4 w-4" strokeWidth={1.75} />
                    ) : isIdleStart ? (
                      <Pause className="h-4 w-4" strokeWidth={1.75} />
                    ) : isIdleEnd ? (
                      <Play className="h-4 w-4" strokeWidth={1.75} />
                    ) : (
                      <AlertTriangle className="h-4 w-4" strokeWidth={1.75} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[var(--zv-text)] truncate">{log.employee_name}</span>
                      <span className="text-[11px] text-[var(--zv-muted)] shrink-0 tabular-nums">
                        {formatRelativeTime(log.timestamp)}
                      </span>
                    </div>
                    <div className="text-[10px] font-bold text-[#6D4AFF] uppercase tracking-wider mt-0.5">
                      {log.type.replace('_', ' ')}
                    </div>
                    {log.reason && <p className="text-xs text-[var(--zv-muted)] mt-0.5 break-words">{log.reason}</p>}
                  </div>
                </div>
              );
            })}
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
  accent: 'purple' | 'green' | 'orange' | 'blue';
  featured?: boolean;
  avatars?: Array<{ name: string; color: string }>;
  extraCount?: number;
}> = ({ title, value, sub, icon, accent, featured = false, avatars, extraCount = 0 }) => {
  const styles: Record<string, { chip: string; stroke: string; fill: string }> = {
    purple: { chip: 'bg-[#EFEAFF]', stroke: '#6D4AFF', fill: 'rgba(109,74,255,0.12)' },
    green: { chip: 'bg-[#E8F8EE]', stroke: '#16A34A', fill: 'rgba(22,163,74,0.12)' },
    orange: { chip: 'bg-[#FFEDE3]', stroke: '#EA580C', fill: 'rgba(234,88,12,0.12)' },
    blue: { chip: 'bg-[#E8F0FF]', stroke: '#2563EB', fill: 'rgba(37,99,235,0.12)' },
  };
  const st = styles[accent];

  if (featured) {
    return (
      <div className="zv-card zv-card-hover relative overflow-hidden p-5 border-transparent bg-gradient-to-br from-[#6D4AFF] via-[#7C3AED] to-[#8B5CF6] text-white shadow-[0_12px_28px_rgba(109,74,255,0.28)] zv-text-white-keep">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-10 -right-10 h-36 w-36 rounded-full bg-white/15 blur-xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-10 left-1/3 h-28 w-48 rounded-full bg-indigo-950/25 blur-xl"
        />
        <div className="relative z-10 flex items-start justify-between gap-2">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="zv-icon-chip h-12 w-12 rounded-2xl bg-white/20 backdrop-blur-xs flex items-center justify-center shrink-0">
              {icon}
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-white/85 zv-text-white-keep">{title}</div>
              <div className="mt-1 text-[32px] leading-none font-extrabold tracking-tight font-heading text-white tabular-nums zv-text-white-keep">
                {value}
              </div>
              <div className="mt-2 text-xs text-white/85 leading-snug zv-text-white-keep">{sub}</div>
            </div>
          </div>
          {avatars && avatars.length > 0 && (
            <div className="flex items-center -space-x-2 shrink-0 pt-1">
              {avatars.map((a, idx) => (
                <span
                  key={idx}
                  title={a.name}
                  className="h-7 w-7 rounded-full border-2 border-[#7C3AED] flex items-center justify-center text-[10px] font-bold text-white shadow-sm zv-text-white-keep"
                  style={{ backgroundColor: a.color }}
                >
                  {getInitials(a.name)}
                </span>
              ))}
              {extraCount > 0 && (
                <span className="h-7 w-7 rounded-full border-2 border-[#7C3AED] bg-white/25 backdrop-blur-xs flex items-center justify-center text-[10px] font-bold text-white zv-text-white-keep">
                  +{extraCount}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="zv-card zv-card-hover relative overflow-hidden p-5">
      {/* Crisp sparkline wave SVG in bottom-right */}
      <svg
        aria-hidden="true"
        viewBox="0 0 120 44"
        className="pointer-events-none absolute bottom-0 right-0 w-28 h-11 opacity-85"
      >
        <path
          d="M0,40 C20,38 28,22 45,26 C62,30 70,12 88,16 C102,19 108,8 120,10 L120,44 L0,44 Z"
          fill={st.fill}
        />
        <path
          d="M0,40 C20,38 28,22 45,26 C62,30 70,12 88,16 C102,19 108,8 120,10"
          fill="none"
          stroke={st.stroke}
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <div className="relative z-10 flex items-start gap-3.5">
        <div className={`zv-icon-chip h-12 w-12 rounded-2xl ${st.chip} flex items-center justify-center shrink-0`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1 pr-6">
          <div className="text-[13px] font-medium text-[var(--zv-muted)]">{title}</div>
          <div className="mt-1 text-[32px] leading-none font-extrabold tracking-tight font-heading text-[var(--zv-text)] tabular-nums">
            {value}
          </div>
          <div className="mt-2 text-xs text-[var(--zv-muted)] leading-snug">{sub}</div>
        </div>
      </div>
    </div>
  );
};
