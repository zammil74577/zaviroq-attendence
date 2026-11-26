import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  db,
  getTodayDate,
  getCurrentMonth,
  getSettings,
  hashPin,
  verifyPin,
  sanitizeEmployee,
  writeAuditLog,
  formatClockInReasonInTz,
} from './db.js';
import {
  SESSION_COOKIE_NAME,
  requireAuth,
  requireRole,
  setSessionCookie,
  clearSessionCookie,
  revokeSessionToken,
} from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.resolve(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

export const app = express();
const PORT = process.env.PORT || 3001;

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(helmet({ contentSecurityPolicy: false }));

const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
  : true;
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '8mb' }));
app.use('/uploads', express.static(uploadsDir));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX || 300),
  standardHeaders: true,
  legacyHeaders: false,
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX || 30),
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

// ========================
// DOMAIN HELPERS
// ========================
export function computeArrivalStatus(shiftStart = '09:30', now = new Date(), graceMinutes = 15) {
  const [sh, sm] = shiftStart.split(':').map(Number);
  const shiftMinutes = sh * 60 + sm + graceMinutes;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return currentMinutes > shiftMinutes ? 'late' : 'present';
}

export function formatClockInReason(shiftStart = '09:30', now = new Date(), graceMinutes = 15, shiftEnd = '17:30', bufferMins = 120) {
  return formatClockInReasonInTz(shiftStart, shiftEnd, bufferMins, now, graceMinutes, 'Asia/Kolkata');
}

export function countWorkingLeaveDays(startDate, endDate) {
  const settings = getSettings();
  const weekendSet = new Set(settings.weekendDays || [0, 6]);
  const holidays = new Set(db.prepare('SELECT date FROM holidays').all().map((h) => h.date));
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  let count = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!weekendSet.has(d.getDay()) && !holidays.has(dateStr)) {
      count += 1;
    }
  }
  return count;
}

export function countMonthWorkingDays(month, upToDay = null) {
  const settings = getSettings();
  const weekendSet = new Set(settings.weekendDays || [0, 6]);
  const holidays = new Set(db.prepare('SELECT date FROM holidays WHERE date LIKE ?').all(`${month}-%`).map((h) => h.date));
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const limit = upToDay ? Math.min(upToDay, daysInMonth) : daysInMonth;
  let count = 0;
  for (let day = 1; day <= limit; day++) {
    const d = new Date(y, m - 1, day);
    const dateStr = `${month}-${String(day).padStart(2, '0')}`;
    if (!weekendSet.has(d.getDay()) && !holidays.has(dateStr)) {
      count += 1;
    }
  }
  return Math.max(1, count);
}

function isTaskOverdue(task, today, shiftEnd = '17:30') {
  if (task.status === 'completed') return false;
  if (task.due_date < today) return true;
  if (task.due_date === today) {
    const now = new Date();
    const nowHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    return nowHHMM > shiftEnd;
  }
  return false;
}

// Phase 2 #7: Mark stale (>3m no heartbeat) employees offline & auto clock-out missed shifts
function runAttendanceMaintenance() {
  const settings = getSettings();
  const today = getTodayDate();
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - 3 * 60 * 1000).toISOString();

  // 1. Mark stale employees offline
  db.prepare(`
    UPDATE employees
    SET status = 'offline'
    WHERE status != 'offline' AND last_heartbeat_at IS NOT NULL AND last_heartbeat_at < ?
  `).run(staleCutoff);

  // 2. Auto clock-out prior-day unclosed shifts AND today's shifts past shift_end + buffer
  const priorOpen = db.prepare(`
    SELECT a.id, a.employee_id, a.date, e.shift_end
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    WHERE a.date < ? AND a.clock_in IS NOT NULL AND a.clock_out IS NULL
  `).all(today);

  for (const row of priorOpen) {
    const autoOut = `${row.date}T${row.shift_end || settings.shiftEnd}:00.000Z`;
    db.prepare(`
      UPDATE attendance SET clock_out = ?, missed_clock_out = 1, updated_at = datetime('now') WHERE id = ?
    `).run(autoOut, row.id);
    db.prepare(`UPDATE employees SET status = 'offline', last_heartbeat_at = NULL, last_heartbeat_state = NULL WHERE id = ?`).run(row.employee_id);
  }

  const bufferMins = settings.autoClockOutBufferMinutes || 120;
  const nowTotalMins = now.getHours() * 60 + now.getMinutes();
  const todayOpen = db.prepare(`
    SELECT a.id, a.employee_id, a.notes, e.shift_end, e.last_heartbeat_at
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    WHERE a.date = ? AND a.clock_in IS NOT NULL AND a.clock_out IS NULL
  `).all(today);

  for (const row of todayOpen) {
    const isAfterHours = String(row.notes || '').includes('After-hours');
    if (isAfterHours) {
      // After-hours / overtime sessions only auto-close after 2h without heartbeats
      const lastHb = row.last_heartbeat_at ? new Date(row.last_heartbeat_at).getTime() : 0;
      if (lastHb > 0 && now.getTime() - lastHb > 120 * 60 * 1000) {
        const autoOutIso = now.toISOString();
        db.prepare(`UPDATE attendance SET clock_out = ?, missed_clock_out = 1, updated_at = datetime('now') WHERE id = ?`).run(autoOutIso, row.id);
        db.prepare(`UPDATE employees SET status = 'offline', last_heartbeat_at = NULL, last_heartbeat_state = NULL WHERE id = ?`).run(row.employee_id);
      }
      continue;
    }
    const [eh, em] = (row.shift_end || settings.shiftEnd).split(':').map(Number);
    if (nowTotalMins > eh * 60 + em + bufferMins) {
      const autoOutIso = now.toISOString();
      db.prepare(`
        UPDATE attendance SET clock_out = ?, missed_clock_out = 1, updated_at = datetime('now') WHERE id = ?
      `).run(autoOutIso, row.id);
      db.prepare(`UPDATE employees SET status = 'offline', last_heartbeat_at = NULL, last_heartbeat_state = NULL WHERE id = ?`).run(row.employee_id);
    }
  }
}

function isPayrollLocked(month) {
  return Boolean(db.prepare('SELECT month FROM payroll_locks WHERE month = ?').get(month));
}

export function validateStrongPin(pin) {
  const s = String(pin ?? '').trim();
  if (!/^\d{6}$/.test(s)) {
    return 'PIN must be exactly 6 digits.';
  }
  if (/^(\d)\1{5}$/.test(s)) {
    return 'PIN cannot be all repeated digits (e.g. 111111).';
  }
  const seqAsc = '01234567890123456789';
  const seqDesc = '98765432109876543210';
  if (seqAsc.includes(s) || seqDesc.includes(s) || s === '000000' || s === '123456') {
    return 'PIN cannot be a trivial or sequential pattern.';
  }
  return null;
}

export function recalculateAttendanceLateStatuses(actor = { id: null, name: 'System' }) {
  const settings = getSettings();
  const rows = db.prepare(`
    SELECT a.id, a.employee_id, a.date, a.clock_in, a.status, e.shift_start
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    WHERE a.manual_override = 0
      AND a.clock_in IS NOT NULL
      AND a.status IN ('present', 'late')
  `).all();

  const updateStmt = db.prepare(`UPDATE attendance SET status = ?, updated_at = datetime('now') WHERE id = ?`);
  const details = [];

  for (const row of rows) {
    const month = String(row.date).slice(0, 7);
    if (isPayrollLocked(month)) continue;
    const expected = computeArrivalStatus(row.shift_start || settings.shiftStart, new Date(row.clock_in), settings.lateGraceMinutes);
    if (expected !== row.status) {
      updateStmt.run(expected, row.id);
      details.push({ employee_id: row.employee_id, date: row.date, from: row.status, to: expected });
    }
  }

  if (details.length > 0) {
    writeAuditLog({
      actorId: actor.id,
      actorName: actor.name,
      action: 'RECALC_LATE_STATUS',
      entityType: 'attendance',
      entityId: 'bulk',
      newValue: {
        summary: `Recalculated late status for ${details.length} records (grace ${settings.lateGraceMinutes}m)`,
        count: details.length,
        graceMinutes: settings.lateGraceMinutes,
        details,
      },
    });
  }
  return details.length;
}

recalculateAttendanceLateStatuses();

function csvEscape(val) {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ========================
// PUBLIC AUTH & HEALTH
// ========================
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString(), date: getTodayDate() });
});

app.get('/healthz', (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true, db: 'ok', uptime: Math.round(process.uptime()) });
  } catch {
    res.status(503).json({ ok: false, db: 'error' });
  }
});

app.get('/api/auth/config', (_req, res) => {
  const demoMode = process.env.DEMO_MODE === 'true';
  if (!demoMode) return res.json({ demoMode: false });
  const badges = db.prepare(`SELECT emp_code, name, role FROM employees WHERE is_active = 1 ORDER BY id ASC LIMIT 2`).all();
  res.json({ demoMode: true, demoBadges: badges });
});

app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { identifier, pin, scanEntry = false } = req.body;
  if (!identifier?.trim() || !pin?.trim()) {
    return res.status(400).json({ error: 'Employee ID/Email and PIN are required.' });
  }
  const key = identifier.trim().toLowerCase();
  const emp = db.prepare(`
    SELECT * FROM employees
    WHERE (LOWER(emp_code) = ? OR LOWER(email) = ?) AND is_active = 1
  `).get(key, key);

  if (!emp) {
    return res.status(401).json({ error: 'Invalid Employee ID/Email or PIN.' });
  }

  if (emp.locked_until) {
    const lockExpires = new Date(emp.locked_until).getTime();
    if (Date.now() < lockExpires) {
      const minsLeft = Math.ceil((lockExpires - Date.now()) / 60000);
      return res.status(429).json({
        error: `Account locked due to too many failed attempts. Try again in ${minsLeft} minute(s).`,
      });
    }
    db.prepare('UPDATE employees SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?').run(emp.id);
    emp.failed_login_attempts = 0;
  }

  if (!verifyPin(pin.trim(), emp.pin)) {
    const nextAttempts = (emp.failed_login_attempts || 0) + 1;
    if (nextAttempts >= 5) {
      const lockUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      db.prepare('UPDATE employees SET failed_login_attempts = ?, locked_until = ? WHERE id = ?')
        .run(nextAttempts, lockUntil, emp.id);
      return res.status(429).json({
        error: 'Too many failed login attempts. Account locked for 15 minutes.',
      });
    }
    db.prepare('UPDATE employees SET failed_login_attempts = ? WHERE id = ?').run(nextAttempts, emp.id);
    return res.status(401).json({
      error: `Invalid Employee ID/Email or PIN. (${5 - nextAttempts} attempt(s) remaining)`,
    });
  }

  db.prepare('UPDATE employees SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?').run(emp.id);

  if (scanEntry) {
    const today = getTodayDate();
    const nowIso = new Date().toISOString();
    const existing = db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(emp.id, today);
    if (!existing) {
      const settings = getSettings();
      const nowObj = new Date();
      const arrivalStatus = computeArrivalStatus(emp.shift_start, nowObj, settings.lateGraceMinutes);
      const clockReason = formatClockInReason(emp.shift_start, nowObj, settings.lateGraceMinutes);
      db.prepare(`
        INSERT INTO attendance (employee_id, date, clock_in, status, notes)
        VALUES (?, ?, ?, ?, ?)
      `).run(emp.id, today, nowIso, arrivalStatus, clockReason);
      db.prepare(`
        UPDATE employees
        SET status = 'active', last_seen_at = ?, last_heartbeat_at = ?, last_heartbeat_state = 'active'
        WHERE id = ?
      `).run(nowIso, nowIso, emp.id);
      db.prepare(`
        INSERT INTO activity_logs (employee_id, date, type, reason, timestamp)
        VALUES (?, ?, 'clock_in', ?, ?)
      `).run(emp.id, today, clockReason, nowIso);
    }
  }

  setSessionCookie(res, emp.id);
  res.json({ employee: sanitizeEmployee(emp) });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ employee: req.user });
});

