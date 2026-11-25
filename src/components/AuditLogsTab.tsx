import React, { useEffect, useState } from 'react';
import { History, ChevronDown, ChevronRight } from 'lucide-react';
import type { AuditLogEntry } from '../types';
import { formatClockTime } from '../utils/format';

interface GroupedAuditEntry extends AuditLogEntry {
  is_grouped?: boolean;
  group_count?: number;
  children?: AuditLogEntry[];
}

export const AuditLogsTab: React.FC = () => {
  const [logs, setLogs] = useState<GroupedAuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [loading, setLoading] = useState(true);
  const [actorFilter, setActorFilter] = useState<'all' | 'user' | 'system'>('all');
  const [actionFilter, setActionFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Record<number, boolean>>({});

  useEffect(() => {
    setPage(1);
  }, [actorFilter, actionFilter, dateFilter]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      grouped: 'true',
    });
    if (actorFilter !== 'all') params.set('actor', actorFilter);
    if (actionFilter) params.set('action', actionFilter);
    if (dateFilter) params.set('date', dateFilter);

    fetch(`/api/audit-logs?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : { rows: [], total: 0 }))
      .then((data) => {
        const rows = Array.isArray(data.rows) ? data.rows : [];
        setLogs(page === 1 ? rows : (prev) => [...prev, ...rows]);
        setTotal(Number(data.total || rows.length));
      })
      .finally(() => setLoading(false));
  }, [actorFilter, actionFilter, dateFilter, page]);

  const toggleGroup = (id: number) => {
    setExpandedGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-white">System Audit Log</h1>
          <p className="text-xs text-slate-400">
            Immutable append-only log ({total} entries) — system recalculations are collapsed by default
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={actorFilter}
          onChange={(e) => setActorFilter(e.target.value as 'all' | 'user' | 'system')}
          aria-label="Filter by actor"
          className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-200"
        >
          <option value="all">All Actors</option>
          <option value="user">Users Only</option>
          <option value="system">System Only</option>
        </select>

        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          aria-label="Filter by action"
          className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-200"
        >
          <option value="">All Actions</option>
          <option value="OVERRIDE_ATTENDANCE">OVERRIDE_ATTENDANCE</option>
          <option value="RECALC_LATE_STATUS">RECALC_LATE_STATUS</option>
          <option value="UPDATE_SALARY">UPDATE_SALARY</option>
          <option value="LOCK_PAYROLL">LOCK_PAYROLL</option>
          <option value="UNLOCK_PAYROLL">UNLOCK_PAYROLL</option>
          <option value="LEAVE_APPROVED">LEAVE_APPROVED</option>
          <option value="LEAVE_REJECTED">LEAVE_REJECTED</option>
          <option value="CREATE_EMPLOYEE">CREATE_EMPLOYEE</option>
          <option value="EDIT_EMPLOYEE">EDIT_EMPLOYEE</option>
          <option value="DEACTIVATE_EMPLOYEE">DEACTIVATE_EMPLOYEE</option>
          <option value="RESET_PIN">RESET_PIN</option>
          <option value="CHANGE_PIN">CHANGE_PIN</option>
          <option value="UPDATE_SETTINGS">UPDATE_SETTINGS</option>
          <option value="AUDIT_INTEGRITY_NOTE">AUDIT_INTEGRITY_NOTE</option>
        </select>

        <input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          aria-label="Filter by date"
          className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-200"
        />

        {(actorFilter !== 'all' || actionFilter || dateFilter) && (
          <button
            onClick={() => {
              setActorFilter('all');
              setActionFilter('');
              setDateFilter('');
            }}
            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:text-white cursor-pointer"
          >
            Clear Filters
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/70">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Target</th>
              <th className="px-4 py-3">Old Value</th>
              <th className="px-4 py-3">New Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {logs.map((l) => {
              const isExpanded = Boolean(expandedGroups[l.id]);
              return (
                <React.Fragment key={`${l.action}-${l.id}`}>
                  <tr className="hover:bg-slate-800/30 text-xs">
                    <td className="px-4 py-3 font-mono-num text-slate-400 whitespace-nowrap">
                      {l.created_at.slice(0, 10)} {formatClockTime(l.created_at)}
                    </td>
                    <td className="px-4 py-3 font-semibold text-white whitespace-nowrap">{l.actor_name}</td>
                    <td className="px-4 py-3">
                      {l.is_grouped ? (
                        <button
                          onClick={() => toggleGroup(l.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-200 cursor-pointer"
                        >
                          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          {l.new_value}
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/15 px-2 py-0.5 text-[11px] font-semibold text-indigo-300">
                          <History className="h-3 w-3" />
                          {l.action}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono-num text-slate-300">
                      {l.entity_type} #{l.entity_id || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-400 max-w-[220px] truncate" title={l.old_value || ''}>
                      {l.old_value || '—'}
                    </td>
                    <td className="px-4 py-3 text-emerald-300 max-w-[260px] truncate" title={l.new_value || ''}>
                      {l.new_value || '—'}
                    </td>
                  </tr>
                  {l.is_grouped && isExpanded && l.children?.map((child) => (
                    <tr key={`child-${child.id}`} className="bg-slate-950/60 text-[11px] text-slate-400">
                      <td className="px-6 py-2 font-mono-num">{child.created_at.slice(0, 10)} {formatClockTime(child.created_at)}</td>
                      <td className="px-4 py-2">{child.actor_name}</td>
                      <td className="px-4 py-2 text-indigo-300">{child.action}</td>
                      <td className="px-4 py-2 font-mono-num">{child.entity_type} #{child.entity_id}</td>
                      <td className="px-4 py-2 truncate max-w-[200px]">{child.old_value || '—'}</td>
                      <td className="px-4 py-2 truncate max-w-[240px]">{child.new_value || '—'}</td>
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
        {!loading && logs.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-400">No audit events match your filters.</div>
        )}
      </div>

      {logs.length < total && (
        <div className="flex justify-center">
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={loading}
            className="rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
          >
            {loading ? 'Loading...' : `Load More (${logs.length} / ${total})`}
          </button>
        </div>
      )}
    </div>
  );
};
