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
    { id: 'overview', label: 'Command Overview', icon: <LayoutDashboard className="h-4 w-4" /> },
    { id: 'attendance', label: 'Daily Attendance', icon: <Clock className="h-4 w-4" /> },
    { id: 'tasks', label: 'All Tasks', icon: <CheckSquare className="h-4 w-4" /> },
    {
      id: 'pending',
      label: 'Pending & Overdue',
      icon: <AlertCircle className="h-4 w-4" />,
      badge: pendingCount,
      badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    },
    {
      id: 'idle',
      label: 'Live Idle & Activity',
      icon: <Activity className="h-4 w-4" />,
      badge: idleCount > 0 ? idleCount : undefined,
      badgeColor: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
    },
    { id: 'leaves', label: 'Leaves & Time-Off', icon: <CalendarOff className="h-4 w-4" /> },
    ...(viewMode === 'admin'
      ? [
          { id: 'reports' as TabId, label: 'Daily & Monthly Reports', icon: <FileBarChart2 className="h-4 w-4" /> },
          { id: 'salary' as TabId, label: 'Salary & Payroll', icon: <Wallet className="h-4 w-4" /> },
        ]
      : [
          { id: 'my-monthly' as TabId, label: 'My Monthly Report', icon: <FileBarChart2 className="h-4 w-4" /> },
        ]),
    { id: 'chat', label: 'Team Chat & Bot', icon: <MessageSquare className="h-4 w-4" /> },
    ...(viewMode === 'admin'
      ? [
          { id: 'directory' as TabId, label: 'Team & Directory', icon: <Users className="h-4 w-4" /> },
          { id: 'audit' as TabId, label: 'Audit Log', icon: <History className="h-4 w-4" /> },
          { id: 'settings' as TabId, label: 'Admin Settings', icon: <Settings className="h-4 w-4" /> },
        ]
      : []),
  ];

  const content = (
    <div className="flex h-full flex-col justify-between bg-slate-900/95 border-r border-slate-800/80 px-3 py-5">
      <div>
        <div className="flex items-center justify-between px-3 mb-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-500 font-bold text-white shadow-lg shadow-indigo-500/25">
              Z
            </div>
            <div>
              <div className="text-sm font-bold tracking-tight text-white">ZAVIROQ</div>
              <div className="text-[11px] font-medium text-slate-400">Workforce OS v2.0</div>
            </div>
          </div>
          <button
            onClick={onCloseMobile}
            className="lg:hidden rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-3 mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
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
                className={`w-full flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                  active
                    ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 shadow-sm'
                    : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100 border border-transparent'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  {item.icon}
                  {item.label}
                </span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold font-mono-num ${item.badgeColor}`}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-200 mb-1">
          {viewMode === 'admin' ? (
            <>
              <Shield className="h-3.5 w-3.5 text-indigo-400" />
              Admin Command Mode
            </>
          ) : (
            <>
              <UserCheck className="h-3.5 w-3.5 text-emerald-400" />
              Employee Self-Service
            </>
          )}
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400">
          {viewMode === 'admin'
            ? 'Viewing organization-wide attendance, idle telemetry, and task pipelines.'
            : 'Viewing your personal shift clock, active/idle timer, and assigned tasks.'}
        </p>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block w-64 shrink-0 lg:sticky lg:top-0 lg:h-screen">{content}</aside>
      {isOpenMobile && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={onCloseMobile} />
          <div className="relative z-10 w-72 max-w-[85vw]">{content}</div>
        </div>
      )}
    </>
  );
};