app.post('/api/auth/change-pin', requireAuth, (req, res) => {
  const { newPin } = req.body;
  const err = validateStrongPin(newPin);
  if (err) return res.status(400).json({ error: err });

  db.prepare(`UPDATE employees SET pin = ?, must_change_pin = 0 WHERE id = ?`).run(hashPin(String(newPin).trim()), req.user.id);
  writeAuditLog({
    actorId: req.user.id,
    actorName: req.user.name,
    action: 'CHANGE_PIN',
    entityType: 'employee',
    entityId: req.user.id,
    newValue: { changed: true },
  });
  const updated = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.user.id);
  res.json({ ok: true, employee: sanitizeEmployee(updated) });
});

app.post('/api/auth/consent', requireAuth, (req, res) => {
  const nowIso = new Date().toISOString();
  db.prepare(`UPDATE employees SET tracking_consent_at = ? WHERE id = ?`).run(nowIso, req.user.id);
  writeAuditLog({
    actorId: req.user.id,
    actorName: req.user.name,
    action: 'ACCEPT_TRACKING_CONSENT',
    entityType: 'employee',
    entityId: req.user.id,
    newValue: { accepted_at: nowIso },
  });
  const updated = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.user.id);
  res.json({ ok: true, employee: sanitizeEmployee(updated) });
});

