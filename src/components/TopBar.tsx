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
  MoreHorizontal,
  Sun,
  Moon,
  ChevronDown,
} from 'lucide-react';
import type { AppNotification, Employee, TabId, ViewMode } from '../types';
import { LiveStatusBadge } from './StatusBadge';

interface TopBarProps {
  viewMode: ViewMode;
  activeTab: TabId;
  onChangeViewMode: (mode: ViewMode) => void;
  isLockedEmployee?: boolean;
  isReadOnlyPreview?: boolean;
  employees: Employee[];
  currentUser: Employee | null;
  onSelectUser: (id: number) => void;
  liveState: 'active' | 'idle' | 'break';
  trackingMode?: 'app_system' | 'system' | 'tab_only';
  isStandalone?: boolean;
  canInstall?: boolean;
  onInstallApp?: () => void;
  onClockIn: () => void;
  onClockOut: () => void;
  clockActionPending?: boolean;
  onToggleBreak: () => void;
  onRefresh: () => void;
  onLogout: () => void;
  onOpenMobileMenu: () => void;
  selectedDate: string;
  isSyncing: boolean;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
  onOpenProfile?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  viewMode,
  activeTab,
  onChangeViewMode,
  isLockedEmployee = false,
  isReadOnlyPreview = false,
  employees,
  currentUser,
  onSelectUser,
  liveState,
  trackingMode = 'tab_only',
  isStandalone = false,
  canInstall = false,
  onInstallApp,
  onClockIn,
  onClockOut,
  clockActionPending = false,
  onToggleBreak,
  onRefresh,
  onLogout,
  onOpenMobileMenu,
  selectedDate,
  isSyncing,
  theme = 'light',
  onToggleTheme,
  onOpenProfile,
}) => {
  const [clockText, setClockText] = useState(() =>
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  );
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showMobileMore, setShowMobileMore] = useState(false);
  const notifContainerRef = useRef<HTMLDivElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setShowNotifs(false);
    setShowUserMenu(false);
    setShowMobileMore(false);
  }, [activeTab]);

  useEffect(() => {
    if (!showNotifs && !showUserMenu && !showMobileMore) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowNotifs(false);
        setShowUserMenu(false);
        setShowMobileMore(false);
      }
    };
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (notifContainerRef.current && !notifContainerRef.current.contains(target)) setShowNotifs(false);
      if (userMenuRef.current && !userMenuRef.current.contains(target)) setShowUserMenu(false);
      if (mobileMoreRef.current && !mobileMoreRef.current.contains(target)) setShowMobileMore(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClickOutside);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClickOutside);
    };
  }, [showNotifs, showUserMenu, showMobileMore]);

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
      .then((list) => {
        const items: AppNotification[] = Array.isArray(list) ? list : [];
        setNotifications(items);
        const leaveNotif = items.find((n) => n.type === 'leave_granted');
        if (leaveNotif && currentUser) {
          const seenKey = `zaviroq_seen_notif_${currentUser.id}_${leaveNotif.id}`;
          try {
            if (!localStorage.getItem(seenKey)) {
              localStorage.setItem(seenKey, '1');
              window.dispatchEvent(
                new CustomEvent('zaviroq:celebrate', {
                  detail: {
                    id: leaveNotif.id,
                    kind: 'leave_granted',
                    title: leaveNotif.title,
                    message: leaveNotif.message,
                    dropItems: true,
                  },
                })
              );
            }
          } catch {
            // ignore
          }
        }
      })
      .catch(() => {});
  }, [selectedDate, isSyncing, currentUser?.id]);

  const isClockedIn = Boolean(currentUser?.clock_in && !currentUser?.clock_out);
  const effectiveLiveStatus = isClockedIn ? (currentUser?.status || liveState) : 'offline';
  const initials = currentUser
    ? currentUser.name
        .split(' ')
        .slice(0, 2)
        .map((n) => n[0])
        .join('')
    : 'ZV';

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--zv-border)] bg-[var(--zv-surface)]/95 backdrop-blur-md px-3 sm:px-6 py-2.5 shadow-[0_4px_16px_rgba(91,72,180,0.05)]">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        {/* Left: Mobile Menu + Role Switcher + Acting User */}
        <div className="flex items-center gap-2.5 flex-wrap min-w-0">
          <button
            onClick={onOpenMobileMenu}
            className="lg:hidden rounded-xl border border-[var(--zv-border)] bg-[var(--zv-surface)] p-2 text-[var(--zv-text-secondary)] hover:bg-[var(--zv-surface-subtle)] cursor-pointer"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Dual-Mode Role Switcher */}
          {!isLockedEmployee && (
            <div className="inline-flex rounded-xl border border-[var(--zv-border)] bg-[var(--zv-surface-subtle)] p-1">
              <button
                onClick={() => onChangeViewMode('admin')}
                className={`flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-semibold transition-all duration-150 cursor-pointer ${
                  viewMode === 'admin'
                    ? 'zv-btn-primary text-white zv-text-white-keep'
                    : 'text-[var(--zv-muted)] hover:text-[var(--zv-text)]'
                }`}
              >
                <Shield className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Admin Command</span>
                <span className="sm:hidden">Admin</span>
              </button>
              <button
                onClick={() => onChangeViewMode('employee')}
                className={`flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-semibold transition-all duration-150 cursor-pointer ${
                  viewMode === 'employee'
                    ? 'zv-btn-primary text-white zv-text-white-keep'
                    : 'text-[var(--zv-muted)] hover:text-[var(--zv-text)]'
                }`}
              >
                <User className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Employee View</span>
                <span className="sm:hidden">Employee</span>
              </button>
            </div>
          )}

          {/* Acting Employee Selector Pill */}
          {currentUser && (
            <div className="flex items-center gap-2 rounded-full border border-[var(--zv-border)] bg-[var(--zv-surface)] px-2.5 py-1 shadow-xs max-w-full">
              <span
                className="h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0 zv-text-white-keep"
                style={{ backgroundColor: currentUser.avatar_color }}
              >
                {initials}
              </span>
              {isLockedEmployee ? (
                <span className="text-xs font-semibold text-[var(--zv-text)] pr-1 truncate max-w-[140px] sm:max-w-none">
                  {currentUser.name} ({currentUser.emp_code})
                </span>
              ) : (
                <div className="relative flex items-center">
                  <select
                    value={currentUser.id}
                    onChange={(e) => onSelectUser(Number(e.target.value))}
                    aria-label="Select active employee"
                    className="appearance-none bg-transparent border-none text-xs font-semibold text-[var(--zv-text)] focus:outline-none cursor-pointer pr-6 max-w-[145px] sm:max-w-[210px] truncate"
                  >
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name} ({emp.emp_code})
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="h-3.5 w-3.5 text-[var(--zv-muted)] pointer-events-none -ml-4" />
                </div>
              )}
              <LiveStatusBadge status={effectiveLiveStatus} />
              {isClockedIn && !isReadOnlyPreview && (
                <span
                  className={`hidden xl:inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                    trackingMode === 'app_system' || trackingMode === 'system'
                      ? 'border-[#BBF7D0] bg-[#E8F8EE] text-[#16A34A]'
                      : 'border-[#FDE68A] bg-[#FFF4E0] text-[#D97706]'
                  }`}
                >
                  {trackingMode === 'app_system'
                    ? 'App (system)'
                    : trackingMode === 'system'
                    ? 'Tab (system)'
                    : 'Tab only'}
                </span>
              )}
              {isStandalone ? (
                <span className="hidden md:inline-flex items-center rounded-full border border-[#BBF7D0] bg-[#E8F8EE] px-2.5 py-0.5 text-[11px] font-semibold text-[#16A34A]">
                  Installed ✓
                </span>
              ) : (
                onInstallApp && (
                  <button
                    type="button"
                    onClick={onInstallApp}
                    className="hidden md:inline-flex items-center gap-1 rounded-full border border-[#DDD6FE] bg-[#EFEAFF] hover:bg-[#E4DCFF] px-2.5 py-1 text-[11px] font-semibold text-[#6D4AFF] transition-colors cursor-pointer"
                  >
                    <Download className="h-3 w-3" />
                    {canInstall ? 'Install Zaviroq App' : 'Install App Guide'}
                  </button>
                )
              )}
            </div>
          )}
        </div>

        {/* Right: Live Clock + Shift Actions + Bell + User Avatar Menu */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="hidden sm:flex items-center gap-2 rounded-full border border-[var(--zv-border)] bg-[var(--zv-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--zv-text)] tabular-nums">
            <span className="h-2 w-2 rounded-full bg-[#16A34A] animate-pulse" />
            <span>{clockText}</span>
          </div>

          {!isReadOnlyPreview && (
            !isClockedIn ? (
              <button
                onClick={onClockIn}
                disabled={clockActionPending}
                className="inline-flex items-center gap-1.5 rounded-[12px] bg-[#16A34A] hover:bg-[#15803D] disabled:opacity-50 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors cursor-pointer zv-text-white-keep"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                {clockActionPending ? 'Clocking In...' : 'Clock In'}
              </button>
            ) : (
              <>
                <button
                  onClick={onToggleBreak}
                  className={`inline-flex items-center gap-1.5 rounded-[12px] border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                    liveState === 'break'
                      ? 'border-[#BFDBFE] bg-[#E8F0FF] text-[#2563EB]'
                      : 'border-[var(--zv-border)] bg-[var(--zv-surface)] text-[var(--zv-text)] hover:bg-[var(--zv-surface-subtle)]'
                  }`}
                >
                  <Coffee className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{liveState === 'break' ? 'Resume Work' : 'Take Break'}</span>
                  <span className="sm:hidden">{liveState === 'break' ? 'Resume' : 'Break'}</span>
                </button>
                <button
                  onClick={onClockOut}
                  className="inline-flex items-center gap-1.5 rounded-[12px] bg-[#E11D48] hover:bg-[#BE123C] px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors cursor-pointer zv-text-white-keep"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                  Clock Out
                </button>
              </>
            )
          )}

          {viewMode === 'admin' && (
            <a
              href={`/api/export/attendance?date=${selectedDate}`}
              className="hidden md:inline-flex items-center gap-1.5 rounded-[12px] border border-[var(--zv-border)] bg-[var(--zv-surface)] hover:bg-[var(--zv-surface-subtle)] px-3 py-1.5 text-xs font-semibold text-[var(--zv-text-secondary)] transition-colors"
              title="Export Daily Attendance CSV"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">Export CSV</span>
            </a>
          )}

          <button
            onClick={onRefresh}
            className="hidden md:inline-flex rounded-[12px] border border-[var(--zv-border)] bg-[var(--zv-surface)] hover:bg-[var(--zv-surface-subtle)] p-2 text-[var(--zv-muted)] hover:text-[#6D4AFF] transition-colors cursor-pointer"
            title="Refresh live data"
            aria-label="Refresh live data"
          >
            <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin text-[#6D4AFF]' : ''}`} />
          </button>

          {/* Mobile Overflow ("⋯") Menu */}
          <div ref={mobileMoreRef} className="relative md:hidden">
            <button
              type="button"
              onClick={() => setShowMobileMore((v) => !v)}
              className="rounded-[12px] border border-[var(--zv-border)] bg-[var(--zv-surface)] p-2 text-[var(--zv-text-secondary)] cursor-pointer"
              aria-label="More actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {showMobileMore && (
              <div className="absolute right-0 mt-2 w-52 rounded-2xl border border-[var(--zv-border)] bg-[var(--zv-surface)] p-2 shadow-xl z-50 space-y-1 text-xs">
                <button
                  onClick={() => { onRefresh(); setShowMobileMore(false); }}
                  className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-left text-[var(--zv-text)] hover:bg-[var(--zv-surface-subtle)] cursor-pointer"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Refresh Data
                </button>
                {viewMode === 'admin' && (
                  <a
                    href={`/api/export/attendance?date=${selectedDate}`}
                    className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-[var(--zv-text)] hover:bg-[var(--zv-surface-subtle)]"
                  >
                    <Download className="h-3.5 w-3.5" /> Export Attendance CSV
                  </a>
                )}
                {!isStandalone && onInstallApp && (
                  <button
                    onClick={() => { onInstallApp(); setShowMobileMore(false); }}
                    className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-left text-[#6D4AFF] hover:bg-[#EFEAFF] cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5" /> {canInstall ? 'Install Zaviroq App' : 'Install App Guide'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Notifications Bell */}
          <div ref={notifContainerRef} className="relative">
            <button
              onClick={() => setShowNotifs((v) => !v)}
              className="relative rounded-full border border-[var(--zv-border)] bg-[var(--zv-surface)] hover:bg-[var(--zv-surface-subtle)] p-2 text-[var(--zv-text-secondary)] cursor-pointer"
              title="Notifications"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" />
              {unreadNotifications.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-[#E11D48] text-white text-[9px] font-bold flex items-center justify-center zv-text-white-keep">
                  {unreadNotifications.length}
                </span>
              )}
            </button>
            {showNotifs && (
              <div className="absolute right-0 mt-2 w-80 max-w-[90vw] rounded-2xl border border-[var(--zv-border)] bg-[var(--zv-surface)] p-3.5 shadow-2xl z-50 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-[var(--zv-text)] border-b border-[var(--zv-border)] pb-2">
                  <span>Notifications ({unreadNotifications.length})</span>
                  {unreadNotifications.length > 0 && (
                    <button
                      onClick={() => setDismissedIds(notifications.map((n) => n.id))}
                      className="text-[11px] font-semibold text-[#6D4AFF] hover:underline cursor-pointer"
                    >
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {unreadNotifications.map((n) => (
                    <div key={n.id} className="rounded-xl border border-[var(--zv-border)] bg-[var(--zv-surface-subtle)] p-2.5 text-xs">
                      <div className="font-semibold text-[#D97706]">{n.title}</div>
                      <div className="text-[var(--zv-text-secondary)] text-[11px] mt-0.5">{n.message}</div>
                    </div>
                  ))}
                  {unreadNotifications.length === 0 && (
                    <div className="text-xs text-[var(--zv-muted)] py-3 text-center">All caught up — no unread alerts.</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* User Avatar Circle Menu (Theme Toggle + Logout) */}
          <div ref={userMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setShowUserMenu((v) => !v)}
              className="h-9 w-9 rounded-full bg-gradient-to-br from-[#6D4AFF] to-[#8B5CF6] text-white text-xs font-bold flex items-center justify-center shadow-sm cursor-pointer zv-text-white-keep"
              title="Account & Theme"
              aria-label="Account & Theme"
            >
              {initials}
            </button>
            {showUserMenu && (
              <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-[var(--zv-border)] bg-[var(--zv-surface)] p-2 shadow-2xl z-50 space-y-1 text-xs">
                {currentUser && (
                  <div className="px-3 py-2 border-b border-[var(--zv-border)]">
                    <div className="font-bold text-[var(--zv-text)] truncate">{currentUser.name}</div>
                    <div className="text-[11px] text-[var(--zv-muted)]">{currentUser.emp_code} &bull; {currentUser.role}</div>
                  </div>
                )}
                {onOpenProfile && (
                  <button
                    type="button"
                    onClick={() => { onOpenProfile(); setShowUserMenu(false); }}
                    className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-[var(--zv-text)] hover:bg-[var(--zv-surface-subtle)] font-medium cursor-pointer"
                  >
                    <User className="h-3.5 w-3.5 text-[#6D4AFF]" />
                    My Profile
                  </button>
                )}
                {onToggleTheme && (
                  <button
                    type="button"
                    onClick={() => { onToggleTheme(); setShowUserMenu(false); }}
                    className="w-full flex items-center justify-between rounded-xl px-3 py-2 text-[var(--zv-text)] hover:bg-[var(--zv-surface-subtle)] cursor-pointer"
                  >
                    <span className="flex items-center gap-2 font-medium">
                      {theme === 'light' ? <Moon className="h-3.5 w-3.5 text-[#6D4AFF]" /> : <Sun className="h-3.5 w-3.5 text-amber-400" />}
                      {theme === 'light' ? 'Switch to Dark Theme' : 'Switch to Premium Light'}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { setShowUserMenu(false); onLogout(); }}
                  className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-[#E11D48] font-semibold hover:bg-[#FDECEC] cursor-pointer"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
