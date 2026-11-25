import React from 'react';
import type { AttendanceStatus, LiveStatus, TaskPriority, TaskStatus } from '../types';

export const LiveStatusBadge: React.FC<{ status: LiveStatus }> = ({ status }) => {
  const styles: Record<LiveStatus, { bg: string; dot: string; label: string }> = {
    active: { bg: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', dot: 'bg-emerald-400 animate-pulse', label: 'Active' },
    idle: { bg: 'bg-amber-500/15 text-amber-300 border-amber-500/30', dot: 'bg-amber-400', label: 'Idle' },
    break: { bg: 'bg-sky-500/15 text-sky-300 border-sky-500/30', dot: 'bg-sky-400', label: 'On Break' },
    offline: { bg: 'bg-slate-700/40 text-slate-400 border-slate-600/40', dot: 'bg-slate-500', label: 'Offline' },
  };
  const s = styles[status] || styles.offline;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.bg}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
};

export const AttendanceBadge: React.FC<{ status: AttendanceStatus }> = ({ status }) => {
  const styles: Record<AttendanceStatus, string> = {
    present: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    late: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    half_day: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
    on_leave: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    absent: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  };
  const labels: Record<AttendanceStatus, string> = {
    present: 'Present',
    late: 'Late',
    half_day: 'Half Day',
    on_leave: 'On Leave',
    absent: 'Absent',
  };
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${styles[status] || styles.absent}`}>
      {labels[status] || status}
    </span>
  );
};

export const PriorityBadge: React.FC<{ priority: TaskPriority }> = ({ priority }) => {
  const styles: Record<TaskPriority, string> = {
    urgent: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    high: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    medium: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    low: 'bg-slate-700/40 text-slate-300 border-slate-600/40',
  };
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${styles[priority]}`}>
      {priority}
    </span>
  );
};

export const TaskStatusBadge: React.FC<{ status: TaskStatus }> = ({ status }) => {
  const styles: Record<TaskStatus, string> = {
    pending: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    in_progress: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
    review: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    completed: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    blocked: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  };
  const labels: Record<TaskStatus, string> = {
    pending: 'Pending',
    in_progress: 'In Progress',
    review: 'In Review',
    completed: 'Completed',
    blocked: 'Blocked',
  };
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
};