app.post('/api/auth/logout', (req, res) => {
  revokeSessionToken(req.cookies?.[SESSION_COOKIE_NAME]);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ========================
// PROTECTED API ROUTES
// ========================
app.use('/api', requireAuth);

app.get('/api/dashboard', (req, res) => {
  runAttendanceMaintenance();
  const date = req.query.date || getTodayDate();
  const isPrivileged = req.user.role === 'admin' || req.user.role === 'manager';
  const settings = getSettings();
  const breakLimitSec = settings.totalBreakMinutes * 60;

  const includeInactive = isPrivileged && req.query.includeInactive === 'true';
  const rawEmployees = db.prepare(`
    SELECT e.id, e.emp_code, e.name, e.email, e.role, e.department, e.designation,
      e.shift_start, e.shift_end, e.status, e.avatar_color, e.joining_date, e.is_active, e.last_seen_at,
      e.last_heartbeat_at, e.last_heartbeat_state, e.created_at,
      a.id as attendance_id,
      a.clock_in,
      a.clock_out,
      COALESCE(a.status, 'absent') as attendance_status,
      COALESCE(a.active_seconds, 0) as active_seconds,
      COALESCE(a.idle_seconds, 0) as idle_seconds,
      COALESCE(a.break_seconds, 0) as break_seconds,
      COALESCE(a.overtime_seconds, 0) as overtime_seconds,
      COALESCE(a.missed_clock_out, 0) as missed_clock_out,
      COALESCE(a.tracking_mode, 'tab_only') as tracking_mode,
      COALESCE(a.notes, '') as attendance_notes
    FROM employees e
    LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = ?
    WHERE ${includeInactive ? '1=1' : 'e.is_active = 1'} ${isPrivileged ? '' : 'AND e.id = ?'}
    ORDER BY e.id ASC
  `).all(...(isPrivileged ? [date] : [date, req.user.id]));

  const nowMs = Date.now();
  const employees = rawEmployees.map((e) => {
    const isStale = e.status !== 'offline' && e.last_heartbeat_at && (nowMs - new Date(e.last_heartbeat_at).getTime() > 180000);
    return {
      ...sanitizeEmployee(e),
      status: isStale ? 'offline' : e.status,
      shift_start: e.shift_start || settings.shiftStart,
      shift_end: e.shift_end || settings.shiftEnd,
      break_over_limit: (e.break_seconds || 0) > breakLimitSec,
    };
  });

  const tasks = db.prepare(`
    SELECT t.*,
      e.name as assignee_name,
      e.emp_code as assignee_code,
      e.avatar_color as assignee_color,
      e.status as assignee_live_status
    FROM tasks t
    LEFT JOIN employees e ON e.id = t.assignee_id
    ${isPrivileged ? '' : 'WHERE t.assignee_id = ?'}
    ORDER BY
      CASE t.priority
        WHEN 'urgent' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        ELSE 4
      END,
      t.due_date ASC,
      t.id DESC
  `).all(...(isPrivileged ? [] : [req.user.id]))
    .map((t) => ({ ...t, is_overdue: isTaskOverdue(t, getTodayDate(), settings.shiftEnd) }));

  const logs = db.prepare(`
    SELECT l.*, e.name as employee_name, e.emp_code
    FROM activity_logs l
    JOIN employees e ON e.id = l.employee_id
    WHERE l.date = ? ${isPrivileged ? '' : 'AND l.employee_id = ?'}
    ORDER BY l.id DESC
    LIMIT 40
  `).all(...(isPrivileged ? [date] : [date, req.user.id]));

  const announcements = db.prepare(`
    SELECT an.*, e.name as author_name
    FROM announcements an
    LEFT JOIN employees e ON e.id = an.author_id
    ORDER BY an.id DESC
    LIMIT 10
  `).all();

  const today = getTodayDate();
  const summary = {
    date,
    totalEmployees: employees.length,
    presentCount: employees.filter((e) => e.clock_in && !e.clock_out).length,
    clockedOutCount: employees.filter((e) => e.clock_out).length,
    lateCount: employees.filter((e) => e.attendance_status === 'late').length,
    absentCount: employees.filter((e) => !e.clock_in).length,
    activeNowCount: employees.filter((e) => e.status === 'active').length,
    idleNowCount: employees.filter((e) => e.status === 'idle').length,
    onBreakCount: employees.filter((e) => e.status === 'break').length,
    totalActiveSeconds: employees.reduce((acc, e) => acc + (e.active_seconds || 0), 0),
    totalIdleSeconds: employees.reduce((acc, e) => acc + (e.idle_seconds || 0), 0),
    totalBreakSeconds: employees.reduce((acc, e) => acc + (e.break_seconds || 0), 0),
    totalTasks: tasks.length,
    pendingTasks: tasks.filter((t) => t.status === 'pending').length,
    inProgressTasks: tasks.filter((t) => t.status === 'in_progress').length,
    reviewTasks: tasks.filter((t) => t.status === 'review').length,
    blockedTasks: tasks.filter((t) => t.status === 'blocked').length,
    completedTasks: tasks.filter((t) => t.status === 'completed').length,
    overdueTasks: tasks.filter((t) => t.is_overdue).length,
  };

  res.json({ summary, employees, tasks, logs, announcements, officeSchedule: settings });
});

// ========================
// EMPLOYEE MANAGEMENT (Admin/Manager)
// ========================
app.post('/api/employees', requireRole('admin', 'manager'), (req, res) => {
  const settings = getSettings();
  const { name, email, role = 'employee', department, designation, shift_start = settings.shiftStart, shift_end = settings.shiftEnd, joining_date } = req.body;
  if (!name?.trim() || !email?.trim() || !department?.trim() || !designation?.trim()) {
    return res.status(400).json({ error: 'Name, email, department, and designation are required.' });
  }
  const palette = ['#6366f1', '#06b6d4', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444'];
  const maxRow = db.prepare('SELECT MAX(id) as maxId FROM employees').get();
  const nextNum = (maxRow?.maxId || 0) + 1;
  const emp_code = `ZAV-${String(nextNum).padStart(3, '0')}`;
  const avatar_color = palette[nextNum % palette.length];
  const safeJoiningDate = joining_date || getTodayDate();

  let tempPin = '849201';
  for (let i = 0; i < 30; i++) {
    const candidate = String(crypto.randomInt(100000, 1000000));
    if (!validateStrongPin(candidate)) {
      tempPin = candidate;
      break;
    }
  }

  try {
    const info = db.prepare(`
      INSERT INTO employees (emp_code, name, email, role, department, designation, shift_start, shift_end, status, avatar_color, joining_date, pin, must_change_pin)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'offline', ?, ?, ?, 1)
    `).run(emp_code, name.trim(), email.trim().toLowerCase(), role, department.trim(), designation.trim(), shift_start || settings.shiftStart, shift_end || settings.shiftEnd, avatar_color, safeJoiningDate, hashPin(tempPin));
    const created = db.prepare('SELECT * FROM employees WHERE id = ?').get(info.lastInsertRowid);
    writeAuditLog({
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'CREATE_EMPLOYEE',
      entityType: 'employee',
      entityId: created.id,
      newValue: { emp_code, name: created.name, role: created.role, department: created.department },
    });
    res.status(201).json({ ...sanitizeEmployee(created), tempPin });
  } catch {
    res.status(409).json({ error: 'Employee email already exists.' });
  }
});

app.patch('/api/employees/:id', requireRole('admin', 'manager'), (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Employee not found' });

  const {
    name = existing.name,
    department = existing.department,
    designation = existing.designation,
    role = existing.role,
    shift_start = existing.shift_start,
    shift_end = existing.shift_end,
    joining_date = existing.joining_date,
    is_active = existing.is_active,
  } = req.body;

  const nextActive = Number(is_active) === 0 || is_active === false ? 0 : 1;
  if (nextActive === 0) {
    if (Number(id) === req.user.id) {
      return res.status(400).json({ error: 'You cannot deactivate your own account.' });
    }
    if (existing.role === 'admin') {
      const activeAdmins = db.prepare(`SELECT COUNT(*) as cnt FROM employees WHERE role = 'admin' AND is_active = 1`).get().cnt;
      if (activeAdmins <= 1) {
        return res.status(400).json({ error: 'Cannot deactivate the last active admin.' });
      }
    }
  }

  db.prepare(`
    UPDATE employees
    SET name = ?, department = ?, designation = ?, role = ?, shift_start = ?, shift_end = ?,
        joining_date = COALESCE(?, joining_date), is_active = ?,
        status = CASE WHEN ? = 0 THEN 'offline' ELSE status END,
        last_heartbeat_at = CASE WHEN ? = 0 THEN NULL ELSE last_heartbeat_at END,
        last_heartbeat_state = CASE WHEN ? = 0 THEN NULL ELSE last_heartbeat_state END,
        active_session_id = CASE WHEN ? = 0 THEN NULL ELSE active_session_id END
    WHERE id = ?
  `).run(name.trim(), department.trim(), designation.trim(), role, shift_start, shift_end, joining_date || null, nextActive, nextActive, nextActive, nextActive, nextActive, id);

  if (nextActive === 0) {
    const nowIso = new Date().toISOString();
    const openAtts = db.prepare(`SELECT id, date, active_seconds FROM attendance WHERE employee_id = ? AND clock_in IS NOT NULL AND clock_out IS NULL`).all(id);
    for (const att of openAtts) {
      db.prepare(`UPDATE attendance SET clock_out = ?, notes = CASE WHEN notes != '' THEN notes || ' | Deactivated' ELSE 'Deactivated' END, updated_at = datetime('now') WHERE id = ?`).run(nowIso, att.id);
      db.prepare(`INSERT INTO activity_logs (employee_id, date, type, duration_seconds, reason, timestamp) VALUES (?, ?, 'clock_out', ?, 'Deactivated', ?)`).run(id, att.date, att.active_seconds || 0, nowIso);
    }
    db.prepare(`DELETE FROM sessions WHERE employee_id = ?`).run(id);
  }

  const updated = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
  const actionName = nextActive === 0
    ? 'DEACTIVATE_EMPLOYEE'
    : (Number(existing.is_active) === 0 && nextActive === 1 ? 'REACTIVATE_EMPLOYEE' : 'EDIT_EMPLOYEE');
  writeAuditLog({
    actorId: req.user.id,
    actorName: req.user.name,
    action: actionName,
    entityType: 'employee',
    entityId: id,
    oldValue: sanitizeEmployee(existing),
    newValue: sanitizeEmployee(updated),
  });
  res.json(sanitizeEmployee(updated));
});

app.post('/api/employees/:id/reset-pin', requireRole('admin', 'manager'), (req, res) => {
  const { id } = req.params;
  const { newPin } = req.body;
  const pinErr = validateStrongPin(newPin);
  if (pinErr) {
    return res.status(400).json({ error: pinErr });
  }
  const existing = db.prepare('SELECT id, emp_code, name FROM employees WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Employee not found' });

  db.prepare(`UPDATE employees SET pin = ?, must_change_pin = 0, failed_login_attempts = 0, locked_until = NULL WHERE id = ?`)
    .run(hashPin(String(newPin).trim()), id);
  writeAuditLog({
    actorId: req.user.id,
    actorName: req.user.name,
    action: 'RESET_PIN',
    entityType: 'employee',
    entityId: id,
    newValue: { reset: true },
  });
  res.json({ ok: true });
});

// ========================
// ATTENDANCE & HEARTBEAT
// ========================
app.post('/api/attendance/clock-in', (req, res) => {
  const isPrivileged = req.user.role === 'admin' || req.user.role === 'manager';
  const targetId = isPrivileged && req.body.employeeId ? Number(req.body.employeeId) : req.user.id;
  const { notes = '', trackingMode = 'tab_only' } = req.body;
  const safeTrackingMode = trackingMode === 'system' ? 'system' : 'tab_only';

  const emp = db.prepare('SELECT * FROM employees WHERE id = ? AND is_active = 1').get(targetId);
  if (!emp) return res.status(404).json({ error: 'Employee not found' });

  const today = getTodayDate();
  const nowObj = new Date();
  const nowIso = nowObj.toISOString();
  const existing = db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(targetId, today);

  // Round 5 #1: Idempotent clock-in (if already open or clocked in within last 10s, return existing without new log)
  if (existing && existing.clock_in) {
    const isOpen = !existing.clock_out;
    const within10s = nowObj.getTime() - new Date(existing.clock_in).getTime() <= 10000;
    if (isOpen || within10s) {
      return res.json({ ok: true, idempotent: true, status: 'active', clock_in: existing.clock_in, attendance: existing });
    }
  }

  // Round 5 #2: After-hours clock-in policy
  const settings = getSettings();
  const [eh, em] = (emp.shift_end || settings.shiftEnd).split(':').map(Number);
  const bufferMins = settings.autoClockOutBufferMinutes || 120;
  const cutoffMins = eh * 60 + em + bufferMins;
  const nowTotalMins = nowObj.getHours() * 60 + nowObj.getMinutes();
  let isAfterHours = false;
  if (nowTotalMins > cutoffMins) {
    if ((settings.afterHoursClockInMode || 'block') === 'block') {
      const ch = String(Math.floor(cutoffMins / 60) % 24).padStart(2, '0');
      const cm = String(cutoffMins % 60).padStart(2, '0');
      return res.status(400).json({
        error: `Shift ended — clock-in not allowed after ${ch}:${cm}. Contact admin.`,
      });
    }
    isAfterHours = true;
  }

  const clockReason = isAfterHours
    ? 'After-hours / overtime session'
    : (notes || formatClockInReason(emp.shift_start, nowObj, settings.lateGraceMinutes));

  if (existing && existing.clock_out) {
    db.prepare(`UPDATE attendance SET clock_out = NULL, missed_clock_out = 0, tracking_mode = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(safeTrackingMode, clockReason, existing.id);
  } else {
    const arrivalStatus = computeArrivalStatus(emp.shift_start, nowObj, settings.lateGraceMinutes);
    db.prepare(`
      INSERT INTO attendance (employee_id, date, clock_in, status, tracking_mode, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(targetId, today, nowIso, arrivalStatus, safeTrackingMode, clockReason);
  }

  db.prepare(`
    UPDATE employees
    SET status = 'active', last_seen_at = ?, last_heartbeat_at = ?, last_heartbeat_state = 'active'
    WHERE id = ?
  `).run(nowIso, nowIso, targetId);
  db.prepare(`
    INSERT INTO activity_logs (employee_id, date, type, reason, timestamp)
    VALUES (?, ?, 'clock_in', ?, ?)
  `).run(targetId, today, clockReason, nowIso);

  res.json({ ok: true, status: 'active', clock_in: nowIso });
});

app.post('/api/attendance/clock-out', (req, res) => {
  const isPrivileged = req.user.role === 'admin' || req.user.role === 'manager';
  const targetId = isPrivileged && req.body.employeeId ? Number(req.body.employeeId) : req.user.id;
  const { notes = '' } = req.body;

  const today = getTodayDate();
  const nowIso = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(targetId, today);

  if (!existing || !existing.clock_in) {
    return res.status(400).json({ error: 'Cannot clock out before clocking in.' });
  }

  const settings = getSettings();
  const netShiftSec = settings.netWorkHours * 3600;
  const overtime = Math.max(0, (existing.active_seconds || 0) - netShiftSec);

  db.prepare(`
    UPDATE attendance
    SET clock_out = ?, overtime_seconds = ?, missed_clock_out = 0,
        notes = CASE WHEN ? != '' THEN ? ELSE notes END, updated_at = datetime('now')
    WHERE id = ?
  `).run(nowIso, overtime, notes, notes, existing.id);

  db.prepare(`
    UPDATE employees
    SET status = 'offline', last_seen_at = ?, last_heartbeat_at = NULL, last_heartbeat_state = NULL, active_session_id = NULL
    WHERE id = ?
  `).run(nowIso, targetId);
  db.prepare(`
    INSERT INTO activity_logs (employee_id, date, type, duration_seconds, reason, timestamp)
    VALUES (?, ?, 'clock_out', ?, ?, ?)
  `).run(targetId, today, existing.active_seconds || 0, notes || 'Shift clocked out', nowIso);

  res.json({ ok: true, status: 'offline', clock_out: nowIso });
});

// Phase 1 #4 + Phase 2 #6, #8, #9 + Phase 3 #14
app.post('/api/activity/heartbeat', (req, res) => {
  const { state, reason = '', sessionId = '', claimSession = false, trackingMode } = req.body;
  if (!['active', 'idle', 'break'].includes(state)) {
    return res.status(400).json({ error: 'Valid state (active|idle|break) required' });
  }

  const employeeId = req.user.id;
  const emp = db.prepare('SELECT * FROM employees WHERE id = ? AND is_active = 1').get(employeeId);
  if (!emp) return res.status(404).json({ error: 'Employee not found' });

  const today = getTodayDate();
  const now = new Date();
  const nowIso = now.toISOString();
  const att = db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(employeeId, today);

  if (!att || !att.clock_in || att.clock_out) {
    return res.json({ ok: true, ignored: true, reason: 'Employee not currently clocked in' });
  }

  // Multi-tab check (#9): only credit time from the most recent active session
  if (sessionId && emp.active_session_id && emp.active_session_id !== sessionId && !claimSession) {
    const lastHbMs = emp.last_heartbeat_at ? new Date(emp.last_heartbeat_at).getTime() : 0;
    if (now.getTime() - lastHbMs < 90000) {
      return res.json({ ok: true, pausedByOtherTab: true, attendance: att });
    }
  }

  // Tolerate 60s background-tab throttling without losing or double-counting time
  let elapsedSeconds = 0;
  if (emp.last_heartbeat_at) {
    const diffMs = now.getTime() - new Date(emp.last_heartbeat_at).getTime();
    elapsedSeconds = Math.max(0, Math.min(65, Math.round(diffMs / 1000)));
  }

  const prevState = ['active', 'idle', 'break'].includes(emp.last_heartbeat_state)
    ? emp.last_heartbeat_state
    : (['active', 'idle', 'break'].includes(emp.status) ? emp.status : 'active');
  const col = prevState === 'active' ? 'active_seconds' : prevState === 'idle' ? 'idle_seconds' : 'break_seconds';

  const settings = getSettings();
  const netShiftSec = settings.netWorkHours * 3600;
  const safeTrackingMode = trackingMode === 'system' || trackingMode === 'tab_only' ? trackingMode : null;

  if (elapsedSeconds > 0 || safeTrackingMode) {
    db.prepare(`
      UPDATE attendance
      SET ${col} = ${col} + ?,
          overtime_seconds = MAX(0, (active_seconds + CASE WHEN ? = 'active_seconds' THEN ? ELSE 0 END) - ?),
          tracking_mode = COALESCE(?, tracking_mode),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(elapsedSeconds, col, elapsedSeconds, netShiftSec, safeTrackingMode, att.id);
  }

  // Round 5 #4: Collapse state transitions within 2s into a single event (never >1 transition/sec)
  if (emp.status !== state) {
    let logType = null;
    if (state === 'break') logType = 'break_start';
    else if (emp.status === 'break' && state === 'active') logType = 'break_end';
    else if (state === 'idle' && (att.idle_seconds || 0) >= 120) logType = 'idle_start';
    else if (emp.status === 'idle' && state === 'active' && (att.idle_seconds || 0) >= 120) logType = 'idle_end';

    if (logType) {
      const latestLog = db.prepare(`
        SELECT id, type, timestamp FROM activity_logs
        WHERE employee_id = ? AND date = ? AND type IN ('idle_start', 'idle_end', 'break_start', 'break_end')
        ORDER BY id DESC LIMIT 1
      `).get(employeeId, today);

      const within10s = latestLog && (now.getTime() - new Date(latestLog.timestamp).getTime() <= 10000);
      if (within10s) {
        db.prepare(`UPDATE activity_logs SET type = ?, reason = ?, timestamp = ? WHERE id = ?`)
          .run(logType, reason || `Switched to ${state}`, nowIso, latestLog.id);
      } else {
        db.prepare(`
          INSERT INTO activity_logs (employee_id, date, type, reason, timestamp)
          VALUES (?, ?, ?, ?, ?)
        `).run(employeeId, today, logType, reason || `Switched to ${state}`, nowIso);
      }
    }
  }

  db.prepare(`
    UPDATE employees
    SET status = ?, last_seen_at = ?, last_heartbeat_at = ?, last_heartbeat_state = ?,
        active_session_id = COALESCE(NULLIF(?, ''), active_session_id)
    WHERE id = ?
  `).run(state, nowIso, nowIso, state, sessionId, employeeId);

  const updatedAtt = db.prepare('SELECT * FROM attendance WHERE id = ?').get(att.id);
  res.json({
    ok: true,
    state,
    creditedState: prevState,
    creditedSeconds: elapsedSeconds,
    pausedByOtherTab: false,
    attendance: updatedAtt,
  });
});

app.get('/api/activity/logs', (req, res) => {
  const date = req.query.date || getTodayDate();
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(5, Number(req.query.limit || 20)));
  const offset = (page - 1) * limit;
  const isPrivileged = req.user.role === 'admin' || req.user.role === 'manager';

  const rows = db.prepare(`
    SELECT l.*, e.name as employee_name, e.emp_code
    FROM activity_logs l
    JOIN employees e ON e.id = l.employee_id
    WHERE l.date = ? ${isPrivileged ? '' : 'AND l.employee_id = ?'}
    ORDER BY l.id DESC
    LIMIT ? OFFSET ?
  `).all(...(isPrivileged ? [date, limit, offset] : [date, req.user.id, limit, offset]));
  res.json({ page, limit, rows });
});

app.patch('/api/attendance/:employeeId', requireRole('admin', 'manager'), (req, res) => {
  const { employeeId } = req.params;
  const { date = getTodayDate(), status, notes, clock_in, clock_out } = req.body;
  const month = String(date).slice(0, 7);
  if (isPayrollLocked(month)) {
    return res.status(409).json({ error: `Payroll is locked for ${month}. Unlock payroll before editing attendance.` });
  }
  if (status && !['present', 'late', 'half_day', 'absent', 'on_leave'].includes(status)) {
    return res.status(400).json({ error: 'Invalid attendance status' });
  }

  const existing = db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(employeeId, date);
  if (existing) {
    db.prepare(`
      UPDATE attendance
      SET status = COALESCE(?, status),
          notes = COALESCE(?, notes),
          clock_in = CASE WHEN ? IS NOT NULL THEN ? ELSE clock_in END,
          clock_out = CASE WHEN ? IS NOT NULL THEN ? ELSE clock_out END,
          missed_clock_out = 0,
          manual_override = 1,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      status ?? null,
      notes ?? null,
      clock_in !== undefined ? 1 : null,
      clock_in || null,
      clock_out !== undefined ? 1 : null,
      clock_out || null,
      existing.id
    );
  } else {
    db.prepare(`
      INSERT INTO attendance (employee_id, date, status, clock_in, clock_out, notes, manual_override)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(employeeId, date, status || 'present', clock_in || null, clock_out || null, notes || '');
  }

  writeAuditLog({
    actorId: req.user.id,
    actorName: req.user.name,
    action: 'OVERRIDE_ATTENDANCE',
    entityType: 'attendance',
    entityId: `${employeeId}:${date}`,
    oldValue: existing ? { status: existing.status, clock_in: existing.clock_in, clock_out: existing.clock_out } : null,
    newValue: { status, clock_in, clock_out, notes },
  });
  res.json({ ok: true });
});

// ========================
// LEAVES & HOLIDAYS
// ========================
app.get('/api/leaves', (req, res) => {
  const isPrivileged = req.user.role === 'admin' || req.user.role === 'manager';

  const leaves = db.prepare(`
    SELECT l.*, e.name as employee_name, e.emp_code, e.department, e.avatar_color,
      r.name as reviewer_name
    FROM leaves l
    JOIN employees e ON e.id = l.employee_id
    LEFT JOIN employees r ON r.id = l.reviewed_by
    ${isPrivileged ? '' : 'WHERE l.employee_id = ?'}
    ORDER BY l.id DESC
  `).all(...(isPrivileged ? [] : [req.user.id]));

  const settings = getSettings();
  const currentYear = Number(getTodayDate().slice(0, 4));
  const employees = db.prepare(`
    SELECT id, emp_code, name, department, COALESCE(joining_date, substr(created_at, 1, 10)) as joining_date FROM employees
    WHERE is_active = 1 ${isPrivileged ? '' : 'AND id = ?'}
    ORDER BY id ASC
  `).all(...(isPrivileged ? [] : [req.user.id]));

  const approved = db.prepare(`
    SELECT employee_id, leave_type, SUM(days) as used
    FROM leaves WHERE status = 'approved'
    GROUP BY employee_id, leave_type
  `).all();

  const balances = employees.map((emp) => {
    const getUsed = (type) => approved.find((a) => a.employee_id === emp.id && a.leave_type === type)?.used || 0;
    let earnedTotal = 15;
    if (settings.prorateAnnualLeave !== false && emp.joining_date) {
      const jy = Number(String(emp.joining_date).slice(0, 4));
      const jm = Number(String(emp.joining_date).slice(5, 7));
      if (jy === currentYear && jm >= 1 && jm <= 12) {
        const remainingMonths = 13 - jm;
        earnedTotal = Math.floor(((earnedTotal * remainingMonths) / 12) * 2) / 2;
      } else if (jy > currentYear) {
        earnedTotal = 0;
      }
    }
    return {
      employee_id: emp.id,
      emp_code: emp.emp_code,
      name: emp.name,
      department: emp.department,
      casual_total: 12,
      casual_used: getUsed('casual'),
      sick_total: 8,
      sick_used: getUsed('sick'),
      earned_total: earnedTotal,
      earned_used: getUsed('earned'),
      unpaid_used: getUsed('unpaid'),
    };
  });

  res.json({ leaves, balances });
});

app.post('/api/leaves', (req, res) => {
  const isPrivileged = req.user.role === 'admin' || req.user.role === 'manager';
  const targetEmployeeId = isPrivileged && req.body.employee_id ? Number(req.body.employee_id) : req.user.id;
  const { leave_type = 'casual', start_date, end_date, reason = '' } = req.body;
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date are required.' });
  }
  const s = new Date(start_date);
  const e = new Date(end_date);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) {
    return res.status(400).json({ error: 'End date must be on or after start date.' });
  }
  const clockedConflict = db.prepare(
    `SELECT date FROM attendance WHERE employee_id = ? AND date >= ? AND date <= ? AND clock_in IS NOT NULL LIMIT 1`
  ).get(targetEmployeeId, start_date, end_date);
  if (clockedConflict) {
    return res.status(400).json({ error: `Cannot apply leave for ${clockedConflict.date} — already clocked in.` });
  }
  // Phase 3 #11: skip weekends & holidays
  const days = countWorkingLeaveDays(start_date, end_date);
  if (days <= 0) {
    return res.status(400).json({ error: 'Selected range contains only weekends or holidays.' });
  }

  const info = db.prepare(`
    INSERT INTO leaves (employee_id, leave_type, start_date, end_date, days, reason, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(targetEmployeeId, leave_type, start_date, end_date, days, reason.trim());

  res.status(201).json(db.prepare('SELECT * FROM leaves WHERE id = ?').get(info.lastInsertRowid));
});

app.patch('/api/leaves/:id', requireRole('admin', 'manager'), (req, res) => {
  const { id } = req.params;
  const { status, comment = '' } = req.body;
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'Invalid leave status' });
  }
  const leave = db.prepare('SELECT * FROM leaves WHERE id = ?').get(id);
  if (!leave) return res.status(404).json({ error: 'Leave request not found' });

  db.prepare(`
    UPDATE leaves SET status = ?, reviewed_by = ?, reviewer_comment = ?, reviewed_at = datetime('now') WHERE id = ?
  `).run(status, req.user.id, comment, id);

  if (status === 'approved') {
    const settings = getSettings();
    const weekendSet = new Set(settings.weekendDays || [0, 6]);
    const holidays = new Set(db.prepare('SELECT date FROM holidays').all().map((h) => h.date));
    const start = new Date(`${leave.start_date}T00:00:00`);
    const end = new Date(`${leave.end_date}T00:00:00`);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (weekendSet.has(d.getDay()) || holidays.has(dateStr)) continue;
      db.prepare(`
        INSERT INTO attendance (employee_id, date, status, notes)
        VALUES (?, ?, 'on_leave', ?)
        ON CONFLICT(employee_id, date) DO UPDATE SET status = 'on_leave', notes = excluded.notes
      `).run(leave.employee_id, dateStr, `Approved ${leave.leave_type} leave`);
    }
  }

  writeAuditLog({
    actorId: req.user.id,
    actorName: req.user.name,
    action: `LEAVE_${status.toUpperCase()}`,
    entityType: 'leave',
    entityId: id,
    oldValue: { status: leave.status },
    newValue: { status, comment },
  });

  res.json(db.prepare('SELECT * FROM leaves WHERE id = ?').get(id));
});

app.get('/api/holidays', (_req, res) => {
  res.json(db.prepare('SELECT * FROM holidays ORDER BY date ASC').all());
});

app.post('/api/holidays', requireRole('admin', 'manager'), (req, res) => {
  const { date, name } = req.body;
  if (!date || !name?.trim()) return res.status(400).json({ error: 'Date and holiday name required.' });
  try {
    const info = db.prepare('INSERT INTO holidays (date, name) VALUES (?, ?)').run(date, name.trim());
    writeAuditLog({
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'ADD_HOLIDAY',
      entityType: 'holiday',
      entityId: date,
      newValue: { date, name },
    });
    res.status(201).json(db.prepare('SELECT * FROM holidays WHERE id = ?').get(info.lastInsertRowid));
  } catch {
    res.status(409).json({ error: 'Holiday already exists for this date.' });
  }
});

app.delete('/api/holidays/:id', requireRole('admin', 'manager'), (req, res) => {
  db.prepare('DELETE FROM holidays WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ========================
// MONTHLY REPORTS & PAYROLL (Phase 3 #12: Proration, Late Deduction, Lock)
// ========================
export function buildMonthlyReport(month) {
  const likePattern = `${month}-%`;
  const settings = getSettings();
  const employees = db.prepare('SELECT * FROM employees WHERE is_active = 1 ORDER BY id ASC').all();
  const attRows = db.prepare('SELECT * FROM attendance WHERE date LIKE ?').all(likePattern);
  const taskRows = db.prepare('SELECT * FROM tasks WHERE due_date LIKE ?').all(likePattern);
  const salaries = db.prepare('SELECT * FROM salary_structures').all();
  const approvedLeaves = db.prepare(`SELECT * FROM leaves WHERE status = 'approved' AND start_date LIKE ?`).all(likePattern);

  const currentMonth = getCurrentMonth();
  const todayDate = getTodayDate();
  const todayDay = new Date().getDate();
  const totalWorkingDays = countMonthWorkingDays(month);
  const elapsedWorkingDays = month === currentMonth ? countMonthWorkingDays(month, todayDay) : (month < currentMonth ? totalWorkingDays : 0);
  const prorationRatio = Math.min(1, elapsedWorkingDays / Math.max(1, totalWorkingDays));
  const locked = isPayrollLocked(month);
  const holidayRows = db.prepare('SELECT date FROM holidays WHERE date LIKE ?').all(likePattern);
  const holidaySet = new Set(holidayRows.map((h) => h.date));
  const weekendSet = new Set(settings.weekendDays || [0, 6]);
  const [my, mm] = month.split('-').map(Number);
  const daysInMonth = new Date(my, mm, 0).getDate();
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(daysInMonth).padStart(2, '0')}`;

  const countRangeWorkingAndHolidays = (startStr, endStr) => {
    if (!startStr || !endStr || startStr > endStr) return { working: 0, holidays: 0 };
    let working = 0;
    let holidays = 0;
    const s = new Date(`${startStr}T00:00:00`);
    const e = new Date(`${endStr}T00:00:00`);
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (weekendSet.has(d.getDay())) continue;
      if (holidaySet.has(ds)) holidays += 1;
      else working += 1;
    }
    return { working, holidays };
  };

  const rows = employees.map((emp) => {
    const empAtt = attRows.filter((a) => a.employee_id === emp.id);
    const presentDays = empAtt.filter((a) => a.status === 'present').length;
    const lateDays = empAtt.filter((a) => a.status === 'late').length;
    const halfDays = empAtt.filter((a) => a.status === 'half_day').length;
    const leaveDays = empAtt.filter((a) => a.status === 'on_leave').length;
    const absentDays = empAtt.filter((a) => a.status === 'absent').length;

    const totalActiveSeconds = empAtt.reduce((s, a) => s + (a.active_seconds || 0), 0);
    const totalIdleSeconds = empAtt.reduce((s, a) => s + (a.idle_seconds || 0), 0);
    const totalBreakSeconds = empAtt.reduce((s, a) => s + (a.break_seconds || 0), 0);
    const totalOvertimeSeconds = empAtt.reduce((s, a) => s + (a.overtime_seconds || 0), 0);

    const empTasks = taskRows.filter((t) => t.assignee_id === emp.id);
    const tasksCompleted = empTasks.filter((t) => t.status === 'completed').length;
    const tasksPending = empTasks.filter((t) => t.status !== 'completed').length;

    const unpaidLeaveDays = approvedLeaves
      .filter((l) => l.employee_id === emp.id && l.leave_type === 'unpaid')
      .reduce((s, l) => s + l.days, 0);

    const rawSal = salaries.find((s) => s.employee_id === emp.id);
    let salaryObj = null;
    if (rawSal) {
      const sal = {
        currency: rawSal.currency || 'INR',
        base_monthly_salary: Number(rawSal.base_monthly_salary ?? 0),
        hra: Number(rawSal.hra ?? 0),
        transport_allowance: Number(rawSal.transport_allowance ?? 0),
        special_allowance: Number(rawSal.special_allowance ?? 0),
        pf_deduction: Number(rawSal.pf_deduction ?? 0),
        tax_deduction: Number(rawSal.tax_deduction ?? 0),
        overtime_hourly_rate: Number(rawSal.overtime_hourly_rate ?? 0),
        working_days_per_month: Number(rawSal.working_days_per_month ?? 22),
      };

      const grossSalary = sal.base_monthly_salary + sal.hra + sal.transport_allowance + sal.special_allowance;
      const perDayRate = grossSalary / Math.max(1, sal.working_days_per_month);
      const lateLopDays = settings.lateDeductionEnabled
        ? Math.floor(lateDays / Math.max(1, settings.lateDaysPerHalfDayLop)) * 0.5
        : 0;
      const unpaidDeduction = Math.round((absentDays + unpaidLeaveDays + lateLopDays) * perDayRate + halfDays * 0.5 * perDayRate);
      const overtimePay = Math.round((totalOvertimeSeconds / 3600) * sal.overtime_hourly_rate);
      const totalDeductions = sal.pf_deduction + sal.tax_deduction + unpaidDeduction;

      const joiningDate = (emp.joining_date || (emp.created_at ? String(emp.created_at).slice(0, 10) : monthStart)).slice(0, 10);
      let netSalary = 0;
      let proratedNet = 0;

      if (joiningDate <= monthEnd && month <= currentMonth) {
        const empStart = joiningDate > monthStart ? joiningDate : monthStart;
        const mtdEnd = month === currentMonth ? todayDate : monthEnd;
        const mtdCounts = countRangeWorkingAndHolidays(empStart, mtdEnd);
        const fullCounts = countRangeWorkingAndHolidays(empStart, monthEnd);

        const attendedDays = presentDays + lateDays + halfDays * 0.5;
        const paidLeaveDays = Math.max(0, leaveDays - unpaidLeaveDays);
        const paidDaysMtd = attendedDays + paidLeaveDays + mtdCounts.holidays;

        const employedMonthRatio = Math.min(1, (fullCounts.working + fullCounts.holidays) / Math.max(1, sal.working_days_per_month));
        const mtdRatio = Math.min(1, paidDaysMtd / Math.max(1, sal.working_days_per_month));

        const employedGrossProj = empStart > monthStart
          ? Math.min(grossSalary, Math.round(perDayRate * (fullCounts.working + fullCounts.holidays)))
          : grossSalary;
        const projFixedDed = Math.round((sal.pf_deduction + sal.tax_deduction) * employedMonthRatio);
        netSalary = Math.max(0, Math.round(employedGrossProj + overtimePay - projFixedDed - unpaidDeduction));

        const proratedGross = Math.min(grossSalary, Math.round(perDayRate * paidDaysMtd));
        const mtdFixedDed = Math.round((sal.pf_deduction + sal.tax_deduction) * mtdRatio);
        const lateLopDed = Math.round(lateLopDays * perDayRate);
        proratedNet = paidDaysMtd <= 0 && overtimePay <= 0
          ? 0
          : Math.max(0, Math.round(proratedGross + overtimePay - mtdFixedDed - lateLopDed));
      }

      salaryObj = {
        ...sal,
        gross_salary: grossSalary,
        overtime_pay: overtimePay,
        unpaid_deduction: unpaidDeduction,
        total_deductions: totalDeductions,
        net_salary: netSalary,
        prorated_net_salary: proratedNet,
      };
    }

    return {
      employee_id: emp.id,
      emp_code: emp.emp_code,
      name: emp.name,
      department: emp.department,
      designation: emp.designation,
      avatar_color: emp.avatar_color,
      present_days: presentDays,
      late_days: lateDays,
      half_days: halfDays,
      leave_days: leaveDays,
      absent_days: absentDays,
      total_logged_days: empAtt.length,
      total_active_seconds: totalActiveSeconds,
      total_idle_seconds: totalIdleSeconds,
      total_break_seconds: totalBreakSeconds,
      total_overtime_seconds: totalOvertimeSeconds,
      tasks_completed: tasksCompleted,
      tasks_pending: tasksPending,
      salary_set: Boolean(rawSal),
      salary: salaryObj,
    };
  });

  return {
    month,
    locked,
    isCurrentMonth: month === currentMonth,
    elapsedWorkingDays,
    totalWorkingDays,
    prorationRatio,
    rows,
  };
}

app.get('/api/reports/monthly', requireRole('admin', 'manager'), (req, res) => {
  const month = req.query.month || getCurrentMonth();
  res.json(buildMonthlyReport(month));
});

// Employee's own monthly summary / payslip
app.get('/api/reports/me', (req, res) => {
  const month = req.query.month || getCurrentMonth();
  const full = buildMonthlyReport(month);
  res.json({
    ...full,
    rows: full.rows.filter((r) => r.employee_id === req.user.id),
  });
});

// Employee's own monthly CSV export
app.get('/api/export/me', (req, res) => {
  const month = req.query.month || getCurrentMonth();
  const report = buildMonthlyReport(month);
  const myRows = report.rows.filter((r) => r.employee_id === req.user.id);
  const header = [
    'Code', 'Name', 'Department', 'Attended Days', 'Present Days', 'Late Days', 'Half Days',
    'Leave Days', 'Absent Days', 'Active Hours', 'Idle Hours', 'Overtime Hours',
    'Gross Salary', 'Overtime Pay', 'Deductions', 'Projected Net', 'Month-To-Date Net', 'Currency'
  ];
  const lines = [
    header.join(','),
    ...myRows.map((r) => [
      r.emp_code,
      r.name,
      r.department,
      r.present_days + r.late_days + r.half_days,
      r.present_days,
      r.late_days,
      r.half_days,
      r.leave_days,
      r.absent_days,
      (r.total_active_seconds / 3600).toFixed(2),
      (r.total_idle_seconds / 3600).toFixed(2),
      (r.total_overtime_seconds / 3600).toFixed(2),
      r.salary?.gross_salary ?? 'Salary not set',
      r.salary?.overtime_pay ?? 0,
      r.salary?.total_deductions ?? 0,
      r.salary?.net_salary ?? 'Salary not set',
      r.salary?.prorated_net_salary ?? 'Salary not set',
      r.salary?.currency ?? 'INR',
    ].map(csvEscape).join(',')),
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="zaviroq-my-report-${month}.csv"`);
  res.send(lines.join('\n'));
});

app.post('/api/payroll/lock', requireRole('admin', 'manager'), (req, res) => {
  const month = req.body.month || getCurrentMonth();
  db.prepare(`INSERT OR IGNORE INTO payroll_locks (month, locked_by) VALUES (?, ?)`).run(month, req.user.id);
  writeAuditLog({
    actorId: req.user.id,
    actorName: req.user.name,
    action: 'LOCK_PAYROLL',
    entityType: 'payroll',
    entityId: month,
    newValue: { locked: true },
  });
  res.json({ ok: true, month, locked: true });
});

app.delete('/api/payroll/lock/:month', requireRole('admin', 'manager'), (req, res) => {
  const { month } = req.params;
  db.prepare(`DELETE FROM payroll_locks WHERE month = ?`).run(month);
  writeAuditLog({
    actorId: req.user.id,
    actorName: req.user.name,
    action: 'UNLOCK_PAYROLL',
    entityType: 'payroll',
    entityId: month,
    newValue: { locked: false },
  });
  res.json({ ok: true, month, locked: false });
});

app.get('/api/export/monthly', requireRole('admin', 'manager'), (req, res) => {
  const month = req.query.month || getCurrentMonth();
  const report = buildMonthlyReport(month);
  const header = [
    'Code', 'Name', 'Department', 'Present Days', 'Late Days', 'Half Days',
    'Leave Days', 'Absent Days', 'Active Hours', 'Idle Hours', 'Overtime Hours',
    'Gross Salary', 'Overtime Pay', 'Deductions', 'Projected Net', 'Month-To-Date Net', 'Currency'
  ];
  const lines = [
    header.join(','),
    ...report.rows.filter((r) => r.salary_set && r.salary).map((r) => [
      r.emp_code,
      r.name,
      r.department,
      r.present_days,
      r.late_days,
      r.half_days,
      r.leave_days,
      r.absent_days,
      (r.total_active_seconds / 3600).toFixed(2),
      (r.total_idle_seconds / 3600).toFixed(2),
      (r.total_overtime_seconds / 3600).toFixed(2),
      r.salary?.gross_salary ?? 'Salary not set',
      r.salary?.overtime_pay ?? 0,
      r.salary?.total_deductions ?? 0,
      r.salary?.net_salary ?? 'Salary not set',
      r.salary?.prorated_net_salary ?? 'Salary not set',
      r.salary?.currency ?? 'INR',
    ].map(csvEscape).join(',')),
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="zaviroq-monthly-payroll-${month}.csv"`);
  res.send(lines.join('\n'));
});

app.get('/api/export/attendance', requireRole('admin', 'manager'), (req, res) => {
  const date = req.query.date || getTodayDate();
  const rows = db.prepare(`
    SELECT e.emp_code, e.name, e.department, e.designation,
      COALESCE(a.status, 'absent') as status,
      a.clock_in, a.clock_out,
      COALESCE(a.active_seconds, 0) as active_seconds,
      COALESCE(a.idle_seconds, 0) as idle_seconds,
      COALESCE(a.break_seconds, 0) as break_seconds,
      COALESCE(a.overtime_seconds, 0) as overtime_seconds,
      COALESCE(a.missed_clock_out, 0) as missed_clock_out,
      COALESCE(a.notes, '') as notes
    FROM employees e
    LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = ?
    WHERE e.is_active = 1
    ORDER BY e.id ASC
  `).all(date);

  const header = ['Code', 'Name', 'Department', 'Designation', 'Status', 'Clock In', 'Clock Out', 'Active (min)', 'Idle (min)', 'Break (min)', 'Overtime (min)', 'Missed Clock Out', 'Notes'];
  const lines = [
    header.join(','),
    ...rows.map((r) => [
      r.emp_code,
      r.name,
      r.department,
      r.designation,
      r.status,
      r.clock_in || '',
      r.clock_out || '',
      Math.round(r.active_seconds / 60),
      Math.round(r.idle_seconds / 60),
      Math.round(r.break_seconds / 60),
      Math.round(r.overtime_seconds / 60),
      r.missed_clock_out ? 'Yes' : 'No',
      r.notes,
    ].map(csvEscape).join(',')),
  ];

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="zaviroq-attendance-${date}.csv"`);
  res.send(lines.join('\n'));
});

// ========================
// SALARY STRUCTURE SETUP
// ========================
app.get('/api/salaries', requireRole('admin', 'manager'), (_req, res) => {
  const rows = db.prepare(`
    SELECT e.id as employee_id, e.emp_code, e.name, e.department, e.designation, e.avatar_color,
      s.currency, s.base_monthly_salary, s.hra, s.transport_allowance, s.special_allowance,
      s.pf_deduction, s.tax_deduction, s.overtime_hourly_rate, s.working_days_per_month, s.updated_at
    FROM employees e
    LEFT JOIN salary_structures s ON s.employee_id = e.id
    WHERE e.is_active = 1
    ORDER BY e.id ASC
  `).all();
  res.json(rows);
});

app.put('/api/salaries/:employeeId', requireRole('admin', 'manager'), (req, res) => {
  const { employeeId } = req.params;
  const month = req.body.month || getCurrentMonth();
  if (isPayrollLocked(month)) {
    return res.status(409).json({ error: `Payroll is locked for ${month}. Unlock payroll before editing salaries.` });
  }
  const {
    currency = 'INR',
    base_monthly_salary = 50000,
    hra = 15000,
    transport_allowance = 3000,
    special_allowance = 7000,
    pf_deduction = 3600,
    tax_deduction = 2500,
    overtime_hourly_rate = 450,
    working_days_per_month = 22,
  } = req.body;

  const oldSal = db.prepare('SELECT * FROM salary_structures WHERE employee_id = ?').get(employeeId);

  db.prepare(`
    INSERT INTO salary_structures (
      employee_id, currency, base_monthly_salary, hra, transport_allowance,
      special_allowance, pf_deduction, tax_deduction, overtime_hourly_rate, working_days_per_month, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(employee_id) DO UPDATE SET
      currency = excluded.currency,
      base_monthly_salary = excluded.base_monthly_salary,
      hra = excluded.hra,
      transport_allowance = excluded.transport_allowance,
      special_allowance = excluded.special_allowance,
      pf_deduction = excluded.pf_deduction,
      tax_deduction = excluded.tax_deduction,
      overtime_hourly_rate = excluded.overtime_hourly_rate,
      working_days_per_month = excluded.working_days_per_month,
      updated_at = datetime('now')
  `).run(
    Number(employeeId),
    currency,
    Number(base_monthly_salary),
    Number(hra),
    Number(transport_allowance),
    Number(special_allowance),
    Number(pf_deduction),
    Number(tax_deduction),
    Number(overtime_hourly_rate),
    Math.max(1, Number(working_days_per_month))
  );

  const updated = db.prepare('SELECT * FROM salary_structures WHERE employee_id = ?').get(employeeId);
  writeAuditLog({
    actorId: req.user.id,
    actorName: req.user.name,
    action: 'UPDATE_SALARY',
    entityType: 'salary',
    entityId: employeeId,
    oldValue: oldSal,
    newValue: updated,
  });

  res.json(updated);
});

// ========================
// TASKS CRUD (Phase 3 #13: Blocked -> Completed guard)
// ========================
app.post('/api/tasks', (req, res) => {
  const isPrivileged = req.user.role === 'admin' || req.user.role === 'manager';
  const {
    title,
    description = '',
    assignee_id,
    department = req.user.department || 'Engineering',
    priority = 'medium',
    status = 'pending',
    due_date = getTodayDate(),
    estimated_minutes = 60,
    tags = [],
  } = req.body;

  const targetAssignee = isPrivileged && assignee_id ? Number(assignee_id) : req.user.id;
  if (!title?.trim()) {
    return res.status(400).json({ error: 'Task title is required.' });
  }

  const info = db.prepare(`
    INSERT INTO tasks (title, description, assignee_id, created_by, department, priority, status, due_date, estimated_minutes, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    title.trim(),
    description.trim(),
    targetAssignee,
    req.user.id,
    department,
    priority,
    status,
    due_date,
    Number(estimated_minutes) || 60,
    JSON.stringify(Array.isArray(tags) ? tags : [])
  );

  res.status(201).json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid));
});

app.patch('/api/tasks/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Task not found' });

  const isPrivileged = req.user.role === 'admin' || req.user.role === 'manager';
  if (!isPrivileged && existing.assignee_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden: you can only update your own tasks' });
  }

  const {
    title = existing.title,
    description = existing.description,
    assignee_id = existing.assignee_id,
    priority = existing.priority,
    status = existing.status,
    due_date = existing.due_date,
    estimated_minutes = existing.estimated_minutes,
    logged_minutes = existing.logged_minutes,
    unblockNote = '',
  } = req.body;

  // Phase 3 #13: A blocked task cannot go straight to completed without unblocking or a note
  if (existing.status === 'blocked' && status === 'completed' && !unblockNote.trim()) {
    return res.status(400).json({
      error: 'A blocked task cannot go straight to Completed. Move it to In Progress first or provide an unblock note.',
    });
  }

  const targetAssignee = isPrivileged ? Number(assignee_id) : existing.assignee_id;
  const completed_at = status === 'completed'
    ? (existing.completed_at || new Date().toISOString())
    : null;

  db.prepare(`
    UPDATE tasks
    SET title = ?, description = ?, assignee_id = ?, priority = ?, status = ?,
        due_date = ?, estimated_minutes = ?, logged_minutes = ?, completed_at = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title,
    description,
    targetAssignee,
    priority,
    status,
    due_date,
    Number(estimated_minutes),
    Number(logged_minutes),
    completed_at,
    id
  );

  if (status !== existing.status) {
    db.prepare(`
      INSERT INTO activity_logs (employee_id, date, type, reason, timestamp)
      VALUES (?, ?, 'task_update', ?, ?)
    `).run(targetAssignee, getTodayDate(), `Task "${title}" → ${status.replace('_', ' ')}`, new Date().toISOString());
  }

  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
});

app.delete('/api/tasks/:id', requireRole('admin', 'manager'), (req, res) => {
  const { id } = req.params;
  const info = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  if (info.changes === 0) return res.status(404).json({ error: 'Task not found' });
  res.json({ ok: true });
});

app.post('/api/announcements', requireRole('admin', 'manager'), (req, res) => {
  const { title, message, priority = 'normal' } = req.body;
  if (!title?.trim() || !message?.trim()) {
    return res.status(400).json({ error: 'Title and message are required' });
  }
  const info = db.prepare(`
    INSERT INTO announcements (title, message, author_id, priority)
    VALUES (?, ?, ?, ?)
  `).run(title.trim(), message.trim(), req.user.id, priority);
  res.status(201).json(db.prepare('SELECT * FROM announcements WHERE id = ?').get(info.lastInsertRowid));
});

// ========================
// PHASE 5: SETTINGS, AUDIT LOGS & NOTIFICATIONS
// ========================
app.get('/api/settings', requireRole('admin', 'manager'), (_req, res) => {
  res.json(getSettings());
});

app.put('/api/settings', requireRole('admin', 'manager'), (req, res) => {
  const oldSettings = getSettings();
  const allowedKeys = [
    'shiftStart', 'shiftEnd', 'lateGraceMinutes', 'lunchBreak', 'lunchMinutes',
    'teaBreakAfter', 'teaMinutes', 'totalBreakMinutes', 'netWorkHours',
    'idleThresholdSeconds', 'autoClockOutBufferMinutes', 'afterHoursClockInMode', 'weekendDays',
    'lateDeductionEnabled', 'lateDaysPerHalfDayLop', 'overtimePolicy', 'prorateAnnualLeave',
  ];
  const upsert = db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  for (const key of allowedKeys) {
    if (req.body[key] !== undefined) {
      const val = typeof req.body[key] === 'object' ? JSON.stringify(req.body[key]) : String(req.body[key]);
      upsert.run(key, val);
    }
  }
  const newSettings = getSettings();
  recalculateAttendanceLateStatuses({ id: req.user.id, name: req.user.name });
  writeAuditLog({
    actorId: req.user.id,
    actorName: req.user.name,
    action: 'UPDATE_SETTINGS',
    entityType: 'settings',
    entityId: 'global',
    oldValue: oldSettings,
    newValue: newSettings,
  });
  res.json(newSettings);
});

app.get('/api/audit-logs', requireRole('admin', 'manager'), (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize || req.query.limit || 50)));
  const offset = (page - 1) * pageSize;
  const { actor = '', action = '', date = '', grouped = 'false' } = req.query;

  const conditions = [];
  const params = [];
  if (actor === 'system') {
    conditions.push(`actor_id IS NULL`);
  } else if (actor === 'user') {
    conditions.push(`actor_id IS NOT NULL`);
  }
  if (action) {
    conditions.push(`action = ?`);
    params.push(action);
  }
  if (date) {
    conditions.push(`created_at LIKE ?`);
    params.push(`${date}%`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  if (grouped === 'true') {
    const allRows = db.prepare(`SELECT * FROM audit_logs ${where} ORDER BY id DESC`).all(...params);
    const recalcRows = allRows.filter((r) => r.action === 'RECALC_LATE_STATUS');
    const nonRecalcRows = allRows.filter((r) => r.action !== 'RECALC_LATE_STATUS');

    const combined = [...nonRecalcRows];
    if (recalcRows.length > 1) {
      combined.push({
        id: recalcRows[0].id,
        actor_id: null,
        actor_name: 'System',
        action: 'RECALC_LATE_STATUS_GROUP',
        entity_type: 'attendance',
        entity_id: `${recalcRows.length} records`,
        old_value: null,
        new_value: `Recalculated late status — ${recalcRows.length} records`,
        created_at: recalcRows[0].created_at,
        is_grouped: true,
        group_count: recalcRows.length,
        children: recalcRows,
      });
      combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    } else if (recalcRows.length === 1) {
      combined.push(recalcRows[0]);
      combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }

    const total = combined.length;
    const paged = combined.slice(offset, offset + pageSize);
    return res.json({ rows: paged, total, page, pageSize });
  }

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM audit_logs ${where}`).get(...params).cnt;
  const rows = db.prepare(`SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
  res.json({ rows, total, page, pageSize });
});

app.get('/api/notifications', (req, res) => {
  const today = getTodayDate();
  const settings = getSettings();
  const isPrivileged = req.user.role === 'admin' || req.user.role === 'manager';
  const notifications = [];

  // 1. Missed clock-out
  const missed = db.prepare(`
    SELECT a.date, e.name FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    WHERE a.missed_clock_out = 1 ${isPrivileged ? '' : 'AND a.employee_id = ?'}
    ORDER BY a.date DESC LIMIT 10
  `).all(...(isPrivileged ? [] : [req.user.id]));
  for (const m of missed) {
    notifications.push({ id: `missed-${m.name}-${m.date}`, type: 'warning', title: 'Missed Clock-Out', message: `${m.name} missed clock-out on ${m.date}` });
  }

  // 2. Break over limit today
  const breakOver = db.prepare(`
    SELECT e.name, a.break_seconds FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    WHERE a.date = ? AND a.break_seconds > ? ${isPrivileged ? '' : 'AND a.employee_id = ?'}
  `).all(...(isPrivileged ? [today, settings.totalBreakMinutes * 60] : [today, settings.totalBreakMinutes * 60, req.user.id]));
  for (const b of breakOver) {
    notifications.push({ id: `break-${b.name}`, type: 'warning', title: 'Break Over Limit', message: `${b.name} exceeded ${settings.totalBreakMinutes}m break (${Math.round(b.break_seconds / 60)}m)` });
  }

  // 3. Overdue tasks
  const tasks = db.prepare(`SELECT t.*, e.name as assignee_name FROM tasks t JOIN employees e ON e.id = t.assignee_id WHERE t.status != 'completed' ${isPrivileged ? '' : 'AND t.assignee_id = ?'}`).all(...(isPrivileged ? [] : [req.user.id]));
  for (const t of tasks) {
    if (isTaskOverdue(t, today, settings.shiftEnd)) {
      notifications.push({ id: `overdue-${t.id}`, type: 'danger', title: 'Task Overdue', message: `"${t.title}" (${t.assignee_name}) due ${t.due_date}` });
    }
  }

  // 4. Leaves pending > 24h (Admin/Manager)
  if (isPrivileged) {
    const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const oldLeaves = db.prepare(`SELECT l.id, e.name, l.start_date FROM leaves l JOIN employees e ON e.id = l.employee_id WHERE l.status = 'pending' AND l.created_at < ?`).all(cutoff);
    for (const l of oldLeaves) {
      notifications.push({ id: `leave-${l.id}`, type: 'info', title: 'Leave Pending >24h', message: `${l.name}'s leave (${l.start_date}) awaits review` });
    }
  }

  res.json(notifications);
});

// ========================
// TEAM CHAT & ZAVIROQ BOT (Phase 4 #16: File Uploads + ?after=<id> incremental)
// ========================
function saveChatImageFile(dataUrl) {
  const match = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match) return { error: 'Only PNG, JPEG, WEBP, or GIF images are allowed.' };
  const ext = match[2].toLowerCase() === 'jpeg' ? 'jpg' : match[2].toLowerCase();
  const buf = Buffer.from(match[3], 'base64');
  if (buf.length > 5 * 1024 * 1024) {
    return { error: 'Image exceeds the 5 MB size limit.' };
  }
  const filename = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(uploadsDir, filename), buf);
  return { url: `/uploads/${filename}` };
}

