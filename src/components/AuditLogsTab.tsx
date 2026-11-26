import React, { useEffect, useState } from 'react';
import { History, ChevronDown, ChevronRight } from 'lucide-react';
import type { AuditLogEntry } from '../types';
import { formatClockTime } from '../utils/format';

interface GroupedAuditEntry extends AuditLogEntry {
  is_grouped?: boolean;
  group_count?: number;
  children?: AuditLogEntry[];
}

function formatAuditValue(val: unknown): { preview: string; pretty: string; isExpandable: boolean } {
  if (val === null || val === undefined || val === '') {
    return { preview: '—', pretty: '', isExpandable: false };
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        const pretty = JSON.stringify(parsed, null, 2);
        const oneLine = JSON.stringify(parsed);
        return {
          preview: oneLine.length > 64 ? `${oneLine.slice(0, 64)}…` : oneLine,
          pretty,
          isExpandable: pretty.includes('\n') || oneLine.length > 64,
        };
      } catch {
        return {
          preview: trimmed.length > 64 ? `${trimmed.slice(0, 64)}…` : trimmed,
          pretty: trimmed,
          isExpandable: trimmed.length > 64,
        };
      }
    }
    return {
      preview: trimmed.length > 64 ? `${trimmed.slice(0, 64)}…` : trimmed,
      pretty: trimmed,
      isExpandable: trimmed.length > 64,
    };
  }
  if (typeof val === 'object') {
    try {
      const pretty = JSON.stringify(val, null, 2);
      const oneLine = JSON.stringify(val);
      return {
        preview: oneLine.length > 64 ? `${oneLine.slice(0, 64)}…` : oneLine,
        pretty,
        isExpandable: true,
      };
    } catch {
      return { preview: String(val), pretty: String(val), isExpandable: false };
    }
  }
  const s = String(val);
  return { preview: s, pretty: s, isExpandable: false };
}

const AuditValueCell: React.FC<{ value: unknown; toneClass?: string }> = ({
  value,
  toneClass = 'text-slate-300',
}) => {
  const [open, setOpen] = useState(false);
  const { preview, pretty, isExpandable } = formatAuditValue(value);

  if (!isExpandable) {
    return <span className={`font-mono-num text-[11px] ${toneClass}`}>{preview}</span>;
  }

  return (
    <div className="max-w-[260px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 text-left font-mono-num text-[11px] hover:underline cursor-pointer ${toneClass}`}
        title="Click to expand JSON"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <span className="truncate max-w-[230px]">{preview}</span>
      </button>
      {open && (
        <pre className="mt-1.5 max-h-48 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-2 text-[10px] leading-relaxed text-slate-200 whitespace-pre-wrap break-all">
          {pretty}
        </pre>
      )}
    </div>
  );
};

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
      excludeTest: 'true',
    });
    if (actorFilter !== 'all') params.set('actor', actorFilter);
    if (actionFilter) params.set('action', actionFilter);
    if (dateFilter) params.set('date', dateFilter);

    fetch(`/api/audit-logs?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : { rows: [], total: 0 }))
      .then((data) => {
        const rawRows = Array.isArray(data.rows) ? data.rows : [];
        const rows = rawRows.filter(
          (r: GroupedAuditEntry) => r.actor_name !== 'Test' && r.action !== 'PG_VERIFY'
        );
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
          <option value="REACTIVATE_EMPLOYEE">REACTIVATE_EMPLOYEE</option>
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
              const dateStr = String(l.created_at || '').slice(0, 10);
              const groupedLabel =
                typeof l.new_value === 'string'
                  ? l.new_value
                  : `Recalculated late status — ${l.group_count || l.children?.length || 0} records`;
              return (
                <React.Fragment key={`${l.action}-${l.id}`}>
                  <tr className="hover:bg-slate-800/30 text-xs align-top">
                    <td className="px-4 py-3 font-mono-num text-slate-400 whitespace-nowrap">
                      {dateStr} {formatClockTime(l.created_at)}
                    </td>
                    <td className="px-4 py-3 font-semibold text-white whitespace-nowrap">{l.actor_name || 'System'}</td>
                    <td className="px-4 py-3">
                      {l.is_grouped ? (
                        <button
                          onClick={() => toggleGroup(l.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-200 cursor-pointer"
                        >
                          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          {groupedLabel}
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/15 px-2 py-0.5 text-[11px] font-semibold text-indigo-300">
                          <History className="h-3 w-3" />
                          {l.action}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono-num text-slate-300 whitespace-nowrap">
                      {l.entity_type} #{l.entity_id || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <AuditValueCell value={l.old_value} toneClass="text-slate-400" />
                    </td>
                    <td className="px-4 py-3">
                      <AuditValueCell value={l.new_value} toneClass="text-emerald-300" />
                    </td>
                  </tr>
                  {l.is_grouped && isExpanded && l.children?.map((child) => (
                    <tr key={`child-${child.id}`} className="bg-slate-950/60 text-[11px] text-slate-400 align-top">
                      <td className="px-6 py-2 font-mono-num whitespace-nowrap">
                        {String(child.created_at || '').slice(0, 10)} {formatClockTime(child.created_at)}
                      </td>
                      <td className="px-4 py-2">{child.actor_name || 'System'}</td>
                      <td className="px-4 py-2 text-indigo-300">{child.action}</td>
                      <td className="px-4 py-2 font-mono-num">{child.entity_type} #{child.entity_id || '—'}</td>
                      <td className="px-4 py-2">
                        <AuditValueCell value={child.old_value} toneClass="text-slate-400" />
                      </td>
                      <td className="px-4 py-2">
                        <AuditValueCell value={child.new_value} toneClass="text-emerald-300" />
                      </td>
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
