import { useCallback, useEffect, useState } from 'react';
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

  const fetchDashboard = useCallback(async (silent = false) => {
    if (!authUser) return;
    if (!silent) setIsSyncing(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(`/api/dashboard?date=${selectedDate}`, { signal: controller.signal });
      if (res.status === 401) {
        handleSessionExpired();
        return;
      }
      if (!res.ok) throw new Error(`API error (${res.status})`);
      const json: DashboardData = await res.json();
      setData(json);
      if (json.officeSchedule?.idleThresholdSeconds) {
        setIdleThresholdSeconds(json.officeSchedule.idleThresholdSeconds);
      }
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('Dashboard request timed out after 10s. Please retry.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
      }
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
      setIsSyncing(false);
    }
  }, [selectedDate, authUser]);

  useEffect(() => {
    if (!authUser) return;
    fetchDashboard();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') fetchDashboard(true);
    }, 8000);
    return () => clearInterval(timer);
  }, [fetchDashboard, authUser]);

  const currentUser =
    data?.employees.find((e) => e.id === selectedUserId) || data?.employees[0] || null;
  const isClockedIn = Boolean(currentUser?.clock_in && !currentUser?.clock_out);
  const isReadOnlyPreview = Boolean(isMasterAdmin && viewMode === 'employee');

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
      const res = await fetch('/api/attendance/clock-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: currentUser.id, trackingMode: mode }),
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
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-300 text-sm">
        Verifying session...
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
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-300 text-sm">
        Initializing Zaviroq Workforce OS...
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
    <div className="min-h-screen flex bg-slate-950 text-slate-100">
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
          onClockIn={handleClockIn}
          onClockOut={handleClockOut}
          clockActionPending={clockActionPending}
          onToggleBreak={toggleBreak}
          onRefresh={() => fetchDashboard()}
          onLogout={handleLogout}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          selectedDate={selectedDate}
          isSyncing={isSyncing}
        />

        <main className="flex-1 p-4 sm:p-6 pb-24 max-w-[1600px] w-full mx-auto space-y-5">
          {isReadOnlyPreview && currentUser && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-950/40 px-4 py-2 text-xs text-amber-200 flex items-center justify-between gap-2">
              <span>Previewing as <strong>{currentUser.name}</strong> — read-only</span>
            </div>
          )}
          {viewMode === 'employee' && !isReadOnlyPreview && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-2 text-xs text-slate-300 flex items-center justify-between gap-2">
              <span>Keep Zaviroq open in a tab while working.</span>
            </div>
          )}
          {isClockedIn && (() => {
            const now = new Date();
            const [eh, em] = (currentUser?.shift_end || data?.officeSchedule?.shiftEnd || '17:30').split(':').map(Number);
            if (now.getHours() * 60 + now.getMinutes() > eh * 60 + em) {
              return (
                <div className="rounded-xl border border-indigo-500/40 bg-indigo-950/50 px-4 py-2.5 text-xs text-indigo-200 flex items-center justify-between gap-3">
                  <span>Shift ended ({currentUser?.shift_end || '17:30'}) — remember to clock out!</span>
                  <button
                    onClick={handleClockOut}
                    className="rounded-lg bg-rose-600 hover:bg-rose-500 px-3 py-1 font-semibold text-white cursor-pointer shrink-0"
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

          {data && activeTab === 'overview' && (
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
    </div>
  );
}

export default App;