function generateBotReply(userId, promptText) {
  const q = promptText.toLowerCase();
  const today = getTodayDate();
  const caller = db.prepare('SELECT * FROM employees WHERE id = ?').get(Number(userId));
  const isPrivileged = caller && (caller.role === 'admin' || caller.role === 'manager');

  const emps = db.prepare(`
    SELECT e.*, a.clock_in, a.clock_out, COALESCE(a.status, 'absent') as att_status,
      COALESCE(a.active_seconds, 0) as active_seconds, COALESCE(a.idle_seconds, 0) as idle_seconds,
      COALESCE(a.break_seconds, 0) as break_seconds
    FROM employees e
    LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = ?
    ${isPrivileged ? 'WHERE e.is_active = 1' : 'WHERE e.id = ?'}
  `).all(...(isPrivileged ? [today] : [today, Number(userId)]));
  const me = emps.find((e) => e.id === Number(userId)) || caller;

  if (q.includes('motivate') || q.includes('encourage') || q === 'hello' || q === 'hi') {
    const myPending = db.prepare(`SELECT COUNT(*) as cnt FROM tasks WHERE assignee_id = ? AND status != 'completed'`).get(Number(userId)).cnt;
    const activeHrs = ((me?.active_seconds || 0) / 3600).toFixed(1);
    const s = getSettings();
    const now = new Date();
    const [eh, em] = (me?.shift_end || s.shiftEnd).split(':').map(Number);
    const afterShiftEnd = now.getHours() * 60 + now.getMinutes() > eh * 60 + em;
    if (afterShiftEnd) {
      return `Great effort today, ${me?.name || 'teammate'}! You logged ${activeHrs}h of active focus (${myPending} pending task(s)). Shift over — remember to clock out!`;
    }
    return `You've got this, ${me?.name || 'teammate'}! You've already logged ${activeHrs}h of active focus today. Knock out your ${myPending} pending task(s) one step at a time — finish strong before ${me?.shift_end || s.shiftEnd}!`;
  }

  if (q.includes('live status') || q.includes('idle') || q.includes('active')) {
    if (!isPrivileged || q.includes('my live status')) {
      const stateLabel = (me?.status || 'offline').toUpperCase();
      const activeMin = Math.round((me?.active_seconds || 0) / 60);
      const idleMin = Math.round((me?.idle_seconds || 0) / 60);
      const breakMin = Math.round((me?.break_seconds || 0) / 60);
      return `Your Live Status (${today}):\n• Current State: ${stateLabel}\n• Active: ${activeMin}m | Idle: ${idleMin}m | Break: ${breakMin}m`;
    }
    const idleList = emps.filter((e) => e.status === 'idle').map((e) => e.name);
    const breakList = emps.filter((e) => e.status === 'break').map((e) => e.name);
    const activeList = emps.filter((e) => e.status === 'active').map((e) => e.name);
    return `Live Desk Status (${today}):\n• Active (${activeList.length}): ${activeList.join(', ') || 'None'}\n• Idle (${idleList.length}): ${idleList.join(', ') || 'None'}\n• On Break (${breakList.length}): ${breakList.join(', ') || 'None'}`;
  }

  if (q.includes('attendance') || q.includes('present') || q.includes('late') || q.includes('absent')) {
    if (!isPrivileged || q.includes("today's attendance")) {
      const clockInStr = me?.clock_in
        ? new Date(me.clock_in).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
        : 'Not clocked in';
      const arrival = me?.clock_in ? (me.att_status === 'late' ? 'Late' : 'On time') : (me?.att_status || 'absent').toUpperCase();
      const hrs = ((me?.active_seconds || 0) / 3600).toFixed(1);
      return `Today's Attendance (${today}):\n• Clock-in: ${clockInStr} (${arrival})\n• Hours so far: ${hrs}h active`;
    }
    const present = emps.filter((e) => e.att_status === 'present').length;
    const late = emps.filter((e) => e.att_status === 'late').map((e) => e.name);
    const absent = emps.filter((e) => e.att_status === 'absent').map((e) => e.name);
    return `Today's Attendance (${today}):\n• Present on time: ${present}\n• Late: ${late.length ? late.join(', ') : 'None'}\n• Absent/Not clocked in: ${absent.length ? absent.join(', ') : 'None'}`;
  }

  if (q.includes('timing') || q.includes('lunch') || q.includes('tea') || q.includes('shift') || q.includes('office') || q.includes('break')) {
    const s = getSettings();
    return `Zaviroq Office Policy:\n• Office Hours: ${s.shiftStart} – ${s.shiftEnd} (${s.lateGraceMinutes}m arrival grace)\n• Lunch Break: ${s.lunchBreak} (${s.lunchMinutes} mins)\n• Tea Break: ${s.teaMinutes} mins after ${s.teaBreakAfter}\n• Net Shift: ${s.netWorkHours}h active work`;
  }

  if (q.includes('pending') || q.includes('task') || q.includes('overdue')) {
    if (q.includes('leave')) {
      const pendingLeaves = db.prepare(`
        SELECT l.*, e.name FROM leaves l JOIN employees e ON e.id = l.employee_id
        WHERE l.status = 'pending' ${isPrivileged ? '' : 'AND l.employee_id = ?'}
      `).all(...(isPrivileged ? [] : [Number(userId)]));
      if (pendingLeaves.length === 0) return 'You have no pending leave requests right now.';
      return `Pending Leave Requests (${pendingLeaves.length}):\n` +
        pendingLeaves.map((l) => `• ${l.name}: ${l.leave_type} (${l.start_date} to ${l.end_date}, ${l.days}d) — ${l.reason}`).join('\n');
    }
    const totalTasks = db.prepare(
      `SELECT COUNT(*) as cnt FROM tasks ${isPrivileged ? '' : 'WHERE assignee_id = ?'}`
    ).get(...(isPrivileged ? [] : [Number(userId)])).cnt;
    if (totalTasks === 0) return 'You have no tasks assigned yet.';
    const pending = db.prepare(`
      SELECT t.title, t.priority, t.due_date, e.name as assignee
      FROM tasks t LEFT JOIN employees e ON e.id = t.assignee_id
      WHERE t.status != 'completed' ${isPrivileged ? '' : 'AND t.assignee_id = ?'}
      ORDER BY CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END, t.due_date ASC
      LIMIT 5
    `).all(...(isPrivileged ? [] : [Number(userId)]));
    if (pending.length === 0) return 'All your tasks are currently completed! Great job!';
    const lines = pending.map((t) => `• [${t.priority.toUpperCase()}] ${t.title} — ${t.assignee} (Due ${t.due_date})`);
    return `${isPrivileged ? 'Top Open/Pending Tasks' : 'Your Pending Tasks'} (${pending.length} shown):\n${lines.join('\n')}`;
  }

  if (q.includes('leave') || q.includes('holiday') || q.includes('off')) {
    const pendingLeaves = db.prepare(`
      SELECT l.*, e.name FROM leaves l JOIN employees e ON e.id = l.employee_id
      WHERE l.status = 'pending' ${isPrivileged ? '' : 'AND l.employee_id = ?'}
    `).all(...(isPrivileged ? [] : [Number(userId)]));
    if (pendingLeaves.length === 0) return 'You have no pending leave requests right now.';
    return `Pending Leave Requests (${pendingLeaves.length}):\n` +
      pendingLeaves.map((l) => `• ${l.name}: ${l.leave_type} (${l.start_date} to ${l.end_date}, ${l.days}d) — ${l.reason}`).join('\n');
  }

  if (q.includes('salary') || q.includes('payroll') || q.includes('pay')) {
    if (!isPrivileged) {
      return 'Salary & Payroll details are managed by Admin/HR. Please contact Aarav Mehta for payroll inquiries.';
    }
    const report = buildMonthlyReport(getCurrentMonth());
    const totalNet = report.rows.filter((r) => r.salary_set && r.salary).reduce((s, r) => s + r.salary.net_salary, 0);
    return `Payroll Snapshot (${report.month}):\n• Total Org Net Payroll: ₹${totalNet.toLocaleString('en-IN')}`;
  }

  return `Hi ${caller?.name?.split(' ')[0] || 'there'}! I'm Zavi, your Zaviroq Assistant. Ask me about:\n• "Show pending tasks"\n• "Today's attendance"\n• "Pending leaves"\n• "Office timings & breaks"`;
}

