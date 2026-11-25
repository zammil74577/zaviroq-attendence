import React from 'react';
import { Activity, Coffee, PauseCircle, Play, ShieldAlert } from 'lucide-react';
import type { ActivityLog, Employee } from '../types';
import { calcProductivity, formatDuration, formatHM, formatRelativeTime } from '../utils/format';
import { LiveStatusBadge } from './StatusBadge';

interface IdleTrackerTabProps {
  viewMode: 'admin' | 'employee';
  demoMode?: boolean;
  currentUser: Employee | null;
  employees: Employee[];
  logs: ActivityLog[];
  liveState: 'active' | 'idle' | 'break';
  secondsSinceActivity: number;
  idleThresholdSeconds: number;
  onChangeIdleThreshold: (sec: number) => void;
  onToggleBreak: () => void;
  onForceIdle: () => void;
  onClockIn: () => void;
}

export const IdleTrackerTab: React.FC<IdleTrackerTabProps> = ({
  viewMode,
  demoMode = false,
  currentUser,
  employees,
  logs,
  liveState,
  secondsSinceActivity,
  idleThresholdSeconds,
  onChangeIdleThreshold,
  onToggleBreak,
  onForceIdle,
  onClockIn,
}) => {
  const isClockedIn = Boolean(currentUser?.clock_in && !currentUser?.clock_out);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Live Idle & Activity Telemetry</h1>
          <p className="text-xs text-slate-400">
            Real-time keyboard/mouse inactivity detection, break logging, and active vs idle analytics
          </p>
        </div>

        {viewMode === 'admin' && (
          <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-1.5">
            <span className="text-xs text-slate-400">Idle Threshold ({idleThresholdSeconds} seconds):</span>
            <select
              value={idleThresholdSeconds}
              onChange={(e) => onChangeIdleThreshold(Number(e.target.value))}
              aria-label="Idle threshold"
              className="bg-transparent text-xs font-semibold text-indigo-300 focus:outline-none cursor-pointer"
            >
              {demoMode && <option value={15} className="bg-slate-900">15 seconds (Live Demo)</option>}
              <option value={60} className="bg-slate-900">60 seconds (Org Setting)</option>
              <option value={180} className="bg-slate-900">180 seconds (3 min)</option>
              <option value={300} className="bg-slate-900">300 seconds (5 min)</option>
              <option value={600} className="bg-slate-900">600 seconds (10 min)</option>
            </select>
          </div>
        )}
      </div>

      {/* Personal Live Telemetry Card */}
      {currentUser && (
        <div className="rounded-2xl border border-indigo-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/30 p-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5">
                <span className="text-sm font-bold text-white">
                  Live Session: {currentUser.name} ({currentUser.emp_code})
                </span>
                <LiveStatusBadge status={isClockedIn ? liveState : 'offline'} />
              </div>
              <p className="text-xs text-slate-400">
                {isClockedIn
                  ? `Inactivity timer: ${secondsSinceActivity}s / ${idleThresholdSeconds}s before auto-idle triggers`
                  : 'Clock in to start real-time active & idle telemetry tracking'}
              </p>
            </div>

            <div className="flex items-center gap-2.5 flex-wrap">
              {!isClockedIn ? (
                <button
                  onClick={onClockIn}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  Clock In & Start Tracker
                </button>
              ) : (
                <>
                  <button
                    onClick={onToggleBreak}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-sky-500/40 bg-sky-500/15 hover:bg-sky-500/25 px-3.5 py-2 text-xs font-semibold text-sky-200 cursor-pointer"
                  >
                    <Coffee className="h-3.5 w-3.5" />
                    {liveState === 'break' ? 'End Break' : 'Start Break'}
                  </button>
                  {viewMode === 'admin' && (
                    <button
                      onClick={onForceIdle}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 px-3.5 py-2 text-xs font-semibold text-amber-200 cursor-pointer"
                    >
                      <PauseCircle className="h-3.5 w-3.5" />
                      Test Idle State
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
              <div className="text-xs text-slate-400">Active Desk Time</div>
              <div className="mt-1 text-xl font-bold text-emerald-400 font-mono-num">
                {formatDuration(currentUser.active_seconds)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
              <div className="text-xs text-slate-400">Idle Time</div>
              <div className="mt-1 text-xl font-bold text-amber-400 font-mono-num">
                {formatDuration(currentUser.idle_seconds)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Break Time</span>
                <span className="text-[10px] text-sky-300">Allowance: 60m</span>
              </div>
              <div className="mt-1 text-xl font-bold text-sky-400 font-mono-num">
                {formatDuration(currentUser.break_seconds)}
              </div>
              <div className="mt-1 text-[10px] text-slate-400">
                Lunch 1:00–1:45 PM (45m) • Tea 15m after 3:00 PM
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Team Active vs Idle Comparison */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
          <h2 className="text-base font-semibold text-white">
            {viewMode === 'employee' ? 'My Active vs Idle' : 'Team Active vs Idle Ratio'}
          </h2>
          <div className="space-y-3.5">
            {(viewMode === 'employee' && currentUser ? [currentUser] : employees).map((emp) => {
              const prod = calcProductivity(emp.active_seconds, emp.idle_seconds);
              return (
                <div key={emp.id} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">{emp.name}</span>
                      <LiveStatusBadge status={emp.status} />
                    </div>
                    <span className="font-mono-num text-slate-300">
                      {formatHM(emp.active_seconds)} active • {formatHM(emp.idle_seconds)} idle ({prod}%)
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800 flex">
                    <div className="bg-emerald-500 h-full transition-all" style={{ width: `${prod}%` }} />
                    <div className="bg-amber-500 h-full transition-all" style={{ width: `${100 - prod}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Audit Log */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col">
          <h2 className="text-base font-semibold text-white mb-4">Idle & Activity Audit Trail</h2>
          <div className="space-y-2.5 overflow-y-auto max-h-[380px] pr-1">
            {(viewMode === 'employee' && currentUser ? logs.filter((l) => l.employee_id === currentUser.id) : logs).map((log) => (
              <div
                key={log.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-800/80 bg-slate-950/60 px-3.5 py-2.5"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {log.type.includes('idle') ? (
                    <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" />
                  ) : (
                    <Activity className="h-4 w-4 text-emerald-400 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-white truncate">
                      {log.employee_name}{' '}
                      <span className="text-indigo-300 font-normal">• {log.type.replace('_', ' ')}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">{log.reason}</div>
                  </div>
                </div>
                <span className="text-[11px] text-slate-500 shrink-0">{formatRelativeTime(log.timestamp)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
