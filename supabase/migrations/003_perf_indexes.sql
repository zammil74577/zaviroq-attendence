-- Performance indexes for dashboard, activity logs, tasks, and leaves
CREATE INDEX IF NOT EXISTS idx_attendance_emp_date ON attendance(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_activity_logs_emp_ts ON activity_logs(employee_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_ts ON activity_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_status ON tasks(assignee_id, status);
CREATE INDEX IF NOT EXISTS idx_leaves_emp_start ON leaves(employee_id, start_date);