async function generateSmartBotReply(userId, promptText) {
  const localContext = generateBotReply(userId, promptText);
  const openAiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!openAiKey && !anthropicKey) return localContext;

  const caller = db.prepare('SELECT name, role, department, designation FROM employees WHERE id = ?').get(Number(userId));
  const systemPrompt = `You are Zavi, the friendly mascot coach for Zaviroq Workforce OS.
User: ${caller?.name || 'Employee'} (${caller?.designation || 'Team Member'}, role: ${caller?.role || 'employee'}).
Live Data Context from Database:
${localContext}
Reply warmly, concisely, and accurately based only on this data.`;

  try {
    if (openAiKey) {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: promptText }],
          max_tokens: 220,
        }),
      });
      if (r.ok) {
        const j = await r.json();
        const text = j.choices?.[0]?.message?.content?.trim();
        if (text) return text;
      }
    } else if (anthropicKey) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-latest',
          max_tokens: 220,
          system: systemPrompt,
          messages: [{ role: 'user', content: promptText }],
        }),
      });
      if (r.ok) {
        const j = await r.json();
        const text = j.content?.[0]?.text?.trim();
        if (text) return text;
      }
    }
  } catch { /* fallback */ }
  return localContext;
}

// Minimal chat contacts list (never includes pin, salary, or attendance)
app.get('/api/chat/contacts', (req, res) => {
  const contacts = db.prepare(`
    SELECT id, emp_code, name, designation, department, avatar_color, status, role
    FROM employees
    WHERE is_active = 1 AND id != ?
    ORDER BY id ASC
  `).all(req.user.id);
  res.json(contacts);
});

