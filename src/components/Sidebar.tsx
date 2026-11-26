import React from 'react';
import {
  LayoutDashboard,
  Clock,
  CheckSquare,
  AlertCircle,
  Activity,
  Users,
  Shield,
  UserCheck,
  X,
  CalendarOff,
  FileBarChart2,
  Wallet,
  MessageSquare,
  History,
  Settings,
} from 'lucide-react';
import type { TabId, ViewMode } from '../types';

interface SidebarProps {
  activeTab: TabId;
  onSelectTab: (tab: TabId) => void;
  viewMode: ViewMode;
  pendingCount: number;
  idleCount: number;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  viewMode,
  pendingCount,
  idleCount,
  isOpenMobile,
  onCloseMobile,
}) => {
  const navItems: Array<{ id: TabId; label: string; icon: React.ReactNode; badge?: number; badgeColor?: string }> = [
    { id: 'overview', label: 'Command Overview', icon: <LayoutDashboard className="h-5 w-5" strokeWidth={1.75} /> },
    { id: 'attendance', label: 'Daily Attendance', icon: <Clock className="h-5 w-5" strokeWidth={1.75} /> },
    { id: 'tasks', label: 'All Tasks', icon: <CheckSquare className="h-5 w-5" strokeWidth={1.75} /> },
    {
      id: 'pending',
      label: 'Pending & Overdue',
      icon: <AlertCircle className="h-5 w-5" strokeWidth={1.75} />,
      badge: pendingCount > 0 ? pendingCount : undefined,
      badgeColor: 'bg-[#FFF4E0] text-[#D97706] border-[#FDE68A]',
    },
    {
      id: 'idle',
      label: 'Live Idle & Activity',
      icon: <Activity className="h-5 w-5" strokeWidth={1.75} />,
      badge: idleCount > 0 ? idleCount : undefined,
      badgeColor: 'bg-[#FDECEC] text-[#DC2626] border-[#FECACA]',
    },
    { id: 'leaves', label: 'Leaves & Time-Off', icon: <CalendarOff className="h-5 w-5" strokeWidth={1.75} /> },
    ...(viewMode === 'admin'
      ? [
          { id: 'reports' as TabId, label: 'Daily & Monthly Reports', icon: <FileBarChart2 className="h-5 w-5" strokeWidth={1.75} /> },
          { id: 'salary' as TabId, label: 'Salary & Payroll', icon: <Wallet className="h-5 w-5" strokeWidth={1.75} /> },
        ]
      : [
          { id: 'my-monthly' as TabId, label: 'My Monthly Report', icon: <FileBarChart2 className="h-5 w-5" strokeWidth={1.75} /> },
        ]),
    { id: 'chat', label: 'Team Chat & Bot', icon: <MessageSquare className="h-5 w-5" strokeWidth={1.75} /> },
    ...(viewMode === 'admin'
      ? [
          { id: 'directory' as TabId, label: 'Team & Directory', icon: <Users className="h-5 w-5" strokeWidth={1.75} /> },
          { id: 'audit' as TabId, label: 'Audit Log', icon: <History className="h-5 w-5" strokeWidth={1.75} /> },
          { id: 'settings' as TabId, label: 'Admin Settings', icon: <Settings className="h-5 w-5" strokeWidth={1.75} /> },
        ]
      : []),
  ];

  const content = (
    <div className="flex h-full flex-col justify-between bg-[var(--zv-surface)] border-r border-[var(--zv-border)] px-3.5 py-5">
      <div>
        <div className="flex items-center justify-between px-2.5 mb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#6D4AFF] to-[#8B5CF6] font-extrabold text-lg text-white shadow-md shadow-violet-500/30 zv-text-white-keep">
              Z
            </div>
            <div>
              <div className="text-sm font-extrabold tracking-tight font-heading text-[var(--zv-text)]">ZAVIROQ</div>
              <div className="text-[11px] font-medium text-[var(--zv-muted)]">Workforce OS v2.0</div>
            </div>
          </div>
          <button
            onClick={onCloseMobile}
            className="lg:hidden rounded-lg p-1.5 text-[var(--zv-muted)] hover:bg-[var(--zv-surface-subtle)]"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-3 mb-2 text-[11px] font-bold uppercase tracking-wider text-[var(--zv-muted)]">
          {viewMode === 'admin' ? 'Operations & HR' : 'My Workspace'}
        </div>

        <nav className="space-y-1">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onSelectTab(item.id);
                  onCloseMobile();
                }}
                className={`w-full h-[44px] flex items-center justify-between rounded-[12px] px-3 text-[13.5px] font-semibold transition-all duration-150 cursor-pointer ${
                  active
                    ? 'zv-btn-primary text-white zv-text-white-keep'
                    : 'text-[var(--zv-text-secondary)] hover:bg-[#F3F0FF] hover:text-[#6D4AFF]'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <span className="shrink-0">{item.icon}</span>
                  <span className="truncate">{item.label}</span>
                </span>
                {item.badge !== undefined && (
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-bold tabular-nums shrink-0 ${
                      active
                        ? 'bg-white/20 text-white border-white/30 zv-text-white-keep'
                        : item.badgeColor
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="mt-6 rounded-2xl border border-[var(--zv-border)] bg-[var(--zv-surface-subtle)] p-3 text-xs">
        <div className="flex items-center gap-2 font-semibold text-[var(--zv-text)]">
          {viewMode === 'admin' ? (
            <>
              <Shield className="h-4 w-4 text-[#6D4AFF]" />
              <span>Admin Command Mode</span>
            </>
          ) : (
            <>
              <UserCheck className="h-4 w-4 text-[#16A34A]" />
              <span>Employee View Mode</span>
            </>
          )}
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--zv-muted)]">
          {viewMode === 'admin'
            ? 'Full org visibility: live desk telemetry, tasks & payroll.'
            : 'Personal shift timer, tasks, leaves & team chat.'}
        </p>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block w-[260px] shrink-0 h-screen sticky top-0">{content}</aside>
      {isOpenMobile && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-[260px] h-full">{content}</div>
          <div className="flex-1 bg-slate-950/50 backdrop-blur-xs" onClick={onCloseMobile} />
        </div>
      )}
    </>
  );
};
