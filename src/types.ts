export type LiveStatus = 'active' | 'idle' | 'break' | 'offline';
export type AttendanceStatus = 'present' | 'late' | 'half_day' | 'absent' | 'on_leave';
export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low';
export type TaskStatus = 'pending' | 'in_progress' | 'review' | 'completed' | 'blocked';
export type ViewMode = 'admin' | 'employee';
export type TabId =
  | 'overview'
  | 'attendance'
  | 'tasks'
  | 'pending'
  | 'idle'
  | 'leaves'
  | 'reports'
  | 'my-monthly'
  | 'salary'
  | 'chat'
  | 'directory'
  | 'audit'
  | 'settings';

export interface ChatMessage {
  id: number;
  sender_id: number;
  recipient_id: number;
  message: string;
  image_data?: string;
  is_bot: number;
  created_at: string;
  sender_name?: string;
  sender_color?: string;
}

export type LeaveType = 'casual' | 'sick' | 'earned' | 'unpaid';
export type LeaveStatus = 'pending' | 'approved' | 'rejected';

export interface LeaveRequest {
  id: number;
  employee_id: number;
  employee_name: string;
  emp_code: string;
  department: string;
  avatar_color: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  reviewer_name?: string | null;
  created_at: string;
}

export interface LeaveBalance {
  employee_id: number;
  emp_code: string;
  name: string;
  department: string;
  casual_total: number;
  casual_used: number;
  sick_total: number;
  sick_used: number;
  earned_total: number;
  earned_used: number;
  unpaid_used: number;
}

export interface SalaryStructure {
  employee_id: number;
  emp_code?: string;
  name?: string;
  department?: string;
  designation?: string;
  avatar_color?: string;
  currency: string;
  base_monthly_salary: number;
  hra: number;
  transport_allowance: number;
  special_allowance: number;
  pf_deduction: number;
  tax_deduction: number;
  overtime_hourly_rate: number;
  working_days_per_month: number;
  gross_salary?: number;
  overtime_pay?: number;
  unpaid_deduction?: number;
  total_deductions?: number;
  net_salary?: number;
}

export interface MonthlyReportRow {
  employee_id: number;
  emp_code: string;
  name: string;
  department: string;
  designation: string;
  avatar_color: string;
  present_days: number;
  late_days: number;
  half_days: number;
  leave_days: number;
  absent_days: number;
  total_logged_days: number;
  total_active_seconds: number;
  total_idle_seconds: number;
  total_break_seconds: number;
  total_overtime_seconds: number;
  tasks_completed: number;
  tasks_pending: number;
  salary_set?: boolean;
  salary: (SalaryStructure & {
    gross_salary: number;
    overtime_pay: number;
    unpaid_deduction: number;
    total_deductions: number;
    net_salary: number;
    prorated_net_salary?: number;
  }) | null;
}

export interface MonthlyReportData {
  month: string;
  locked?: boolean;
  isCurrentMonth?: boolean;
  elapsedWorkingDays?: number;
  totalWorkingDays?: number;
  prorationRatio?: number;
  rows: MonthlyReportRow[];
}

export interface Employee {
  id: number;
  emp_code: string;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'employee';
  department: string;
  designation: string;
  shift_start: string;
  shift_end: string;
  status: LiveStatus;
  avatar_color: string;
  joining_date?: string | null;
  is_active?: boolean | number;
  must_change_pin?: number;
  tracking_consent_at?: string | null;
  last_seen_at: string | null;
  // Joined daily attendance fields
  attendance_id: number | null;
  clock_in: string | null;
  clock_out: string | null;
  attendance_status: AttendanceStatus;
  active_seconds: number;
  idle_seconds: number;
  break_seconds: number;
  overtime_seconds: number;
  missed_clock_out?: number;
  tracking_mode?: 'app_system' | 'system' | 'tab_only';
  break_over_limit?: boolean;
  attendance_notes: string;
}

export interface Task {
  id: number;
  title: string;
  description: string;
  assignee_id: number;
  created_by: number | null;
  department: string;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string;
  estimated_minutes: number;
  logged_minutes: number;
  tags: string;
  is_overdue?: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  assignee_name?: string;
  assignee_code?: string;
  assignee_color?: string;
  assignee_live_status?: LiveStatus;
}

export interface ActivityLog {
  id: number;
  employee_id: number;
  date: string;
  type: string;
  duration_seconds: number;
  reason: string;
  timestamp: string;
  employee_name: string;
  emp_code: string;
}

export interface Announcement {
  id: number;
  title: string;
  message: string;
  author_id: number | null;
  author_name?: string;
  priority: 'normal' | 'important';
  created_at: string;
}

export interface DashboardSummary {
  date: string;
  totalEmployees: number;
  presentCount: number;
  clockedOutCount: number;
  lateCount: number;
  absentCount: number;
  activeNowCount: number;
  idleNowCount: number;
  onBreakCount: number;
  totalActiveSeconds: number;
  totalIdleSeconds: number;
  totalBreakSeconds: number;
  totalTasks: number;
  pendingTasks: number;
  inProgressTasks: number;
  reviewTasks: number;
  blockedTasks: number;
  completedTasks: number;
  overdueTasks: number;
}

export interface OfficeSchedule {
  shiftStart: string;
  shiftEnd: string;
  lateGraceMinutes: number;
  lunchBreak: string;
  lunchMinutes: number;
  teaBreakAfter: string;
  teaMinutes: number;
  totalBreakMinutes: number;
  netWorkHours: number;
  idleThresholdSeconds?: number;
  autoClockOutBufferMinutes?: number;
  afterHoursClockInMode?: string;
  weekendDays?: number[];
  lateDeductionEnabled?: boolean;
  lateDaysPerHalfDayLop?: number;
  overtimePolicy?: string;
  prorateAnnualLeave?: boolean;
}

export interface AuditLogEntry {
  id: number;
  actor_id: number | null;
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

export interface AppNotification {
  id: string;
  type: 'warning' | 'danger' | 'info' | 'alert';
  title: string;
  message: string;
  link?: string;
}

export interface AlertRule {
  id: number;
  type: string;
  enabled: boolean | number;
  threshold_minutes: number;
  channels: string[] | string;
  quiet_hours: { start: string; end: string } | string;
  recipients: string;
}

export interface Holiday {
  id: number;
  date: string;
  name: string;
}

export interface ChatContact {
  id: number;
  emp_code: string;
  name: string;
  designation: string;
  department: string;
  avatar_color: string;
  status: LiveStatus;
  role: string;
}

export interface DashboardData {
  summary: DashboardSummary;
  employees: Employee[];
  tasks: Task[];
  logs: ActivityLog[];
  announcements: Announcement[];
  officeSchedule?: OfficeSchedule;
}
