import React, { useEffect, useRef, useState } from 'react';
import {
  Menu,
  Play,
  Square,
  Coffee,
  Download,
  RefreshCw,
  Shield,
  User,
  LogOut,
  Bell,
} from 'lucide-react';
import type { AppNotification, Employee, TabId, ViewMode } from '../types';
import { LiveStatusBadge } from './StatusBadge';

interface TopBarProps {
  viewMode: ViewMode;
  activeTab: TabId;
  onChangeViewMode: (mode: ViewMode) => void;
  isLockedEmployee?: boolean;
  employees: Employee[];
  currentUser: Employee | null;
  onSelectUser: (id: number) => void;
  liveState: 'active' | 'idle' | 'break';
  onClockIn: () => void;
  onClockOut: () => void;
  clockActionPending?: boolean;
  onToggleBreak: () => void;
  onRefresh: () => void;
  onLogout: () => void;
  onOpenMobileMenu: () => void;
  selectedDate: string;
  isSyncing: boolean;
}

export const TopBar: React.FC<TopBarProps> = ({
  viewMode,
  activeTab,
  onChangeViewMode,
  isLockedEmployee = false,
  employees,
  currentUser,
  onSelectUser,
  liveState,
  onClockIn,
  onClockOut,
  clockActionPending = false,
  onToggleBreak,
  onRefresh,
  onLogout,
  onOpenMobileMenu,
  selectedDate,
  isSyncing,
}) => {
  const [clockText, setClockText] = useState(() =>
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  );
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const [showNotifs, setShowNotifs] = useState(false);
  const notifContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setShowNotifs(false);
  }, [activeTab]);

  useEffect(() => {
    if (!showNotifs) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowNotifs(false);
    };
    const onClickOutside = (e: MouseEvent) => {
      if (notifContainerRef.current && !notifContainerRef.current.contains(e.target as Node)) {
        setShowNotifs(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClickOutside);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClickOutside);
    };
  }, [showNotifs]);

  const unreadNotifications = notifications.filter((n) => !dismissedIds.includes(n.id));

  useEffect(() => {
    const t = setInterval(() => {
      setClockText(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetch('/api/notifications')
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setNotifications(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, [selectedDate, isSyncing]);

  const isClockedIn = Boolean(currentUser?.clock_in && !currentUser?.clock_out);
  const effectiveLiveStatus = isClockedIn ? liveState : 'offline';

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md px-4 sm:px-6 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: Mobile Menu + Role Switcher + Acting User */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={onOpenMobileMenu}
            className="lg:hidden rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-300 hover:bg-slate-800"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Dual-Mode Role Switcher (hidden when locked to a dedicated ?employee=CODE workspace) */}
          {!isLockedEmployee && (
            <div className="inline-flex rounded-xl border border-slate-800 bg-slate-900 p-1">
              <button
                onClick={() => onChangeViewMode('admin')}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  viewMode === 'admin'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Shield className="h-3.5 w-3.5" />
                Admin Command
              </button>
              <button
                onClick={() => onChangeViewMode('employee')}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  viewMode === 'employee'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <User className="h-3.5 w-3.5" />
                Employee View
              </button>
            </div>
          )}

          {/* Acting Employee Selector (or locked badge in personal workspace) */}
          {currentUser && (
            <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/90 px-2.5 py-1.5">
              <span
                className="h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                style={{ backgroundColor: currentUser.avatar_color }}
              >
                {currentUser.name
                  .split(' ')
                  .slice(0, 2)
                  .map((n) => n[0])
                  .join('')}
              </span>
              {isLockedEmployee ? (
                <span className="text-xs font-semibold text-slate-100 pr-1">
                  {currentUser.name} ({currentUser.emp_code})
                </span>
              ) : (
                <select
                  value={currentUser.id}
                  onChange={(e) => onSelectUser(Number(e.target.value))}
                  aria-label="Select active employee"
                  className="bg-transparent text-xs font-medium text-slate-200 focus:outline-none cursor-pointer pr-1"
                >
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id} className="bg-slate-900 text-slate-200">
                      {emp.name} ({emp.emp_code})
                    </option>
                  ))}
                </select>
              )}
              <LiveStatusBadge status={effectiveLiveStatus} />
            </div>
          )}
        </div>

        {/* Right: Live Clock + Quick Shift Actions + Export */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="hidden sm:flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-1.5 text-xs text-slate-300 font-mono-num">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>{clockText}</span>
          </div>

          {!isClockedIn ? (
            <button
              onClick={onClockIn}
              disabled={clockActionPending}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors cursor-pointer"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              {clockActionPending ? 'Clocking In...' : 'Clock In'}
            </button>
          ) : (
            <>
              <button
                onClick={onToggleBreak}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                  liveState === 'break'
                    ? 'border-sky-500/40 bg-sky-500/20 text-sky-200 hover:bg-sky-500/30'
                    : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
                }`}
              >
                <Coffee className="h-3.5 w-3.5" />
                {liveState === 'break' ? 'Resume Work' : 'Take Break'}
              </button>
              <button
                onClick={onClockOut}
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600/90 hover:bg-rose-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors cursor-pointer"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                Clock Out
              </button>
            </>
          )}

          {viewMode === 'admin' && (
            <a
              href={`/api/export/attendance?date=${selectedDate}`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors"
              title="Export Daily Attendance CSV"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Export CSV</span>
            </a>
          )}

          <button
            onClick={onRefresh}
            className="rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-800 p-2 text-slate-400 hover:text-white transition-colors cursor-pointer"
            title="Refresh live data"
            aria-label="Refresh live data"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin text-indigo-400' : ''}`} />
          </button>

          <div ref={notifContainerRef} className="relative">
            <button
              onClick={() => setShowNotifs((v) => !v)}
              className="relative rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-800 p-2 text-slate-300 hover:text-white cursor-pointer"
              title="Notifications"
              aria-label="Notifications"
            >
              <Bell className="h-3.5 w-3.5" />
              {unreadNotifications.length > 0 && (
                <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {unreadNotifications.length}
                </span>
              )}
            </button>
            {showNotifs && (
              <div className="absolute right-0 mt-2 w-80 max-w-[90vw] rounded-2xl border border-slate-800 bg-slate-900 p-3 shadow-2xl z-50 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-white border-b border-slate-800 pb-2">
                  <span>Notifications ({unreadNotifications.length})</span>
                  {unreadNotifications.length > 0 && (
                    <button
                      onClick={() => setDismissedIds(notifications.map((n) => n.id))}
                      className="text-[11px] font-medium text-indigo-400 hover:text-indigo-300 cursor-pointer"
                    >
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {unreadNotifications.map((n) => (
                    <div key={n.id} className="rounded-xl border border-slate-800 bg-slate-950/80 p-2.5 text-xs">
                      <div className="font-semibold text-amber-300">{n.title}</div>
                      <div className="text-slate-300 text-[11px] mt-0.5">{n.message}</div>
                    </div>
                  ))}
                  {unreadNotifications.length === 0 && (
                    <div className="text-xs text-slate-500 py-3 text-center">All caught up — no unread alerts.</div>
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-300 transition-colors cursor-pointer"
            title="Sign out to Entry Scanner"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </div>
    </header>
  );
};
