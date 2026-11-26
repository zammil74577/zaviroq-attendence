import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttendanceStatus, DashboardData, Employee, TabId, Task, TaskPriority, ViewMode } from './types';
import { getTodayISO } from './utils/format';
import { useIdleDetector } from './hooks/useIdleDetector';
import { LoginScreen } from './components/LoginScreen';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { OverviewTab } from './components/OverviewTab';
import { AttendanceTab } from './components/AttendanceTab';
import { TasksTab } from './components/TasksTab';
import { IdleTrackerTab } from './components/IdleTrackerTab';
import { LeavesTab } from './components/LeavesTab';
import { ReportsTab } from './components/ReportsTab';
import { SalaryPayrollTab } from './components/SalaryPayrollTab';
import { ChatTab } from './components/ChatTab';
import { DirectoryTab } from './components/DirectoryTab';
import { AuditLogsTab } from './components/AuditLogsTab';
import { SettingsTab } from './components/SettingsTab';
import { MascotChatbot } from './components/MascotChatbot';

export function App() {
  const [authUser, setAuthUser] = useState<Employee | null>(null);
  const [authChecking, setAuthChecking] = useState(true);

  const isMasterAdmin = authUser?.role === 'admin' || authUser?.role === 'manager';
  const isLockedEmployee = Boolean(authUser && !isMasterAdmin);

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpiredNotice, setSessionExpiredNotice] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>('employee');
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [selectedDate, setSelectedDate] = useState<string>(getTodayISO());
  const [selectedUserId, setSelectedUserId] = useState<number>(1);
  const [idleThresholdSeconds, setIdleThresholdSeconds] = useState<number>(60);
  const [clockActionPending, setClockActionPending] = useState<boolean>(false);
  const [demoMode, setDemoMode] = useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<{ prompt: () => Promise<void> } | null>(null);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [pairingCodeInfo, setPairingCodeInfo] = useState<{ code: string; expiresAt: string } | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [profileColor, setProfileColor] = useState('#6D4AFF');
  const [profileCurrentPin, setProfileCurrentPin] = useState('');
  const [profileNewPin, setProfileNewPin] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const key = `zaviroq_theme_${authUser?.id || 'default'}`;
    try {
      const saved = localStorage.getItem(key);
      const next: 'light' | 'dark' = saved === 'dark' ? 'dark' : 'light';
      setTheme(next);
      document.documentElement.setAttribute('data-theme', next);
    } catch {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  }, [authUser?.id]);

  const toggleTheme = () => {
    const next: 'light' | 'dark' = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    const key = `zaviroq_theme_${authUser?.id || 'default'}`;
    try {
      localStorage.setItem(key, next);
    } catch {
      // ignore
    }
  };
  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as unknown as { prompt: () => Promise<void> });
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  // Verify session from server httpOnly cookie on load (never trust localStorage for role/auth)
  useEffect(() => {
    fetch('/api/auth/config').then((r) => r.json()).then((j) => setDemoMode(Boolean(j.demoMode))).catch(() => {});
    fetch('/api/auth/me')
      .then(async (res) => {
        if (!res.ok) return null;
        const json = await res.json();
        return json.employee as Employee;
      })
      .then((emp) => {
        if (emp) {
          localStorage.setItem('zaviroq_auth_user', JSON.stringify({ id: emp.id, name: emp.name, emp_code: emp.emp_code }));
          setAuthUser(emp);
          setSelectedUserId(emp.id);
          setViewMode(emp.role === 'admin' || emp.role === 'manager' ? 'admin' : 'employee');
        } else {
          localStorage.removeItem('zaviroq_auth_user');
        }
      })
      .catch(() => {})
      .finally(() => setAuthChecking(false));
  }, []);

  const handleLoginSuccess = (emp: Employee) => {
    localStorage.setItem('zaviroq_auth_user', JSON.stringify({ id: emp.id, name: emp.name, emp_code: emp.emp_code }));
    setSessionExpiredNotice(null);
    setAuthUser(emp);
    setSelectedUserId(emp.id);
    setViewMode(emp.role === 'admin' || emp.role === 'manager' ? 'admin' : 'employee');
    setActiveTab('overview');
  };

  const handleSessionExpired = useCallback(() => {
    localStorage.removeItem('zaviroq_auth_user');
    setSessionExpiredNotice('Session expired, please log in again.');
    setAuthUser(null);
    setData(null);
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    localStorage.removeItem('zaviroq_auth_user');
    setAuthUser(null);
    setData(null);
    setError(null);
    setActiveTab('overview');
  };

  const dashboardInFlightRef = useRef<boolean>(false);
  const lastDashboardSlowRef = useRef<boolean>(false);

  const fetchDashboard = useCallback(async (silent = false) => {
    if (!authUser || dashboardInFlightRef.current) return;
    dashboardInFlightRef.current = true;
    if (!silent) setIsSyncing(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    const startMs = Date.now();
    try {
      const res = await fetch(`/api/dashboard?date=${selectedDate}`, { signal: controller.signal });
      if (res.status === 401) {
        handleSessionExpired();
        return;
      }
      if (!res.ok) throw new Error(`API error (${res.status})`);
      const json: DashboardData = await res.json();
      lastDashboardSlowRef.current = Date.now() - startMs > 1500;
      setData(json);
      if (json.officeSchedule?.idleThresholdSeconds) {
        setIdleThresholdSeconds(json.officeSchedule.idleThresholdSeconds);
      }
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('Dashboard request timed out. Please retry.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
      }
    } finally {
      clearTimeout(timeoutId);
      dashboardInFlightRef.current = false;
      setLoading(false);
      setIsSyncing(false);
    }
  }, [selectedDate, authUser]);

  useEffect(() => {
    if (!authUser) return;
    fetchDashboard();
    let timer: ReturnType<typeof setTimeout>;
    const scheduleNext = () => {
      const delay = document.visibilityState !== 'visible' || lastDashboardSlowRef.current ? 15000 : 8000;
      timer = setTimeout(async () => {
        if (document.visibilityState === 'visible') {
          await fetchDashboard(true);
        }
        scheduleNext();
      }, delay);
    };
    scheduleNext();
    return () => clearTimeout(timer);
  }, [fetchDashboard, authUser]);

  const currentUser =
    data?.employees.find((e) => e.id === selectedUserId) || data?.employees[0] || null;
  const isClockedIn = Boolean(currentUser?.clock_in && !currentUser?.clock_out);
  const isReadOnlyPreview = Boolean(isMasterAdmin && viewMode === 'employee');

  useEffect(() => {
    if (!isStandalone || !isClockedIn || isReadOnlyPreview) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'Closing Zaviroq pauses tracking';
      return 'Closing Zaviroq pauses tracking';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isStandalone, isClockedIn, isReadOnlyPreview]);

  const handleInstallApp = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      setDeferredPrompt(null);
    } else {
      setShowInstallGuide(true);
    }
  };

  const {
    liveState,
    secondsSinceActivity,
    pausedByOtherTab,
    trackingMode,
    requestSystemIdleDetection,
    toggleBreak,
    forceIdle,
    claimActiveTab,
  } = useIdleDetector({
    employeeId: currentUser?.id ?? null,
    isClockedIn: isReadOnlyPreview ? false : isClockedIn,
    initialStatus: currentUser?.status ?? 'offline',
    idleThresholdSeconds,
    onSync: () => fetchDashboard(true),
    onSessionExpired: handleSessionExpired,
  });

  const handleClockIn = async () => {
    if (!currentUser || clockActionPending) return;
    setClockActionPending(true);
    try {
      const mode = await requestSystemIdleDetection();
      const tabSessionId = (() => {
        try { return sessionStorage.getItem('zaviroq_tab_session_id') || undefined; } catch { return undefined; }
      })();
      const res = await fetch('/api/attendance/clock-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: currentUser.id, trackingMode: mode, sessionId: tabSessionId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error || 'Failed to clock in');
        return;
      }
      await fetchDashboard();
    } finally {
      setClockActionPending(false);
    }
  };

  const handleClockOut = async () => {
    if (!currentUser || clockActionPending) return;
    setClockActionPending(true);
    try {
      const res = await fetch('/api/attendance/clock-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: currentUser.id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error || 'Failed to clock out');
        return;
      }
      await fetchDashboard();
    } finally {
      setClockActionPending(false);
    }
  };

  const handleUpdateAttendanceStatus = async (
    employeeId: number,
    status: AttendanceStatus,
    clock_in?: string | null,
    clock_out?: string | null
  ) => {
    const res = await fetch(`/api/attendance/${employeeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: selectedDate, status, clock_in, clock_out }),
    });
    if (res.ok) await fetchDashboard();
  };

  const handleCreateTask = async (payload: {
    title: string;
    description: string;
    assignee_id: number;
    department: string;
    priority: TaskPriority;
    due_date: string;
    estimated_minutes: number;
  }) => {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, created_by: currentUser?.id || 1 }),
    });
    if (res.ok) await fetchDashboard();
  };

  const handleUpdateTask = async (id: number, patch: Partial<Task>) => {
    const res = await fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) await fetchDashboard();
  };

  const handleDeleteTask = async (id: number) => {
    const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    if (res.ok) await fetchDashboard();
  };

  const handleAddEmployee = async (payload: {
    name: string;
    email: string;
    role: 'admin' | 'manager' | 'employee';
    department: string;
    designation: string;
    shift_start: string;
    shift_end: string;
    joining_date?: string;
  }): Promise<{ emp_code: string; name: string; tempPin?: string } | null> => {
    const res = await fetch('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setError(err.error || 'Failed to add employee');
      return null;
    }
    const created = await res.json();
    await fetchDashboard();
    return created;
  };

  const handlePostAnnouncement = async (payload: {
    title: string;
    message: string;
    priority: 'normal' | 'important';
  }) => {
    const res = await fetch('/api/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, author_id: currentUser?.id || 1 }),
    });
    if (res.ok) await fetchDashboard();
  };

  if (authChecking) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#F7F5FF] to-white flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4">
          <div className="zv-skeleton h-10 w-48 mx-auto" />
          <div className="zv-skeleton h-32 w-full" />
        </div>
      </div>
    );
  }

  if (!authUser) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} initialNotice={sessionExpiredNotice} />;
  }

  // First-login Employee Consent / Tracking Notice gate
  if (!authUser.tracking_consent_at) {
    return (
      <div className="min-h-screen bg-[#060913] text-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-900/90 p-7 shadow-2xl space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/40 bg-indigo-500/15 px-3 py-1 text-xs font-semibold text-indigo-300">
            Activity & Idle Tracking Notice
          </div>
          <h1 className="text-xl font-bold text-white">Workforce Activity & Attendance Consent</h1>
          <div className="space-y-2.5 text-xs text-slate-300 leading-relaxed">
            <p>
              To calculate daily attendance, active work hours, break durations, and overtime accurately, Zaviroq Workforce OS records:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-slate-400">
              <li>Clock-in / clock-out timestamps and break states while you are clocked in.</li>
              <li>Active vs. idle time using browser or system Idle Detection (no screenshots, keystrokes, or screen recordings are ever captured).</li>
            </ul>
            <p className="text-slate-400">
              Please keep Zaviroq open in a browser tab while working so your session stays active.
            </p>
          </div>
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              onClick={handleLogout}
              className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 cursor-pointer"
            >
              Decline & Logout
            </button>
            <button
              onClick={async () => {
                const res = await fetch('/api/auth/consent', { method: 'POST' });
                if (res.ok) {
                  const j = await res.json();
                  setAuthUser(j.employee);
                }
              }}
              className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2 text-xs font-semibold text-white cursor-pointer"
            >
              I Agree & Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#F7F5FF] to-white p-6 sm:p-10">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="zv-skeleton h-36 w-full rounded-[24px]" />
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="zv-skeleton h-28" />
            <div className="zv-skeleton h-28" />
            <div className="zv-skeleton h-28" />
            <div className="zv-skeleton h-28" />
          </div>
          <div className="zv-skeleton h-72 w-full" />
        </div>
      </div>
    );
  }

  if (!data && error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-rose-500/40 bg-slate-900 p-6 text-center space-y-4">
          <h2 className="text-base font-bold text-white">Unable to Load Dashboard</h2>
          <p className="text-xs text-rose-200">{error}</p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => {
                setLoading(true);
                fetchDashboard();
              }}
              className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
            >
              Retry
            </button>
            <button
              onClick={handleLogout}
              className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white cursor-pointer"
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    );
  }

  const pendingCount = data
    ? data.tasks.filter(
        (t) =>
          t.status !== 'completed' &&
          (viewMode === 'admin' || !currentUser || t.assignee_id === currentUser.id)
      ).length
    : 0;

  const idleCount = viewMode === 'employee'
    ? (currentUser?.status === 'idle' ? 1 : 0)
    : (data?.summary.idleNowCount || 0);

  return (
    <div className="min-h-screen flex bg-gradient-to-b from-[var(--zv-bg-start)] to-[var(--zv-bg-end)] text-[var(--zv-text)] relative overflow-x-hidden">
      {/* Subtle bottom wave decoration */}
      <svg
        aria-hidden="true"
        viewBox="0 0 1440 120"
        preserveAspectRatio="none"
        className="pointer-events-none fixed bottom-0 left-0 right-0 w-full h-20 opacity-45 z-0"
      >
        <path
          d="M0,64 C320,110 640,20 960,72 C1200,110 1350,55 1440,40 L1440,120 L0,120 Z"
          fill={theme === 'light' ? '#EFEAFF' : 'rgba(79,70,229,0.08)'}
        />
      </svg>
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        viewMode={viewMode}
        pendingCount={pendingCount}
        idleCount={idleCount}
        isOpenMobile={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          viewMode={viewMode}
          activeTab={activeTab}
          onChangeViewMode={(m) => {
            if (isLockedEmployee) return;
            setViewMode(m);
            if (m === 'admin' && authUser) {
              setSelectedUserId(authUser.id);
            }
            if (m === 'employee' && (activeTab === 'directory' || activeTab === 'salary')) {
              setActiveTab('overview');
            }
          }}
          isLockedEmployee={isLockedEmployee}
          isReadOnlyPreview={isReadOnlyPreview}
          employees={data?.employees || []}
          currentUser={currentUser}
          onSelectUser={setSelectedUserId}
          liveState={liveState}
          trackingMode={trackingMode}
          isStandalone={isStandalone}
          canInstall={Boolean(deferredPrompt)}
          onInstallApp={handleInstallApp}
          onClockIn={handleClockIn}
          onClockOut={handleClockOut}
          clockActionPending={clockActionPending}
          onToggleBreak={toggleBreak}
          onRefresh={() => fetchDashboard()}
          onLogout={handleLogout}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          selectedDate={selectedDate}
          isSyncing={isSyncing}
          theme={theme}
          onToggleTheme={toggleTheme}
          onOpenProfile={() => {
            if (authUser) {
              setProfileName(authUser.name);
              setProfileEmail(authUser.email);
              setProfileColor(authUser.avatar_color || '#6D4AFF');
              setProfileCurrentPin('');
              setProfileNewPin('');
              setProfileError(null);
              setShowProfileModal(true);
            }
          }}
        />

        <main className="flex-1 p-4 sm:p-6 pb-24 max-w-[1600px] w-full mx-auto space-y-5">
          {isReadOnlyPreview && currentUser && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-950/40 px-4 py-2 text-xs text-amber-200 flex items-center justify-between gap-2">
              <span>Previewing as <strong>{currentUser.name}</strong> — read-only</span>
            </div>
          )}
          {viewMode === 'employee' && !isReadOnlyPreview && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-2 text-xs text-slate-300 flex flex-wrap items-center justify-between gap-2">
              <span>
                {isStandalone && isClockedIn
                  ? 'Closing Zaviroq pauses tracking. Keep this app open while working.'
                  : 'Keep Zaviroq open in a tab or installed app while working.'}
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={async () => {
                    const r = await fetch('/api/devices/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
                    if (r.ok) setPairingCodeInfo(await r.json());
                  }}
                  className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 cursor-pointer"
                >
                  Connect desktop app
                </button>
                {!isStandalone && (
                  <button
                    type="button"
                    onClick={handleInstallApp}
                    className="rounded-lg border border-indigo-500/40 bg-indigo-500/15 hover:bg-indigo-500/25 px-2.5 py-1 text-[11px] font-semibold text-indigo-200 cursor-pointer"
                  >
                    {deferredPrompt ? 'Install Zaviroq app' : 'How to Install & Auto-Start'}
                  </button>
                )}
              </div>
            </div>
          )}
          {isClockedIn && (() => {
            const now = new Date();
            const [eh, em] = (currentUser?.shift_end || data?.officeSchedule?.shiftEnd || '17:30').split(':').map(Number);
            if (now.getHours() * 60 + now.getMinutes() > eh * 60 + em) {
              return (
                <div className="rounded-2xl border border-[#DDD6FE] bg-[#EFEAFF] px-4 py-2.5 text-xs font-medium text-[#3B2E7E] flex items-center justify-between gap-3 shadow-xs">
                  <span>Shift ended ({currentUser?.shift_end || '17:30'}) — remember to clock out!</span>
                  <button
                    onClick={handleClockOut}
                    className="rounded-[10px] bg-[#E11D48] hover:bg-[#BE123C] px-3.5 py-1.5 font-semibold text-white cursor-pointer shrink-0 zv-text-white-keep"
                  >
                    Clock Out Now
                  </button>
                </div>
              );
            }
            return null;
          })()}
          {pausedByOtherTab && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-950/40 px-4 py-2.5 text-xs text-amber-200 flex items-center justify-between gap-3">
              <span>You are active in another browser tab — time tracking is paused in this tab to prevent double counting.</span>
              <button
                onClick={claimActiveTab}
                className="rounded-lg bg-amber-500/20 border border-amber-400/40 px-3 py-1 font-semibold text-amber-100 hover:bg-amber-500/30 cursor-pointer shrink-0"
              >
                Track Here
              </button>
            </div>
          )}
          {error && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-xs text-rose-200 flex items-center justify-between">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="underline font-semibold cursor-pointer">
                Dismiss
              </button>
            </div>
          )}

          {data && (
            <div key={activeTab} className="zv-enter space-y-5">
              {activeTab === 'overview' && (
            <OverviewTab
              data={data}
              viewMode={viewMode}
              currentUser={currentUser}
              onNavigateTab={setActiveTab}
              onQuickTaskStatus={(id, status) => handleUpdateTask(id, { status })}
            />
          )}

          {data && activeTab === 'attendance' && (
            <AttendanceTab
              employees={data.employees}
              selectedDate={selectedDate}
              onChangeDate={setSelectedDate}
              viewMode={viewMode}
              currentUser={currentUser}
              onUpdateAttendanceStatus={handleUpdateAttendanceStatus}
            />
          )}

          {data && (activeTab === 'tasks' || activeTab === 'pending') && (
            <TasksTab
              tasks={data.tasks}
              employees={data.employees}
              viewMode={viewMode}
              currentUser={currentUser}
              pendingOnly={activeTab === 'pending'}
              todayDate={data.summary.date}
              onCreateTask={handleCreateTask}
              onUpdateTask={handleUpdateTask}
              onDeleteTask={handleDeleteTask}
            />
          )}

          {data && activeTab === 'idle' && (
            <IdleTrackerTab
              viewMode={viewMode}
              demoMode={demoMode}
              isReadOnlyPreview={isReadOnlyPreview}
              currentUser={currentUser}
              employees={data.employees}
              logs={data.logs}
              liveState={liveState}
              secondsSinceActivity={secondsSinceActivity}
              idleThresholdSeconds={idleThresholdSeconds}
              onChangeIdleThreshold={setIdleThresholdSeconds}
              onToggleBreak={toggleBreak}
              onForceIdle={forceIdle}
              onClockIn={handleClockIn}
            />
          )}

          {data && activeTab === 'leaves' && (
            <LeavesTab
              viewMode={viewMode}
              currentUser={currentUser}
              employees={data.employees}
              onRefreshDashboard={() => fetchDashboard(true)}
            />
          )}

          {data && activeTab === 'reports' && viewMode === 'admin' && (
            <ReportsTab
              data={data}
              selectedDate={selectedDate}
              onChangeDate={setSelectedDate}
              viewMode={viewMode}
              currentUser={currentUser}
            />
          )}

          {data && activeTab === 'my-monthly' && (
            <ReportsTab
              data={data}
              selectedDate={selectedDate}
              onChangeDate={setSelectedDate}
              viewMode={viewMode}
              myMonthlyOnly
              currentUser={currentUser}
            />
          )}

          {data && activeTab === 'salary' && viewMode === 'admin' && (
            <SalaryPayrollTab viewMode={viewMode} currentUser={currentUser} />
          )}

          {data && activeTab === 'chat' && (
            <ChatTab viewMode={viewMode} currentUser={currentUser} />
          )}

          {data && activeTab === 'directory' && viewMode === 'admin' && (
            <DirectoryTab
              employees={data.employees}
              currentUser={currentUser}
              viewMode={viewMode}
              onRefresh={() => fetchDashboard()}
              onAddEmployee={handleAddEmployee}
              onPostAnnouncement={handlePostAnnouncement}
            />
          )}

          {data && activeTab === 'audit' && viewMode === 'admin' && <AuditLogsTab />}

          {data && activeTab === 'settings' && viewMode === 'admin' && (
            <SettingsTab onSaved={() => fetchDashboard()} />
          )}
            </div>
          )}
        </main>
      </div>

      {data && (
        <MascotChatbot
          currentUser={currentUser}
          tasks={data.tasks}
          liveState={liveState}
          todayDate={data.summary.date}
        />
      )}

      {pairingCodeInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-emerald-500/40 bg-slate-900 p-6 shadow-2xl space-y-4">
            <h2 className="text-base font-bold text-white">Connect Desktop App</h2>
            <p className="text-xs text-slate-300">
              Enter this one-time 6-digit pairing code in the Zaviroq Desktop Agent. Valid for 10 minutes.
            </p>
            <div className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-center font-mono-num text-3xl font-bold tracking-widest text-emerald-300">
              {pairingCodeInfo.code}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setPairingCodeInfo(null)}
                className="rounded-xl bg-slate-800 hover:bg-slate-700 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {showProfileModal && authUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setProfileSaving(true);
              setProfileError(null);
              try {
                const res = await fetch('/api/profile', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name: profileName,
                    email: profileEmail,
                    avatar_color: profileColor,
                    ...(profileNewPin.trim() ? { currentPin: profileCurrentPin, newPin: profileNewPin } : {}),
                  }),
                });
                const j = await res.json();
                if (!res.ok) {
                  setProfileError(j.error || 'Failed to update profile');
                  return;
                }
                setAuthUser(j.employee);
                setShowProfileModal(false);
                await fetchDashboard(true);
              } catch {
                setProfileError('Unable to reach server.');
              } finally {
                setProfileSaving(false);
              }
            }}
            className="zv-card zv-enter w-full max-w-md p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="h-11 w-11 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0 zv-text-white-keep"
                  style={{ backgroundColor: profileColor }}
                >
                  {(profileName || authUser.name).split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase()}
                </div>
                <div>
                  <h2 className="text-base font-bold font-heading text-[var(--zv-text)]">My Profile</h2>
                  <p className="text-[11px] text-[var(--zv-muted)]">
                    {authUser.emp_code} &bull; {authUser.designation} &bull; {authUser.department}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowProfileModal(false)}
                className="rounded-lg px-2 py-1 text-xs font-semibold text-[var(--zv-muted)] hover:text-[var(--zv-text)] cursor-pointer"
              >
                Close
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--zv-text-secondary)] mb-1">Full Name</label>
              <input
                required
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--zv-text-secondary)] mb-1">Work Email</label>
              <input
                required
                type="email"
                value={profileEmail}
                onChange={(e) => setProfileEmail(e.target.value)}
                className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--zv-text-secondary)] mb-1.5">Avatar Color</label>
              <div className="flex items-center gap-2 flex-wrap">
                {['#6D4AFF', '#16A34A', '#2563EB', '#EA580C', '#DB2777', '#0F766E'].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setProfileColor(c)}
                    className={`h-7 w-7 rounded-full cursor-pointer transition-transform ${
                      profileColor.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-offset-2 ring-[#6D4AFF] scale-110' : ''
                    }`}
                    style={{ backgroundColor: c }}
                    aria-label={`Select color ${c}`}
                  />
                ))}
              </div>
            </div>

            <div className="pt-2 border-t border-[var(--zv-border)] space-y-2.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--zv-muted)]">
                Change Password / PIN (Optional)
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <input
                  type="password"
                  placeholder="Current PIN"
                  value={profileCurrentPin}
                  onChange={(e) => setProfileCurrentPin(e.target.value)}
                  className="w-full rounded-xl border px-3 py-2 text-xs font-mono-num focus:outline-none"
                />
                <input
                  type="password"
                  placeholder="New 6-digit PIN"
                  maxLength={6}
                  value={profileNewPin}
                  onChange={(e) => setProfileNewPin(e.target.value)}
                  className="w-full rounded-xl border px-3 py-2 text-xs font-mono-num focus:outline-none"
                />
              </div>
            </div>

            {profileError && (
              <div className="rounded-xl border border-[#FECACA] bg-[#FDECEC] px-3 py-2 text-xs text-[#DC2626] font-medium">
                {profileError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowProfileModal(false)}
                className="rounded-xl border border-[var(--zv-border)] px-4 py-2 text-xs font-semibold text-[var(--zv-text-secondary)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={profileSaving}
                className="rounded-xl zv-btn-primary px-4 py-2 text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
              >
                {profileSaving ? 'Saving...' : 'Save Profile'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showInstallGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-4">
            <h2 className="text-base font-bold text-white">Install Zaviroq App &amp; Auto-Start</h2>
            <ol className="list-decimal pl-5 space-y-2 text-xs text-slate-300 leading-relaxed">
              <li>Open Zaviroq in <strong>Chrome</strong> or <strong>Edge</strong> and click <strong>Install</strong> in the address bar (or menu).</li>
              <li>Open <code className="text-indigo-300">chrome://apps</code> (or <code className="text-indigo-300">edge://apps</code>).</li>
              <li>Right-click <strong>Zaviroq</strong> and enable <strong>&quot;Start app when you sign in&quot;</strong>.</li>
            </ol>
            <p className="text-[11px] text-amber-300/90">
              Note: Closing Zaviroq pauses tracking while clocked in.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowInstallGuide(false)}
                className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