app.get('/api/chat/messages', (req, res) => {
  const userId = req.user.id;
  if (req.query.userId && Number(req.query.userId) !== userId) {
    return res.status(403).json({ error: 'Forbidden: cannot read another employee’s chat' });
  }
  const peerId = Number(req.query.peerId ?? 0);
  const after = Number(req.query.after || 0);
  const limit = Math.min(100, Number(req.query.limit || 50));

  if (peerId !== 0) {
    const peer = db.prepare('SELECT id FROM employees WHERE id = ? AND is_active = 1').get(peerId);
    if (!peer) {
      return res.status(404).json({ error: 'Recipient not found' });
    }
  }

  const rows = db.prepare(`
    SELECT m.*,
      CASE WHEN m.sender_id = 0 THEN 'Zaviroq Bot' ELSE se.name END as sender_name,
      CASE WHEN m.sender_id = 0 THEN '#6366f1' ELSE se.avatar_color END as sender_color
    FROM chat_messages m
    LEFT JOIN employees se ON se.id = m.sender_id
    WHERE ((m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?))
      AND m.id > ?
    ORDER BY m.id ASC
    LIMIT ?
  `).all(userId, peerId, peerId, userId, after, limit);
  res.json(rows);
});

app.post('/api/chat/messages', async (req, res) => {
  const senderId = req.user.id;
  const { recipient_id, message = '', image_data = '' } = req.body;
  if (recipient_id === undefined || (!message?.trim() && !image_data)) {
    return res.status(400).json({ error: 'recipient_id and message or image are required.' });
  }

  if (Number(recipient_id) !== 0) {
    const peer = db.prepare('SELECT id FROM employees WHERE id = ? AND is_active = 1').get(Number(recipient_id));
    if (!peer) {
      return res.status(404).json({ error: 'Recipient not found' });
    }
  }

  let savedImageUrl = '';
  if (image_data) {
    if (image_data.startsWith('data:image/')) {
      const saved = saveChatImageFile(image_data);
      if (saved.error) return res.status(400).json({ error: saved.error });
      savedImageUrl = saved.url;
    } else {
      return res.status(400).json({ error: 'Invalid image format.' });
    }
  }

  const nowIso = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO chat_messages (sender_id, recipient_id, message, image_data, is_bot, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(senderId, Number(recipient_id), message.trim(), savedImageUrl, nowIso);

  const userMsg = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(info.lastInsertRowid);
  let botMsg = null;

  if (Number(recipient_id) === 0) {
    const reply = await generateSmartBotReply(senderId, message || 'Image shared');
    const botInfo = db.prepare(`
      INSERT INTO chat_messages (sender_id, recipient_id, message, is_bot, created_at)
      VALUES (0, ?, ?, 1, ?)
    `).run(senderId, reply, new Date(Date.now() + 50).toISOString());
    botMsg = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(botInfo.lastInsertRowid);
  }

  res.status(201).json({ userMsg, botMsg });
});

// Serve built frontend in production if dist/ exists
const distDir = path.resolve(__dirname, '../dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Run auto clock-out & stale offline maintenance every 60s even when no page is loaded
  setInterval(() => {
    try {
      runAttendanceMaintenance();
    } catch {
      // keep timer alive
    }
  }, 60 * 1000).unref();

  app.listen(PORT, () => {
    console.log(`Zaviroq API server running on http://localhost:${PORT}`);
  });
}
