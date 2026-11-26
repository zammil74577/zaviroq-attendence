import React, { useState } from 'react';
import { Plus, Search, Clock, Trash2, AlertTriangle, X } from 'lucide-react';
import type { Employee, Task, TaskPriority, TaskStatus, ViewMode } from '../types';
import { getTodayISO } from '../utils/format';
import { PriorityBadge, TaskStatusBadge } from './StatusBadge';

interface TasksTabProps {
  tasks: Task[];
  employees: Employee[];
  viewMode: ViewMode;
  currentUser: Employee | null;
  pendingOnly?: boolean;
  todayDate: string;
  onCreateTask: (payload: {
    title: string;
    description: string;
    assignee_id: number;
    department: string;
    priority: TaskPriority;
    due_date: string;
    estimated_minutes: number;
  }) => Promise<void>;
  onUpdateTask: (id: number, patch: Partial<Task>) => Promise<void>;
  onDeleteTask: (id: number) => Promise<void>;
}

export const TasksTab: React.FC<TasksTabProps> = ({
  tasks,
  employees,
  viewMode,
  currentUser,
  pendingOnly = false,
  todayDate: _todayDate,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState<number>(currentUser?.id || employees[0]?.id || 1);
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueDate, setDueDate] = useState<string>(getTodayISO());
  const [estimatedMinutes, setEstimatedMinutes] = useState<number>(60);
  const [submitting, setSubmitting] = useState(false);

  const filteredTasks = tasks.filter((t) => {
    if (viewMode === 'employee' && currentUser && t.assignee_id !== currentUser.id) return false;
    if (pendingOnly && t.status === 'completed') return false;
    const matchesSearch =
      t.title.toLowerCase().includes(search.toLowerCase()) ||
      (t.assignee_name || '').toLowerCase().includes(search.toLowerCase()) ||
      t.department.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
    const matchesPriority = priorityFilter === 'all' || t.priority === priorityFilter;
    return matchesSearch && matchesStatus && matchesPriority;
  });

  const overdueCount = filteredTasks.filter((t) => Boolean(t.is_overdue)).length;
  const blockedCount = filteredTasks.filter((t) => t.status === 'blocked').length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const emp = employees.find((x) => x.id === Number(assigneeId));
      await onCreateTask({
        title: title.trim(),
        description: description.trim(),
        assignee_id: Number(assigneeId),
        department: emp?.department || 'Engineering',
        priority,
        due_date: dueDate,
        estimated_minutes: estimatedMinutes,
      });
      setTitle('');
      setDescription('');
      setShowCreateModal(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">
            {pendingOnly ? 'Pending & Overdue Tasks' : 'Task Operations Board'}
          </h1>
          <p className="text-xs text-slate-400">
            {pendingOnly
              ? `${filteredTasks.length} open tasks • ${overdueCount} overdue • ${blockedCount} blocked`
              : viewMode === 'employee'
              ? 'Manage your assigned tasks and log progress'
              : 'Assign, track, log time, and complete deliverables across Zaviroq'}
          </p>
        </div>

        <button
          onClick={() => {
            setAssigneeId(currentUser?.id || employees[0]?.id || 1);
            setShowCreateModal(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          New Task
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks, assignees, or departments..."
            className="w-full rounded-xl border border-slate-800 bg-slate-900/80 pl-9 pr-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        {!pendingOnly && (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="review">In Review</option>
            <option value="blocked">Blocked</option>
            <option value="completed">Completed</option>
          </select>
        )}

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none"
        >
          <option value="all">All Priorities</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      {/* Task Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filteredTasks.map((task) => {
          const isOverdue = Boolean(task.is_overdue);
          return (
            <div
              key={task.id}
              className={`rounded-2xl border p-4 flex flex-col justify-between gap-4 transition-colors ${
                isOverdue
                  ? 'border-rose-500/40 bg-rose-950/15'
                  : 'border-slate-800 bg-slate-900/70 hover:border-slate-700'
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <PriorityBadge priority={task.priority} />
                    <TaskStatusBadge status={task.status} />
                    {isOverdue && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/20 px-2 py-0.5 text-[11px] font-semibold text-rose-300">
                        <AlertTriangle className="h-3 w-3" />
                        OVERDUE
                      </span>
                    )}
                  </div>
                  {viewMode === 'admin' && (
                    <button
                      onClick={() => onDeleteTask(task.id)}
                      className="rounded-lg p-1 text-slate-500 hover:bg-slate-800 hover:text-rose-400 transition-colors cursor-pointer"
                      title="Delete task"
                      aria-label="Delete task"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <h3 className="text-base font-semibold text-white">{task.title}</h3>
                {task.description && <p className="text-xs text-slate-400 leading-relaxed">{task.description}</p>}
              </div>

              <div className="space-y-3 pt-2 border-t border-slate-800/80">
                <div className="flex items-center justify-between text-xs text-slate-400 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: task.assignee_color || '#6366f1' }}
                    />
                    <span className="font-medium text-slate-200">{task.assignee_name}</span>
                    <span>• {task.department}</span>
                  </div>
                  <div className="flex items-center gap-3 font-mono-num">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-slate-500" />
                      {task.logged_minutes}m / {task.estimated_minutes}m
                    </span>
                    <span className={isOverdue ? 'text-rose-400 font-semibold' : ''}>Due {task.due_date}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <select
                    value={task.status}
                    onChange={(e) => onUpdateTask(task.id, { status: e.target.value as TaskStatus })}
                    aria-label={`Change status for ${task.title}`}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-slate-200 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="pending">Pending</option>
                    <option value="in_progress">In Progress</option>
                    <option value="review">In Review</option>
                    <option value="blocked">Blocked</option>
                    {task.status !== 'blocked' && <option value="completed">Completed</option>}
                  </select>

                  <div className="flex items-center gap-2">
                    {task.status !== 'completed' && (
                      <button
                        onClick={() => onUpdateTask(task.id, { logged_minutes: task.logged_minutes + 15 })}
                        className="rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-200 cursor-pointer"
                      >
                        +15m Log
                      </button>
                    )}
                    {task.status !== 'completed' && task.status !== 'blocked' && (
                      <button
                        onClick={() => onUpdateTask(task.id, { status: 'completed' })}
                        className="rounded-lg bg-emerald-600/90 hover:bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white cursor-pointer"
                      >
                        Mark Done
                      </button>
                    )}
                    {task.status === 'blocked' && (
                      <button
                        onClick={() => onUpdateTask(task.id, { status: 'in_progress' })}
                        className="rounded-lg bg-indigo-600/90 hover:bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white cursor-pointer"
                      >
                        Unblock
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredTasks.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-800 p-10 text-center text-sm text-slate-400">
          {tasks.filter((t) => viewMode !== 'employee' || !currentUser || t.assignee_id === currentUser.id).length === 0
            ? 'No tasks assigned yet'
            : 'No tasks match your current filters.'}
        </div>
      )}

      {/* Create Task Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">Assign New Task</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Task Title</label>
                <input
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Audit Q4 Payroll Export"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Description</label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Acceptance criteria, links, or notes..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {viewMode === 'admin' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Assignee</label>
                    <select
                      value={assigneeId}
                      onChange={(e) => setAssigneeId(Number(e.target.value))}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                    >
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name} ({e.department})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Priority</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as TaskPriority)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="urgent">Urgent</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Due Date</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Estimate (minutes)</label>
                  <input
                    type="number"
                    min={15}
                    step={15}
                    value={estimatedMinutes}
                    onChange={(e) => setEstimatedMinutes(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
                >
                  {submitting ? 'Creating...' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
