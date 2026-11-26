import React from 'react';
import type { AttendanceStatus, LiveStatus, TaskPriority, TaskStatus } from '../types';

export const LiveStatusBadge: React.FC<{ status: LiveStatus }> = ({ status }) => {
  const styles: Record<LiveStatus, { cls: string; dot: string; label: string }> = {
    active: {
      cls: 'bg-[#E8F8EE] text-[#16A34A] border-[#BBF7D0]',
      dot: 'bg-[#16A34A] animate-pulse',
      label: 'Active',
    },
    idle: {
      cls: 'bg-[#FFF4E0] text-[#D97706] border-[#FDE68A]',
      dot: 'bg-[#D97706]',
      label: 'Idle',
    },
    break: {
      cls: 'bg-[#E8F0FF] text-[#2563EB] border-[#BFDBFE]',
      dot: 'bg-[#2563EB]',
      label: 'On Break',
    },
    offline: {
      cls: 'bg-[#F1F1F4] text-[#6B7280] border-[#E5E7EB]',
      dot: 'bg-[#6B7280]',
      label: 'Offline',
    },
  };
  const s = styles[status] || styles.offline;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
};

export const AttendanceBadge: React.FC<{ status: AttendanceStatus }> = ({ status }) => {
  const styles: Record<AttendanceStatus, string> = {
    present: 'bg-[#E8F8EE] text-[#16A34A] border-[#BBF7D0]',
    late: 'bg-[#FFEDE3] text-[#EA580C] border-[#FED7AA]',
    half_day: 'bg-[#EFEAFF] text-[#6D4AFF] border-[#DDD6FE]',
    on_leave: 'bg-[#E8F0FF] text-[#2563EB] border-[#BFDBFE]',
    absent: 'bg-[#FDECEC] text-[#DC2626] border-[#FECACA]',
  };
  const labels: Record<AttendanceStatus, string> = {
    present: 'Present',
    late: 'Late',
    half_day: 'Half Day',
    on_leave: 'On Leave',
    absent: 'Absent',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${styles[status] || styles.absent}`}>
      {labels[status] || status}
    </span>
  );
};

export const PriorityBadge: React.FC<{ priority: TaskPriority }> = ({ priority }) => {
  const styles: Record<TaskPriority, string> = {
    urgent: 'bg-[#FDECEC] text-[#DC2626] border-[#FECACA]',
    high: 'bg-[#FDE8F1] text-[#DB2777] border-[#FBCFE8]',
    medium: 'bg-[#E8F0FF] text-[#2563EB] border-[#BFDBFE]',
    low: 'bg-[#F1F1F4] text-[#6B7280] border-[#E5E7EB]',
  };
  const label = priority.charAt(0).toUpperCase() + priority.slice(1);
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${styles[priority]}`}>
      {label}
    </span>
  );
};

export const TaskStatusBadge: React.FC<{ status: TaskStatus }> = ({ status }) => {
  const styles: Record<TaskStatus, string> = {
    pending: 'bg-[#EFEAFF] text-[#6D4AFF] border-[#DDD6FE]',
    in_progress: 'bg-[#E8F0FF] text-[#2563EB] border-[#BFDBFE]',
    review: 'bg-[#FFF4E0] text-[#D97706] border-[#FDE68A]',
    completed: 'bg-[#E8F8EE] text-[#16A34A] border-[#BBF7D0]',
    blocked: 'bg-[#FDECEC] text-[#DC2626] border-[#FECACA]',
  };
  const labels: Record<TaskStatus, string> = {
    pending: 'Pending',
    in_progress: 'In Progress',
    review: 'In Review',
    completed: 'Completed',
    blocked: 'Blocked',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${styles[status]}`}>
      {labels[status]}
    </span>
  );
};
