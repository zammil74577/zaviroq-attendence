import express from 'express';
import crypto from 'node:crypto';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import {
  APP_TIMEZONE,
  ensureSchemaOnce,
  query,
  getOne,
  getAll,
  getTodayDateInTz,
  getCurrentMonthInTz,
  getLocalMinutesInTz,
  computeArrivalStatus,
  formatClockInReasonInTz,
  sanitizeEmployee,
  hashPin,
  verifyPin,
  getSettings,
  writeAuditLog,
  pgRateLimit,
} from './pg.js';
import {
  SESSION_COOKIE_NAME,
  requireAuth,
  requireRole,
  setSessionCookie,
  clearSessionCookie,
  revokeSessionToken,
} from './auth-pg.js';
import { uploadChatImage, signChatImageUrl } from './storage.js';
import { evaluateAlertRules } from './alerts.js';

export const app = express();

// Wrap Express 4 route methods so rejected async handlers always forward to Express error middleware (never hang)
for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
  const orig = app[method].bind(app);
  app[method] = (path, ...handlers) =>
    orig(
      path,
      ...handlers.map((fn) =>
        typeof fn === 'function' && fn.length < 4
          ? (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
          : fn
      )
    );
}

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(helmet({ contentSecurityPolicy: false }));

const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
  : (process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : true);
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '8mb' }));

// Per-request timeout guard (returns 503 JSON instead of hanging 60s)
app.use((_req, res, next) => {
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      res.status(503).json({ error: 'Request timed out. Please retry.' });
    }
  }, 9000);
  res.on('finish', () => clearTimeout(timer));
  res.on('close', () => clearTimeout(timer));
  next();
});

// Postgres-backed rate limits (zero in-memory state)
const apiLimiter = pgRateLimit('api', Number(process.env.RATE_LIMIT_MAX || 300), 60 * 1000);
const loginLimiter = pgRateLimit('login', Number(process.env.LOGIN_RATE_LIMIT_MAX || 30), 15 * 60 * 1000);

// ========================
// HELPERS
// ========================
export function validateStrongPin(pin) {
  const s = String(pin ?? '').trim();
  if (!/^\d{6}$/.test(s)) return 'PIN must be exactly 6 digits.';
  if (/^(\d)\1{5}$/.test(s)) return 'PIN cannot be all repeated digits.';
  const seqAsc = '01234567890123456789';
  const seqDesc = '98765432109876543210';
  if (seqAsc.includes(s) || seqDesc.includes(s) || s === '000000' || s === '123456') {
    return 'PIN cannot be a trivial or sequential pattern.';
  }
  return null;
}

export function generateRandomTempPin() {
  for (let i = 0; i < 30; i++) {
    const candidate = String(crypto.randomInt(100000, 1000000));
    if (!validateStrongPin(candidate)) return candidate;
  }
  return '849201';
}

async function countWorkingLeaveDays(startDate, endDate) {
  const settings = await getSettings();
  const weekendSet = new Set(settings.weekendDays || [0, 6]);
  const holidaysRows = await getAll('SELECT date::text as date FROM holidays');
  const holidays = new Set(holidaysRows.map((h) => h.date));
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  let count = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!weekendSet.has(d.getDay()) && !holidays.has(ds)) count += 1;
  }
  return count;
}

async function countMonthWorkingDays(month, upToDay = null) {
  const settings = await getSettings();
  const weekendSet = new Set(settings.weekendDays || [0, 6]);
  const holidaysRows = await getAll(`SELECT date::text as date FROM holidays WHERE to_char(date, 'YYYY-MM') = $1`, [month]);
  const holidays = new Set(holidaysRows.map((h) => h.date));
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const limit = upToDay ? Math.min(upToDay, daysInMonth) : daysInMonth;
  let count = 0;
  for (let day = 1; day <= limit; day++) {
    const d = new Date(y, m - 1, day);
    const ds = `${month}-${String(day).padStart(2, '0')}`;
    if (!weekendSet.has(d.getDay()) && !holidays.has(ds)) count += 1;
  }
  return Math.max(1, count);
}

function isTaskOverdue(task, today, shiftEnd = '17:30') {
  if (task.status === 'completed') return false;
  const dueStr = typeof task.due_date === 'string' ? task.due_date.slice(0, 10) : new Date(task.due_date).toISOString().slice(0, 10);
  if (dueStr < today) return true;
  if (dueStr === today) {
    const nowMins = getLocalMinutesInTz(new Date(), APP_TIMEZONE);
    const [eh, em] = shiftEnd.split(':').map(Number);
    return nowMins > eh * 60 + em;
  }
  return false;
}

async function isPayrollLocked(month) {
  const row = await getOne('SELECT month FROM payroll_locks WHERE month = $1', [month]);
  return Boolean(row);
}

function csvEscape(val) {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function recalculateAttendanceLateStatuses(actor = { id: null, name: 'System' }) {
  const settings = await getSettings();
  const rows = await getAll(`
    SELECT a.id, a.employee_id, a.date::text as date, a.clock_in, a.status, e.shift_start
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    WHERE a.manual_override = FALSE
      AND a.clock_in IS NOT NULL
      AND a.status IN ('present', 'late')
  `);
  const details = [];
  for (const row of rows) {
    const month = row.date.slice(0, 7);
    if (await isPayrollLocked(month)) continue;
    const expected = computeArrivalStatus(row.shift_start || settings.shiftStart, new Date(row.clock_in), settings.lateGraceMinutes);
    if (expected !== row.status) {
      await query(`UPDATE attendance SET status = $1, updated_at = NOW() WHERE id = $2`, [expected, row.id]);
      details.push({ employee_id: row.employee_id, date: row.date, from: row.status, to: expected });
    }
  }
  if (details.length > 0) {
    await writeAuditLog({
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

export async function runAutoClockOutJob() {
  const settings = await getSettings();
  const today = getTodayDateInTz();
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - 3 * 60 * 1000).toISOString();

  await query(`
    UPDATE employees
    SET status = 'offline'
    WHERE status != 'offline' AND last_heartbeat_at IS NOT NULL AND last_heartbeat_at < $1::timestamptz
  `, [staleCutoff]);

  const priorOpen = await getAll(`
    SELECT a.id, a.employee_id, a.date::text as date, e.shift_end
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    WHERE a.date < $1::date AND a.clock_in IS NOT NULL AND a.clock_out IS NULL
  `, [today]);

  for (const row of priorOpen) {
    const autoOut = `${row.date}T${row.shift_end || settings.shiftEnd}:00+05:30`;
    await query(`UPDATE attendance SET clock_out = $1::timestamptz, missed_clock_out = TRUE, updated_at = NOW() WHERE id = $2`, [autoOut, row.id]);
    await query(`UPDATE employees SET status = 'offline', last_heartbeat_at = NULL, last_heartbeat_state = NULL WHERE id = $1`, [row.employee_id]);
  }

  const bufferMins = settings.autoClockOutBufferMinutes || 120;
  const nowTotalMins = getLocalMinutesInTz(now, APP_TIMEZONE);
  const todayOpen = await getAll(`
    SELECT a.id, a.employee_id, a.notes, e.shift_end, e.last_heartbeat_at
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    WHERE a.date = $1::date AND a.clock_in IS NOT NULL AND a.clock_out IS NULL
  `, [today]);

  for (const row of todayOpen) {
    const isAfterHours = String(row.notes || '').includes('After-hours');
    if (isAfterHours) {
      const lastHb = row.last_heartbeat_at ? new Date(row.last_heartbeat_at).getTime() : 0;
      if (lastHb > 0 && now.getTime() - lastHb > 120 * 60 * 1000) {
        await query(`UPDATE attendance SET clock_out = NOW(), missed_clock_out = TRUE, updated_at = NOW() WHERE id = $1`, [row.id]);
        await query(`UPDATE employees SET status = 'offline', last_heartbeat_at = NULL, last_heartbeat_state = NULL WHERE id = $1`, [row.employee_id]);
      }
      continue;
    }
    const [eh, em] = (row.shift_end || settings.shiftEnd).split(':').map(Number);
    if (nowTotalMins > eh * 60 + em + bufferMins) {
      await query(`UPDATE attendance SET clock_out = NOW(), missed_clock_out = TRUE, updated_at = NOW() WHERE id = $1`, [row.id]);
      await query(`UPDATE employees SET status = 'offline', last_heartbeat_at = NULL, last_heartbeat_state = NULL WHERE id = $1`, [row.employee_id]);
    }
  }

  const pgAlertAdapter = {
    getSettings,
    getRules: () => getAll(`SELECT * FROM alert_rules ORDER BY id ASC`),
    isHoliday: async (date) => Boolean(await getOne(`SELECT 1 FROM holidays WHERE date = $1::date`, [date])),
    getEmployeesWithAttendance: (date) =>
      getAll(
        `SELECT e.id, e.emp_code, e.name, e.email, e.department, e.role, e.shift_start, e.shift_end, e.status, e.last_heartbeat_at,
          a.clock_in, a.clock_out, COALESCE(a.status, 'absent') as att_status, COALESCE(a.idle_seconds, 0) as idle_seconds, COALESCE(a.break_seconds, 0) as break_seconds
         FROM employees e LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = $1::date WHERE e.is_active = TRUE`,
        [date]
      ),
    getApprovedLeaveEmployeeIds: async (date) => {
      const rows = await getAll(`SELECT employee_id FROM leaves WHERE status = 'approved' AND start_date <= $1::date AND end_date >= $1::date`, [date]);
      return rows.map((r) => r.employee_id);
    },
    getPrivilegedRecipients: () => getAll(`SELECT id, name, email, role, department FROM employees WHERE is_active = TRUE AND role IN ('admin', 'manager')`),
    getActiveEpisode: (ruleType, episodeKey) => getOne(`SELECT id FROM alert_episodes WHERE rule_type = $1 AND episode_key = $2 AND active = TRUE LIMIT 1`, [ruleType, episodeKey]),
    openEpisode: ({ employeeId, ruleType, episodeKey, nowIso }) =>
      query(`INSERT INTO alert_episodes (employee_id, rule_type, episode_key, active, triggered_at) VALUES ($1, $2, $3, TRUE, $4::timestamptz)`, [employeeId, ruleType, episodeKey, nowIso]),
    resolveEpisode: (id, nowIso) => query(`UPDATE alert_episodes SET active = FALSE, resolved_at = $1::timestamptz WHERE id = $2`, [nowIso, id]),
    insertNotification: ({ employeeId, type, title, message, link, nowIso }) =>
      query(`INSERT INTO notifications (employee_id, type, title, message, link, created_at) VALUES ($1, $2, $3, $4, $5, $6::timestamptz)`, [employeeId, type, title, message, link, nowIso]),
    getPushSubscriptions: (empIds) => getAll(`SELECT * FROM push_subscriptions WHERE employee_id = ANY($1::int[])`, [empIds]),
    deletePushSubscription: (endpoint) => query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]),
    writeAudit: ({ action, entityType, entityId, newValue }) => writeAuditLog({ actorId: null, actorName: 'System', action, entityType, entityId, newValue }),
  };

  try {
    await evaluateAlertRules(pgAlertAdapter, { now, timeZone: APP_TIMEZONE });
  } catch (err) {
    console.error('[evaluateAlertRules]', err?.message || err);
  }
}

// ========================
// PUBLIC HEALTH & VERCEL CRON
// ========================
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString(), date: getTodayDateInTz() });
});

app.get('/api/healthz', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, db: 'ok', timezone: APP_TIMEZONE });
  } catch (err) {
    res.status(503).json({ ok: false, db: 'error', message: err.message });
  }
});

function verifyCronSecret(req, res, next) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  const headerSecret = req.headers['x-cron-secret'];
  if (!secret || (auth !== `Bearer ${secret}` && headerSecret !== secret)) {
    return res.status(401).json({ error: 'Unauthorized cron invocation' });
  }
  next();
}

app.get('/api/cron/auto-clockout', verifyCronSecret, async (_req, res) => {
  await runAutoClockOutJob();
  res.json({ ok: true, ranAt: new Date().toISOString() });
});

app.get('/api/cron/daily', verifyCronSecret, async (_req, res) => {
  const settings = await getSettings();
  const yesterday = new Date(Date.now() - 86400000);
  const yDate = getTodayDateInTz(yesterday);
  const weekendSet = new Set(settings.weekendDays || [0, 6]);
  const holiday = await getOne('SELECT id FROM holidays WHERE date = $1::date', [yDate]);
  const yDow = new Date(`${yDate}T00:00:00`).getDay();

  let markedAbsent = 0;
  if (!weekendSet.has(yDow) && !holiday) {
    const emps = await getAll('SELECT id FROM employees WHERE is_active = TRUE');
    for (const emp of emps) {
      const att = await getOne('SELECT id FROM attendance WHERE employee_id = $1 AND date = $2::date', [emp.id, yDate]);
      if (!att) {
        await query(
          `INSERT INTO attendance (employee_id, date, status, notes) VALUES ($1, $2::date, 'absent', 'Auto-marked absent by daily cron') ON CONFLICT (employee_id, date) DO NOTHING`,
          [emp.id, yDate]
        );
        markedAbsent += 1;
      }
    }
  }
  res.json({ ok: true, date: yDate, markedAbsent });
});

// ========================
// PUBLIC AUTH
// ========================
app.use('/api', apiLimiter);

app.get('/api/auth/config', async (_req, res) => {
  const demoMode = process.env.DEMO_MODE === 'true';
  if (!demoMode) return res.json({ demoMode: false });
  const badges = await getAll('SELECT emp_code, name, role FROM employees WHERE is_active = TRUE ORDER BY id ASC LIMIT 2');
  res.json({ demoMode: true, demoBadges: badges });
});

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { identifier, pin, scanEntry = false } = req.body;
  if (!identifier?.trim() || !pin?.trim()) {
    return res.status(400).json({ error: 'Employee ID/Email and PIN are required.' });
  }
  const key = identifier.trim().toLowerCase();
  const emp = await getOne(
    `SELECT * FROM employees WHERE (LOWER(emp_code) = $1 OR LOWER(email) = $1) AND is_active = TRUE`,
    [key]
  );

  if (!emp) {
    return res.status(401).json({ error: 'Invalid Employee ID/Email or PIN.' });
  }

  if (emp.locked_until && Date.now() < new Date(emp.locked_until).getTime()) {
    const minsLeft = Math.ceil((new Date(emp.locked_until).getTime() - Date.now()) / 60000);
    return res.status(429).json({
      error: `Account locked due to too many failed attempts. Try again in ${minsLeft} minute(s).`,
    });
  }

  if (!verifyPin(pin.trim(), emp.pin)) {
    const nextAttempts = (emp.failed_login_attempts || 0) + 1;
    if (nextAttempts >= 5) {
      const lockUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      await query(`UPDATE employees SET failed_login_attempts = $1, locked_until = $2::timestamptz WHERE id = $3`, [nextAttempts, lockUntil, emp.id]);
      return res.status(429).json({ error: 'Too many failed login attempts. Account locked for 15 minutes.' });
    }
    await query(`UPDATE employees SET failed_login_attempts = $1 WHERE id = $2`, [nextAttempts, emp.id]);
    return res.status(401).json({ error: `Invalid Employee ID/Email or PIN. (${5 - nextAttempts} attempt(s) remaining)` });
  }

  await query(`UPDATE employees SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1`, [emp.id]);

  if (scanEntry) {
    const today = getTodayDateInTz();
    const existing = await getOne(`SELECT * FROM attendance WHERE employee_id = $1 AND date = $2::date`, [emp.id, today]);
    if (!existing) {
      const settings = await getSettings();
      const nowObj = new Date();
      const arrivalStatus = computeArrivalStatus(emp.shift_start, nowObj, settings.lateGraceMinutes);
      const clockReason = formatClockInReasonInTz(emp.shift_start, emp.shift_end, settings.autoClockOutBufferMinutes, nowObj, settings.lateGraceMinutes);
      await query(
        `INSERT INTO attendance (employee_id, date, clock_in, status, notes) VALUES ($1, $2::date, NOW(), $3, $4)`,
        [emp.id, today, arrivalStatus, clockReason]
      );
      await query(
        `UPDATE employees SET status = 'active', last_seen_at = NOW(), last_heartbeat_at = NOW(), last_heartbeat_state = 'active' WHERE id = $1`,
        [emp.id]
      );
      await query(
        `INSERT INTO activity_logs (employee_id, date, type, reason, timestamp) VALUES ($1, $2::date, 'clock_in', $3, NOW())`,
        [emp.id, today, clockReason]
      );
    }
  }

  await setSessionCookie(res, emp.id);
  res.json({ employee: sanitizeEmployee(emp) });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ employee: req.user });
});

app.post('/api/auth/change-pin', requireAuth, async (req, res) => {
  const err = validateStrongPin(req.body.newPin);
  if (err) return res.status(400).json({ error: err });
  await query(`UPDATE employees SET pin = $1, must_change_pin = FALSE WHERE id = $2`, [hashPin(String(req.body.newPin).trim()), req.user.id]);
  await writeAuditLog({ actorId: req.user.id, actorName: req.user.name, action: 'CHANGE_PIN', entityType: 'employee', entityId: req.user.id, newValue: { changed: true } });
  const updated = await getOne('SELECT * FROM employees WHERE id = $1', [req.user.id]);
  res.json({ ok: true, employee: sanitizeEmployee(updated) });
});

app.post('/api/auth/consent', requireAuth, async (req, res) => {
  await query(`UPDATE employees SET tracking_consent_at = NOW() WHERE id = $1`, [req.user.id]);
  await writeAuditLog({ actorId: req.user.id, actorName: req.user.name, action: 'ACCEPT_TRACKING_CONSENT', entityType: 'employee', entityId: req.user.id, newValue: { accepted: true } });
  const updated = await getOne('SELECT * FROM employees WHERE id = $1', [req.user.id]);
  res.json({ ok: true, employee: sanitizeEmployee(updated) });
});

app.post('/api/auth/logout', async (req, res) => {
  await revokeSessionToken(req.cookies?.[SESSION_COOKIE_NAME]);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ========================
// PROTECTED ROUTES
// ========================
app.use('/api', requireAuth);

app.get('/api/dashboard', async (req, res) => {
  const date = req.query.date || getTodayDateInTz();
  const isPrivileged = req.user.role === 'admin' || req.user.role === 'manager';
  const includeInactive = isPrivileged && req.query.includeInactive === 'true';

  const [settings, rawEmployees, rawTasks, logs, announcements] = await Promise.all([
    getSettings(),
    getAll(
      `SELECT e.id, e.emp_code, e.name, e.email, e.role, e.department, e.designation,
        e.shift_start, e.shift_end, e.status, e.avatar_color, e.joining_date::text as joining_date,
        e.is_active, e.tracking_consent_at,
        e.last_seen_at, e.last_heartbeat_at, e.last_heartbeat_state, e.created_at,
        a.id as attendance_id, a.clock_in, a.clock_out,
        COALESCE(a.status, 'absent') as attendance_status,
        COALESCE(a.active_seconds, 0) as active_seconds,
        COALESCE(a.idle_seconds, 0) as idle_seconds,
        COALESCE(a.break_seconds, 0) as break_seconds,
        COALESCE(a.overtime_seconds, 0) as overtime_seconds,
        COALESCE(a.missed_clock_out, FALSE) as missed_clock_out,
        COALESCE(a.tracking_mode, 'tab_only') as tracking_mode,
        COALESCE(a.notes, '') as attendance_notes
      FROM employees e
      LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = $1::date
      WHERE ${includeInactive ? '1=1' : 'e.is_active = TRUE'} ${isPrivileged ? '' : 'AND e.id = $2'}
      ORDER BY e.id ASC`,
      isPrivileged ? [date] : [date, req.user.id]
    ),
    getAll(
      `SELECT t.*, t.due_date::text as due_date,
        e.name as assignee_name, e.emp_code as assignee_code, e.avatar_color as assignee_color, e.status as assignee_live_status
      FROM tasks t
      LEFT JOIN employees e ON e.id = t.assignee_id
      ${isPrivileged ? '' : 'WHERE t.assignee_id = $1'}
      ORDER BY CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, t.due_date ASC, t.id DESC`,
      isPrivileged ? [] : [req.user.id]
    ),
    getAll(
      `SELECT l.*, l.date::text as date, e.name as employee_name, e.emp_code
       FROM activity_logs l
       JOIN employees e ON e.id = l.employee_id
       WHERE l.date = $1::date ${isPrivileged ? '' : 'AND l.employee_id = $2'}
       ORDER BY l.id DESC LIMIT 40`,
      isPrivileged ? [date] : [date, req.user.id]
    ),
    getAll(
      `SELECT an.*, e.name as author_name FROM announcements an LEFT JOIN employees e ON e.id = an.author_id ORDER BY an.id DESC LIMIT 10`
    ),
  ]);

  const breakLimitSec = settings.totalBreakMinutes * 60;
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

  const today = getTodayDateInTz();
  const tasks = rawTasks.map((t) => ({ ...t, is_overdue: isTaskOverdue(t, today, settings.shiftEnd) }));

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

app.post('/api/employees', requireRole('admin', 'manager'), async (req, res) => {
  const settings = await getSettings();
  const { name, email, role = 'employee', department, designation, shift_start = settings.shiftStart, shift_end = settings.shiftEnd, joining_date } = req.body;
  if (!name?.trim() || !email?.trim() || !department?.trim() || !designation?.trim()) {
    return res.status(400).json({ error: 'Name, email, department, and designation are required.' });
  }
  const palette = ['#6366f1', '#06b6d4', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444'];
  const maxRow = await getOne('SELECT COALESCE(MAX(id), 0) as max_id FROM employees');
  const nextNum = Number(maxRow.max_id) + 1;
  const emp_code = `ZAV-${String(nextNum).padStart(3, '0')}`;
  const avatar_color = palette[nextNum % palette.length];
  const safeJoiningDate = joining_date || getTodayDateInTz();
  const tempPin = generateRandomTempPin();

  try {
    const created = await getOne(
      `INSERT INTO employees (emp_code, name, email, role, department, designation, shift_start, shift_end, status, avatar_color, joining_date, pin, must_change_pin)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'offline', $9, $10::date, $11, TRUE)
       RETURNING *`,
      [emp_code, name.trim(), email.trim().toLowerCase(), role, department.trim(), designation.trim(), shift_start || settings.shiftStart, shift_end || settings.shiftEnd, avatar_color, safeJoiningDate, hashPin(tempPin)]
    );
    await query(`INSERT INTO leave_balances (employee_id) VALUES ($1) ON CONFLICT (employee_id) DO NOTHING`, [created.id]);
    await writeAuditLog({ actorId: req.user.id, actorName: req.user.name, action: 'CREATE_EMPLOYEE', entityType: 'employee', entityId: created.id, newValue: { emp_code, name: created.name } });
    res.status(201).json({ ...sanitizeEmployee(created), tempPin });
  } catch {
    res.status(409).json({ error: 'Employee email already exists.' });
  }
});

app.patch('/api/employees/:id', requireRole('admin', 'manager'), async (req, res) => {
  const { id } = req.params;
  const existing = await getOne('SELECT * FROM employees WHERE id = $1', [id]);
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

  const nextActive = !(is_active === false || Number(is_active) === 0);
  if (!nextActive) {
    if (Number(id) === req.user.id) return res.status(400).json({ error: 'You cannot deactivate your own account.' });
    if (existing.role === 'admin') {
      const cntRow = await getOne(`SELECT COUNT(*)::int as cnt FROM employees WHERE role = 'admin' AND is_active = TRUE`);
      if (cntRow.cnt <= 1) return res.status(400).json({ error: 'Cannot deactivate the last active admin.' });
    }
  }

  const updated = await getOne(
    `UPDATE employees
     SET name = $1, department = $2, designation = $3, role = $4, shift_start = $5, shift_end = $6,
         joining_date = COALESCE($7::date, joining_date), is_active = $8,
         status = CASE WHEN $8 = FALSE THEN 'offline' ELSE status END,
         last_heartbeat_at = CASE WHEN $8 = FALSE THEN NULL ELSE last_heartbeat_at END,
         last_heartbeat_state = CASE WHEN $8 = FALSE THEN NULL ELSE last_heartbeat_state END,
         active_session_id = CASE WHEN $8 = FALSE THEN NULL ELSE active_session_id END
     WHERE id = $9 RETURNING *`,
    [name.trim(), department.trim(), designation.trim(), role, shift_start, shift_end, joining_date || null, nextActive, id]
  );

  if (!nextActive) {
    // Auto clock-out any open attendance, revoke sessions, and stop heartbeats
    const openAtts = await getAll(
      `SELECT id, date::text as date, active_seconds FROM attendance WHERE employee_id = $1 AND clock_in IS NOT NULL AND clock_out IS NULL`,
      [id]
    );
    for (const att of openAtts) {
      await query(
        `UPDATE attendance SET clock_out = NOW(), notes = CASE WHEN notes != '' THEN notes || ' | Deactivated' ELSE 'Deactivated' END, updated_at = NOW() WHERE id = $1`,
        [att.id]
      );
      await query(
        `INSERT INTO activity_logs (employee_id, date, type, duration_seconds, reason, timestamp) VALUES ($1, $2::date, 'clock_out', $3, 'Deactivated', NOW())`,
        [id, att.date, att.active_seconds || 0]
      );
    }
    await query(`DELETE FROM sessions WHERE employee_id = $1`, [id]);
  }

  const actionName = !nextActive
    ? 'DEACTIVATE_EMPLOYEE'
    : (!existing.is_active && nextActive ? 'REACTIVATE_EMPLOYEE' : 'EDIT_EMPLOYEE');

  await writeAuditLog({
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

app.post('/api/employees/:id/reset-pin', requireRole('admin', 'manager'), async (req, res) => {
  const pinErr = validateStrongPin(req.body.newPin);
  if (pinErr) return res.status(400).json({ error: pinErr });
  const existing = await getOne('SELECT id FROM employees WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Employee not found' });
  await query(`UPDATE employees SET pin = $1, must_change_pin = FALSE, failed_login_attempts = 0, locked_until = NULL WHERE id = $2`, [hashPin(String(req.body.newPin).trim()), req.params.id]);
  await writeAuditLog({ actorId: req.user.id, actorName: req.user.name, action: 'RESET_PIN', entityType: 'employee', entityId: req.params.id, newValue: { reset: true } });
  res.json({ ok: true });
});

// ========================
// ATTENDANCE & HEARTBEAT
// ========================
app.post('/api/attendance/clock-in', async (req, res) => {
  const isPrivileged = req.user.role === 'admin' || req.user.role === 'manager';
  const targetId = isPrivileged && req.body.employeeId ? Number(req.body.employeeId) : req.user.id;
  const { notes = '', trackingMode = 'tab_only' } = req.body;
  const safeTrackingMode = trackingMode === 'app_system' ? 'app_system' : trackingMode === 'system' ? 'system' : 'tab_only';

  const emp = await getOne('SELECT * FROM employees WHERE id = $1 AND is_active = TRUE', [targetId]);
  if (!emp) return res.status(404).json({ error: 'Employee not found' });

  const today = getTodayDateInTz();
  const nowObj = new Date();
  const existing = await getOne('SELECT * FROM attendance WHERE employee_id = $1 AND date = $2::date', [targetId, today]);

  if (existing && existing.clock_in) {
    const isOpen = !existing.clock_out;
    const within10s = nowObj.getTime() - new Date(existing.clock_in).getTime() <= 10000;
    if (isOpen || within10s) {
      return res.json({ ok: true, idempotent: true, status: 'active', clock_in: existing.clock_in, attendance: existing });
    }
  }

  const settings = await getSettings();
  const effShiftStart = emp.shift_start || settings.shiftStart;
  const effShiftEnd = emp.shift_end || settings.shiftEnd;
  const [eh, em] = effShiftEnd.split(':').map(Number);
  const bufferMins = settings.autoClockOutBufferMinutes || 120;
  const cutoffMins = eh * 60 + em + bufferMins;
  const nowTotalMins = getLocalMinutesInTz(nowObj, APP_TIMEZONE);
  let isAfterHours = false;
  if (nowTotalMins > cutoffMins) {
    if ((settings.afterHoursClockInMode || 'block') === 'block') {
      const ch = String(Math.floor(cutoffMins / 60) % 24).padStart(2, '0');
      const cm = String(cutoffMins % 60).padStart(2, '0');
      return res.status(400).json({ error: `Shift ended — clock-in not allowed after ${ch}:${cm}. Contact admin.` });
    }
    isAfterHours = true;
  }

  const clockReason = isAfterHours
    ? 'After-hours / overtime session'
    : (notes || formatClockInReasonInTz(effShiftStart, effShiftEnd, bufferMins, nowObj, settings.lateGraceMinutes));

  if (existing && existing.clock_out) {
    await query(`UPDATE attendance SET clock_out = NULL, missed_clock_out = FALSE, tracking_mode = $1, notes = $2, updated_at = NOW() WHERE id = $3`, [safeTrackingMode, clockReason, existing.id]);
  } else {
    const arrivalStatus = computeArrivalStatus(effShiftStart, nowObj, settings.lateGraceMinutes);
    await query(
      `INSERT INTO attendance (employee_id, date, clock_in, status, tracking_mode, notes) VALUES ($1, $2::date, NOW(), $3, $4, $5)`,
      [targetId, today, arrivalStatus, safeTrackingMode, clockReason]
    );
  }

  await query(`UPDATE employees SET status = 'active', last_seen_at = NOW(), last_heartbeat_at = NOW(), last_heartbeat_state = 'active' WHERE id = $1`, [targetId]);
  await query(`INSERT INTO activity_logs (employee_id, date, type, reason, timestamp) VALUES ($1, $2::date, 'clock_in', $3, NOW())`, [targetId, today, clockReason]);

  res.json({ ok: true, status: 'active', clock_in: nowObj.toISOString() });
});

app.post('/api/attendance/clock-out', async (req, res) => {
  const isPrivileged = req.user.role === 'admin' || req.user.role === 'manager';
  const targetId = isPrivileged && req.body.employeeId ? Number(req.body.employeeId) : req.user.id;
  const { notes = '' } = req.body;
  const today = getTodayDateInTz();

  const existing = await getOne('SELECT * FROM attendance WHERE employee_id = $1 AND date = $2::date', [targetId, today]);
  if (!existing || !existing.clock_in) {
    return res.status(400).json({ error: 'Cannot clock out before clocking in.' });
  }

  const settings = await getSettings();
  const overtime = Math.max(0, (existing.active_seconds || 0) - settings.netWorkHours * 3600);
  await query(
    `UPDATE attendance SET clock_out = NOW(), overtime_seconds = $1, missed_clock_out = FALSE, notes = CASE WHEN $2 != '' THEN $2 ELSE notes END, updated_at = NOW() WHERE id = $3`,
    [overtime, notes, existing.id]
  );
  await query(`UPDATE employees SET status = 'offline', last_seen_at = NOW(), last_heartbeat_at = NULL, last_heartbeat_state = NULL, active_session_id = NULL WHERE id = $1`, [targetId]);
  await query(`INSERT INTO activity_logs (employee_id, date, type, duration_seconds, reason, timestamp) VALUES ($1, $2::date, 'clock_out', $3, $4, NOW())`, [targetId, today, existing.active_seconds || 0, notes || 'Shift clocked out']);

  res.json({ ok: true, status: 'offline', clock_out: new Date().toISOString() });
});

app.post('/api/activity/heartbeat', async (req, res) => {
  const { state, reason = '', sessionId = '', claimSession = false, trackingMode } = req.body;
  if (!['active', 'idle', 'break'].includes(state)) {
    return res.status(400).json({ error: 'Valid state (active|idle|break) required' });
  }

  const employeeId = req.user.id;
  const emp = await getOne('SELECT * FROM employees WHERE id = $1 AND is_active = TRUE', [employeeId]);
  if (!emp) return res.status(404).json({ error: 'Employee not found' });

  const today = getTodayDateInTz();
  const now = new Date();
  const att = await getOne('SELECT * FROM attendance WHERE employee_id = $1 AND date = $2::date', [employeeId, today]);
  if (!att || !att.clock_in || att.clock_out) {
    return res.json({ ok: true, ignored: true, reason: 'Employee not currently clocked in' });
  }

  if (sessionId && emp.active_session_id && emp.active_session_id !== sessionId && !claimSession) {
    const lastHbMs = emp.last_heartbeat_at ? new Date(emp.last_heartbeat_at).getTime() : 0;
    if (now.getTime() - lastHbMs < 90000) {
      return res.json({ ok: true, pausedByOtherTab: true, attendance: att });
    }
  }

  let elapsedSeconds = 0;
  if (emp.last_heartbeat_at) {
    const diffMs = now.getTime() - new Date(emp.last_heartbeat_at).getTime();
    elapsedSeconds = Math.max(0, Math.min(65, Math.round(diffMs / 1000)));
  }

  const prevState = ['active', 'idle', 'break'].includes(emp.last_heartbeat_state)
    ? emp.last_heartbeat_state
    : (['active', 'idle', 'break'].includes(emp.status) ? emp.status : 'active');
  const col = prevState === 'active' ? 'active_seconds' : prevState === 'idle' ? 'idle_seconds' : 'break_seconds';
  const settings = await getSettings();
  const netShiftSec = settings.netWorkHours * 3600;
  const safeTrackingMode =
    trackingMode === 'app_system' || trackingMode === 'system' || trackingMode === 'tab_only'
      ? trackingMode
      : null;

  if (elapsedSeconds > 0 || safeTrackingMode) {
    await query(
      `UPDATE attendance
       SET ${col} = ${col} + $1,
           overtime_seconds = GREATEST(0, (active_seconds + $2) - $3),
           tracking_mode = COALESCE($4, tracking_mode),
           updated_at = NOW()
       WHERE id = $5`,
      [elapsedSeconds, col === 'active_seconds' ? elapsedSeconds : 0, netShiftSec, safeTrackingMode, att.id]
    );
  }

  if (emp.status !== state) {
    let logType = null;
    if (state === 'break') logType = 'break_start';
    else if (emp.status === 'break' && state === 'active') logType = 'break_end';
    else if (state === 'idle' && (att.idle_seconds || 0) >= 120) logType = 'idle_start';
    else if (emp.status === 'idle' && state === 'active' && (att.idle_seconds || 0) >= 120) logType = 'idle_end';

    if (logType) {
      const latestLog = await getOne(
        `SELECT id, timestamp FROM activity_logs WHERE employee_id = $1 AND date = $2::date AND type IN ('idle_start', 'idle_end', 'break_start', 'break_end') ORDER BY id DESC LIMIT 1`,
        [employeeId, today]
      );
      if (latestLog && now.getTime() - new Date(latestLog.timestamp).getTime() <= 10000) {
        await query(`UPDATE activity_logs SET type = $1, reason = $2, timestamp = NOW() WHERE id = $3`, [logType, reason || `Switched to ${state}`, latestLog.id]);
      } else {
        await query(`INSERT INTO activity_logs (employee_id, date, type, reason, timestamp) VALUES ($1, $2::date, $3, $4, NOW())`, [employeeId, today, logType, reason || `Switched to ${state}`]);
      }
    }
  }

  await query(
    `UPDATE employees SET status = $1, last_seen_at = NOW(), last_heartbeat_at = NOW(), last_heartbeat_state = $1, active_session_id = COALESCE(NULLIF($2, ''), active_session_id) WHERE id = $3`,
    [state, sessionId, employeeId]
  );

  const updatedAtt = await getOne('SELECT * FROM attendance WHERE id = $1', [att.id]);
  res.json({ ok: true, state, creditedState: prevState, creditedSeconds: elapsedSeconds, pausedByOtherTab: false, attendance: updatedAtt });
});

app.patch('/api/attendance/:employeeId', requireRole('admin', 'manager'), async (req, res) => {
  const { employeeId } = req.params;
  const { date = getTodayDateInTz(), status, notes, clock_in, clock_out } = req.body;
  const month = String(date).slice(0, 7);
  if (await isPayrollLocked(month)) {
    return res.status(409).json({ error: `Payroll is locked for ${month}.` });
  }
  const existing = await getOne('SELECT * FROM attendance WHERE employee_id = $1 AND date = $2::date', [employeeId, date]);
  if (existing) {
    await query(
      `UPDATE attendance SET status = COALESCE($1, status), notes = COALESCE($2, notes),
       clock_in = CASE WHEN $3::boolean THEN $4::timestamptz ELSE clock_in END,
       clock_out = CASE WHEN $5::boolean THEN $6::timestamptz ELSE clock_out END,
       missed_clock_out = FALSE, manual_override = TRUE, updated_at = NOW() WHERE id = $7`,
      [status ?? null, notes ?? null, clock_in !== undefined, clock_in || null, clock_out !== undefined, clock_out || null, existing.id]
    );
  } else {
    await query(
      `INSERT INTO attendance (employee_id, date, status, clock_in, clock_out, notes, manual_override) VALUES ($1, $2::date, $3, $4::timestamptz, $5::timestamptz, $6, TRUE)`,
      [employeeId, date, status || 'present', clock_in || null, clock_out || null, notes || '']
    );
  }
  await writeAuditLog({ actorId: req.user.id, actorName: req.user.name, action: 'OVERRIDE_ATTENDANCE', entityType: 'attendance', entityId: `${employeeId}:${date}`, oldValue: existing, newValue: { status, clock_in, clock_out, notes } });
  res.json({ ok: true });
});

// ========================
// LEAVES & HOLIDAYS
// ========================
app.get('/api/leaves', async (req, res) => {
  await ensureSchemaOnce();
  const isPrivileged = req.user.role === 'admin' || req.user.role === 'manager';
  const leaves = await getAll(
    `SELECT l.*, l.start_date::text as start_date, l.end_date::text as end_date,
      e.name as employee_name, e.emp_code, e.department, e.avatar_color, r.name as reviewer_name
     FROM leaves l
     JOIN employees e ON e.id = l.employee_id
     LEFT JOIN employees r ON r.id = l.reviewed_by
     ${isPrivileged ? '' : 'WHERE l.employee_id = $1'}
     ORDER BY l.id DESC`,
    isPrivileged ? [] : [req.user.id]
  );
  const settings = await getSettings();
  const currentYear = Number(getTodayDateInTz().slice(0, 4));
  const employees = await getAll(
    `SELECT e.id, e.emp_code, e.name, e.department,
       COALESCE(e.joining_date::text, (e.created_at AT TIME ZONE '${APP_TIMEZONE}')::date::text) as joining_date,
       COALESCE(lb.casual_total, 12) as casual_total, COALESCE(lb.sick_total, 8) as sick_total, COALESCE(lb.earned_total, 15) as earned_total
     FROM employees e LEFT JOIN leave_balances lb ON lb.employee_id = e.id
     WHERE e.is_active = TRUE ${isPrivileged ? '' : 'AND e.id = $1'} ORDER BY e.id ASC`,
    isPrivileged ? [] : [req.user.id]
  );
  const approved = await getAll(`SELECT employee_id, leave_type, SUM(days)::float as used FROM leaves WHERE status = 'approved' GROUP BY employee_id, leave_type`);
  const balances = employees.map((emp) => {
    const getUsed = (t) => approved.find((a) => a.employee_id === emp.id && a.leave_type === t)?.used || 0;
    let earnedTotal = Number(emp.earned_total);
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
      casual_total: emp.casual_total,
      casual_used: getUsed('casual'),
      sick_total: emp.sick_total,
      sick_used: getUsed('sick'),
      earned_total: earnedTotal,
      earned_used: getUsed('earned'),
      unpaid_used: getUsed('unpaid'),
    };
  });
  res.json({ leaves, balances });
});

app.post('/api/leaves', async (req, res) => {
  const isPrivileged = req.user.role === 'admin' || req.user.role === 'manager';
  const targetEmployeeId = isPrivileged && req.body.employee_id ? Number(req.body.employee_id) : req.user.id;
  const { leave_type = 'casual', start_date, end_date, reason = '' } = req.body;
  if (!start_date || !end_date) return res.status(400).json({ error: 'start_date and end_date are required.' });
  const sDate = new Date(`${start_date}T00:00:00Z`);
  const eDate = new Date(`${end_date}T00:00:00Z`);
  if (Number.isNaN(sDate.getTime()) || Number.isNaN(eDate.getTime()) || eDate < sDate) {
    return res.status(400).json({ error: 'End date must be on or after start date.' });
  }
  const clockedConflict = await getOne(
    `SELECT date::text as date FROM attendance WHERE employee_id = $1 AND date >= $2::date AND date <= $3::date AND clock_in IS NOT NULL LIMIT 1`,
    [targetEmployeeId, start_date, end_date]
  );
  if (clockedConflict) {
    return res.status(400).json({ error: `Cannot apply leave for ${clockedConflict.date} — already clocked in.` });
  }
  const days = await countWorkingLeaveDays(start_date, end_date);
  if (days <= 0) return res.status(400).json({ error: 'Selected range contains only weekends or holidays.' });

  const created = await getOne(
    `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, days, reason, status) VALUES ($1, $2, $3::date, $4::date, $5, $6, 'pending') RETURNING *, start_date::text, end_date::text`,
    [targetEmployeeId, leave_type, start_date, end_date, days, reason.trim()]
  );
  res.status(201).json(created);
});

app.patch('/api/leaves/:id', requireRole('admin', 'manager'), async (req, res) => {
  const { id } = req.params;
  const { status, comment = '' } = req.body;
  if (!['approved', 'rejected', 'pending'].includes(status)) return res.status(400).json({ error: 'Invalid leave status' });
  const leave = await getOne('SELECT *, start_date::text as start_date, end_date::text as end_date FROM leaves WHERE id = $1', [id]);
  if (!leave) return res.status(404).json({ error: 'Leave request not found' });

  const updated = await getOne(
    `UPDATE leaves SET status = $1, reviewed_by = $2, reviewer_comment = $3, reviewed_at = NOW() WHERE id = $4 RETURNING *, start_date::text, end_date::text`,
    [status, req.user.id, comment, id]
  );

  if (status === 'approved') {
    const settings = await getSettings();
    const weekendSet = new Set(settings.weekendDays || [0, 6]);
    const holidays = new Set((await getAll('SELECT date::text as date FROM holidays')).map((h) => h.date));
    const start = new Date(`${leave.start_date}T00:00:00`);
    const end = new Date(`${leave.end_date}T00:00:00`);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (weekendSet.has(d.getDay()) || holidays.has(ds)) continue;
      await query(
        `INSERT INTO attendance (employee_id, date, status, notes) VALUES ($1, $2::date, 'on_leave', $3)
         ON CONFLICT (employee_id, date) DO UPDATE SET status = 'on_leave', notes = EXCLUDED.notes`,
        [leave.employee_id, ds, `Approved ${leave.leave_type} leave`]
      );
    }
  }
  await writeAuditLog({ actorId: req.user.id, actorName: req.user.name, action: `LEAVE_${status.toUpperCase()}`, entityType: 'leave', entityId: id, oldValue: { status: leave.status }, newValue: { status, comment } });
  res.json(updated);
});

app.get('/api/holidays', async (_req, res) => {
  res.json(await getAll('SELECT id, date::text as date, name FROM holidays ORDER BY date ASC'));
});

app.post('/api/holidays', requireRole('admin', 'manager'), async (req, res) => {
  const { date, name } = req.body;
  if (!date || !name?.trim()) return res.status(400).json({ error: 'Date and holiday name required.' });
  try {
    const row = await getOne(`INSERT INTO holidays (date, name) VALUES ($1::date, $2) RETURNING id, date::text as date, name`, [date, name.trim()]);
    await writeAuditLog({ actorId: req.user.id, actorName: req.user.name, action: 'ADD_HOLIDAY', entityType: 'holiday', entityId: date, newValue: { date, name } });
    res.status(201).json(row);
  } catch {
    res.status(409).json({ error: 'Holiday already exists for this date.' });
  }
});

app.delete('/api/holidays/:id', requireRole('admin', 'manager'), async (req, res) => {
  await query('DELETE FROM holidays WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ========================
// REPORTS & PAYROLL
// ========================
async function buildMonthlyReport(month) {
  await ensureSchemaOnce();
  const settings = await getSettings();
  const employees = await getAll(
    `SELECT *, joining_date::text as joining_date_str, (created_at AT TIME ZONE '${APP_TIMEZONE}')::date::text as created_date_str FROM employees WHERE is_active = TRUE ORDER BY id ASC`
  );
  const attRows = await getAll(`SELECT * FROM attendance WHERE to_char(date, 'YYYY-MM') = $1`, [month]);
  const taskRows = await getAll(`SELECT * FROM tasks WHERE to_char(due_date, 'YYYY-MM') = $1`, [month]);
  const salaries = await getAll('SELECT * FROM salaries');
  const approvedLeaves = await getAll(`SELECT * FROM leaves WHERE status = 'approved' AND to_char(start_date, 'YYYY-MM') = $1`, [month]);
  const holidayRows = await getAll(`SELECT date::text as date FROM holidays WHERE to_char(date, 'YYYY-MM') = $1`, [month]);

  const currentMonth = getCurrentMonthInTz();
  const todayDate = getTodayDateInTz();
  const todayDay = Number(todayDate.slice(8, 10));
  const totalWorkingDays = await countMonthWorkingDays(month);
  const elapsedWorkingDays = month === currentMonth ? await countMonthWorkingDays(month, todayDay) : (month < currentMonth ? totalWorkingDays : 0);
  const prorationRatio = Math.min(1, elapsedWorkingDays / Math.max(1, totalWorkingDays));
  const locked = await isPayrollLocked(month);
  const weekendSet = new Set(settings.weekendDays || [0, 6]);
  const holidaySet = new Set(holidayRows.map((h) => h.date));
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

    const totalActiveSeconds = empAtt.reduce((s, a) => s + Number(a.active_seconds || 0), 0);
    const totalIdleSeconds = empAtt.reduce((s, a) => s + Number(a.idle_seconds || 0), 0);
    const totalBreakSeconds = empAtt.reduce((s, a) => s + Number(a.break_seconds || 0), 0);
    const totalOvertimeSeconds = empAtt.reduce((s, a) => s + Number(a.overtime_seconds || 0), 0);

    const empTasks = taskRows.filter((t) => t.assignee_id === emp.id);
    const tasksCompleted = empTasks.filter((t) => t.status === 'completed').length;
    const tasksPending = empTasks.filter((t) => t.status !== 'completed').length;

    const unpaidLeaveDays = approvedLeaves
      .filter((l) => l.employee_id === emp.id && l.leave_type === 'unpaid')
      .reduce((s, l) => s + Number(l.days), 0);

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
      const lateLopDays = settings.lateDeductionEnabled ? Math.floor(lateDays / Math.max(1, settings.lateDaysPerHalfDayLop)) * 0.5 : 0;
      const unpaidDeduction = Math.round((absentDays + unpaidLeaveDays + lateLopDays) * perDayRate + halfDays * 0.5 * perDayRate);
      const overtimePay = Math.round((totalOvertimeSeconds / 3600) * sal.overtime_hourly_rate);
      const totalDeductions = sal.pf_deduction + sal.tax_deduction + unpaidDeduction;

      const joiningDate = (emp.joining_date_str || emp.created_date_str || monthStart).slice(0, 10);
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

  return { month, locked, isCurrentMonth: month === currentMonth, elapsedWorkingDays, totalWorkingDays, prorationRatio, rows };
}

app.get('/api/reports/monthly', requireRole('admin', 'manager'), async (req, res) => {
  res.json(await buildMonthlyReport(req.query.month || getCurrentMonthInTz()));
});

app.get('/api/reports/me', async (req, res) => {
  const full = await buildMonthlyReport(req.query.month || getCurrentMonthInTz());
  res.json({ ...full, rows: full.rows.filter((r) => r.employee_id === req.user.id) });
});

app.post('/api/payroll/lock', requireRole('admin', 'manager'), async (req, res) => {
  const month = req.body.month || getCurrentMonthInTz();
  await query(`INSERT INTO payroll_locks (month, locked_by) VALUES ($1, $2) ON CONFLICT (month) DO NOTHING`, [month, req.user.id]);
  await writeAuditLog({ actorId: req.user.id, actorName: req.user.name, action: 'LOCK_PAYROLL', entityType: 'payroll', entityId: month, newValue: { locked: true } });
  res.json({ ok: true, month, locked: true });
});

app.delete('/api/payroll/lock/:month', requireRole('admin', 'manager'), async (req, res) => {
  await query(`DELETE FROM payroll_locks WHERE month = $1`, [req.params.month]);
  await writeAuditLog({ actorId: req.user.id, actorName: req.user.name, action: 'UNLOCK_PAYROLL', entityType: 'payroll', entityId: req.params.month, newValue: { locked: false } });
  res.json({ ok: true, month: req.params.month, locked: false });
});

app.get('/api/export/monthly', requireRole('admin', 'manager'), async (req, res) => {
  const month = req.query.month || getCurrentMonthInTz();
  const report = await buildMonthlyReport(month);
  const header = ['Code', 'Name', 'Department', 'Present Days', 'Late Days', 'Half Days', 'Leave Days', 'Absent Days', 'Active Hours', 'Idle Hours', 'Overtime Hours', 'Gross Salary', 'Overtime Pay', 'Deductions', 'Projected Net', 'Month-To-Date Net', 'Currency'];
  const lines = [
    header.join(','),
    ...report.rows.filter((r) => r.salary_set && r.salary).map((r) => [
      r.emp_code, r.name, r.department, r.present_days, r.late_days, r.half_days, r.leave_days, r.absent_days,
      (r.total_active_seconds / 3600).toFixed(2), (r.total_idle_seconds / 3600).toFixed(2), (r.total_overtime_seconds / 3600).toFixed(2),
      r.salary.gross_salary, r.salary.overtime_pay, r.salary.total_deductions, r.salary.net_salary, r.salary.prorated_net_salary, r.salary.currency,
    ].map(csvEscape).join(',')),
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="zaviroq-monthly-payroll-${month}.csv"`);
  res.send(lines.join('\n'));
});

app.get('/api/export/me', async (req, res) => {
  const month = req.query.month || getCurrentMonthInTz();
  const report = await buildMonthlyReport(month);
  const myRows = report.rows.filter((r) => r.employee_id === req.user.id);
  const header = ['Code', 'Name', 'Department', 'Attended Days', 'Present Days', 'Late Days', 'Half Days', 'Leave Days', 'Absent Days', 'Active Hours', 'Idle Hours', 'Overtime Hours', 'Gross Salary', 'Overtime Pay', 'Deductions', 'Projected Net', 'Month-To-Date Net', 'Currency'];
  const lines = [
    header.join(','),
    ...myRows.map((r) => [
      r.emp_code, r.name, r.department, r.present_days + r.late_days + r.half_days, r.present_days, r.late_days, r.half_days, r.leave_days, r.absent_days,
      (r.total_active_seconds / 3600).toFixed(2), (r.total_idle_seconds / 3600).toFixed(2), (r.total_overtime_seconds / 3600).toFixed(2),
      r.salary?.gross_salary ?? 'Salary not set', r.salary?.overtime_pay ?? 0, r.salary?.total_deductions ?? 0, r.salary?.net_salary ?? 'Salary not set', r.salary?.prorated_net_salary ?? 'Salary not set', r.salary?.currency ?? 'INR',
    ].map(csvEscape).join(',')),
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="zaviroq-my-report-${month}.csv"`);
  res.send(lines.join('\n'));
});

app.get('/api/export/attendance', requireRole('admin', 'manager'), async (req, res) => {
  const date = req.query.date || getTodayDateInTz();
  const rows = await getAll(
    `SELECT e.emp_code, e.name, e.department, e.designation, COALESCE(a.status, 'absent') as status, a.clock_in, a.clock_out,
      COALESCE(a.active_seconds, 0) as active_seconds, COALESCE(a.idle_seconds, 0) as idle_seconds,
      COALESCE(a.break_seconds, 0) as break_seconds, COALESCE(a.overtime_seconds, 0) as overtime_seconds,
      COALESCE(a.missed_clock_out, FALSE) as missed_clock_out, COALESCE(a.notes, '') as notes
     FROM employees e LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = $1::date WHERE e.is_active = TRUE ORDER BY e.id ASC`,
    [date]
  );
  const header = ['Code', 'Name', 'Department', 'Designation', 'Status', 'Clock In', 'Clock Out', 'Active (min)', 'Idle (min)', 'Break (min)', 'Overtime (min)', 'Missed Clock Out', 'Notes'];
  const lines = [
    header.join(','),
    ...rows.map((r) => [
      r.emp_code, r.name, r.department, r.designation, r.status, r.clock_in || '', r.clock_out || '',
      Math.round(r.active_seconds / 60), Math.round(r.idle_seconds / 60), Math.round(r.break_seconds / 60), Math.round(r.overtime_seconds / 60),
      r.missed_clock_out ? 'Yes' : 'No', r.notes,
    ].map(csvEscape).join(',')),
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="zaviroq-attendance-${date}.csv"`);
  res.send(lines.join('\n'));
});

app.get('/api/salaries', requireRole('admin', 'manager'), async (_req, res) => {
  res.json(await getAll(
    `SELECT e.id as employee_id, e.emp_code, e.name, e.department, e.designation, e.avatar_color,
      s.currency, s.base_monthly_salary, s.hra, s.transport_allowance, s.special_allowance,
      s.pf_deduction, s.tax_deduction, s.overtime_hourly_rate, s.working_days_per_month, s.updated_at
     FROM employees e LEFT JOIN salaries s ON s.employee_id = e.id WHERE e.is_active = TRUE ORDER BY e.id ASC`
  ));
});

app.put('/api/salaries/:employeeId', requireRole('admin', 'manager'), async (req, res) => {
  const { employeeId } = req.params;
  const month = req.body.month || getCurrentMonthInTz();
  if (await isPayrollLocked(month)) return res.status(409).json({ error: `Payroll is locked for ${month}.` });

  const {
    currency = 'INR', base_monthly_salary = 50000, hra = 15000, transport_allowance = 3000,
    special_allowance = 7000, pf_deduction = 3600, tax_deduction = 2500,
    overtime_hourly_rate = 450, working_days_per_month = 22,
  } = req.body;

  const oldSal = await getOne('SELECT * FROM salaries WHERE employee_id = $1', [employeeId]);
  const updated = await getOne(
    `INSERT INTO salaries (employee_id, currency, base_monthly_salary, hra, transport_allowance, special_allowance, pf_deduction, tax_deduction, overtime_hourly_rate, working_days_per_month, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     ON CONFLICT (employee_id) DO UPDATE SET
       currency = EXCLUDED.currency, base_monthly_salary = EXCLUDED.base_monthly_salary, hra = EXCLUDED.hra,
       transport_allowance = EXCLUDED.transport_allowance, special_allowance = EXCLUDED.special_allowance,
       pf_deduction = EXCLUDED.pf_deduction, tax_deduction = EXCLUDED.tax_deduction,
       overtime_hourly_rate = EXCLUDED.overtime_hourly_rate, working_days_per_month = EXCLUDED.working_days_per_month,
       updated_at = NOW()
     RETURNING *`,
    [Number(employeeId), currency, Number(base_monthly_salary), Number(hra), Number(transport_allowance), Number(special_allowance), Number(pf_deduction), Number(tax_deduction), Number(overtime_hourly_rate), Math.max(1, Number(working_days_per_month))]
  );
  await writeAuditLog({ actorId: req.user.id, actorName: req.user.name, action: 'UPDATE_SALARY', entityType: 'salary', entityId: employeeId, oldValue: oldSal, newValue: updated });
  res.json(updated);
});

// ========================
// TASKS & ANNOUNCEMENTS
// ========================
app.post('/api/tasks', async (req, res) => {
  const isPrivileged = req.user.role === 'admin' || req.user.role === 'manager';
  const { title, description = '', assignee_id, department = req.user.department || 'Engineering', priority = 'medium', status = 'pending', due_date = getTodayDateInTz(), estimated_minutes = 60, tags = [] } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Task title is required.' });
  const targetAssignee = isPrivileged && assignee_id ? Number(assignee_id) : req.user.id;
  const created = await getOne(
    `INSERT INTO tasks (title, description, assignee_id, created_by, department, priority, status, due_date, estimated_minutes, tags)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10::jsonb) RETURNING *, due_date::text`,
    [title.trim(), description.trim(), targetAssignee, req.user.id, department, priority, status, due_date, Number(estimated_minutes) || 60, JSON.stringify(Array.isArray(tags) ? tags : [])]
  );
  res.status(201).json(created);
});

app.patch('/api/tasks/:id', async (req, res) => {
  const { id } = req.params;
  const existing = await getOne('SELECT *, due_date::text as due_date FROM tasks WHERE id = $1', [id]);
  if (!existing) return res.status(404).json({ error: 'Task not found' });
  const isPrivileged = req.user.role === 'admin' || req.user.role === 'manager';
  if (!isPrivileged && existing.assignee_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  const { title = existing.title, description = existing.description, assignee_id = existing.assignee_id, priority = existing.priority, status = existing.status, due_date = existing.due_date, estimated_minutes = existing.estimated_minutes, logged_minutes = existing.logged_minutes, unblockNote = '' } = req.body;
  if (existing.status === 'blocked' && status === 'completed' && !unblockNote.trim()) {
    return res.status(400).json({ error: 'A blocked task cannot go straight to Completed. Move it to In Progress first or provide an unblock note.' });
  }
  const targetAssignee = isPrivileged ? Number(assignee_id) : existing.assignee_id;
  const completedAt = status === 'completed' ? (existing.completed_at || new Date().toISOString()) : null;

  const updated = await getOne(
    `UPDATE tasks SET title = $1, description = $2, assignee_id = $3, priority = $4, status = $5, due_date = $6::date, estimated_minutes = $7, logged_minutes = $8, completed_at = $9::timestamptz, updated_at = NOW() WHERE id = $10 RETURNING *, due_date::text`,
    [title, description, targetAssignee, priority, status, due_date, Number(estimated_minutes), Number(logged_minutes), completedAt, id]
  );
  if (status !== existing.status) {
    await query(`INSERT INTO activity_logs (employee_id, date, type, reason, timestamp) VALUES ($1, $2::date, 'task_update', $3, NOW())`, [targetAssignee, getTodayDateInTz(), `Task "${title}" → ${status.replace('_', ' ')}`]);
  }
  res.json(updated);
});

app.delete('/api/tasks/:id', requireRole('admin', 'manager'), async (req, res) => {
  const info = await query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
  if (info.rowCount === 0) return res.status(404).json({ error: 'Task not found' });
  res.json({ ok: true });
});

app.post('/api/announcements', requireRole('admin', 'manager'), async (req, res) => {
  const { title, message, priority = 'normal' } = req.body;
  if (!title?.trim() || !message?.trim()) return res.status(400).json({ error: 'Title and message are required' });
  const row = await getOne(`INSERT INTO announcements (title, message, author_id, priority) VALUES ($1, $2, $3, $4) RETURNING *`, [title.trim(), message.trim(), req.user.id, priority]);
  res.status(201).json(row);
});

// ========================
// SETTINGS, AUDIT LOGS & NOTIFICATIONS
// ========================
app.get('/api/settings', requireRole('admin', 'manager'), async (_req, res) => {
  res.json(await getSettings());
});

app.put('/api/settings', requireRole('admin', 'manager'), async (req, res) => {
  const oldSettings = await getSettings();
  const allowedKeys = [
    'shiftStart', 'shiftEnd', 'lateGraceMinutes', 'lunchBreak', 'lunchMinutes',
    'teaBreakAfter', 'teaMinutes', 'totalBreakMinutes', 'netWorkHours',
    'idleThresholdSeconds', 'autoClockOutBufferMinutes', 'afterHoursClockInMode', 'weekendDays',
    'lateDeductionEnabled', 'lateDaysPerHalfDayLop', 'overtimePolicy', 'prorateAnnualLeave',
  ];
  for (const key of allowedKeys) {
    if (req.body[key] !== undefined) {
      const val = typeof req.body[key] === 'object' ? JSON.stringify(req.body[key]) : String(req.body[key]);
      await query(`INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, val]);
    }
  }
  const newSettings = await getSettings();
  await recalculateAttendanceLateStatuses({ id: req.user.id, name: req.user.name });
  await writeAuditLog({ actorId: req.user.id, actorName: req.user.name, action: 'UPDATE_SETTINGS', entityType: 'settings', entityId: 'global', oldValue: oldSettings, newValue: newSettings });
  res.json(newSettings);
});

app.get('/api/audit-logs', requireRole('admin', 'manager'), async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize || req.query.limit || 50)));
  const offset = (page - 1) * pageSize;
  const { actor = '', action = '', date = '', grouped = 'false', excludeTest = 'false' } = req.query;

  const conditions = [];
  const params = [];
  let idx = 1;
  if (excludeTest === 'true') conditions.push(`(actor_name IS DISTINCT FROM 'Test' AND action != 'PG_VERIFY')`);
  if (actor === 'system') conditions.push('actor_id IS NULL');
  else if (actor === 'user') conditions.push('actor_id IS NOT NULL');
  if (action) { conditions.push(`action = $${idx++}`); params.push(action); }
  if (date) { conditions.push(`to_char(created_at AT TIME ZONE '${APP_TIMEZONE}', 'YYYY-MM-DD') = $${idx++}`); params.push(date); }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  if (grouped === 'true') {
    const allRows = await getAll(`SELECT * FROM audit_logs ${where} ORDER BY id DESC`, params);
    const recalcRows = allRows.filter((r) => r.action === 'RECALC_LATE_STATUS');
    const nonRecalcRows = allRows.filter((r) => r.action !== 'RECALC_LATE_STATUS');
    const combined = [...nonRecalcRows];
    if (recalcRows.length > 1) {
      combined.push({
        id: recalcRows[0].id, actor_id: null, actor_name: 'System', action: 'RECALC_LATE_STATUS_GROUP',
        entity_type: 'attendance', entity_id: `${recalcRows.length} records`, old_value: null,
        new_value: `Recalculated late status — ${recalcRows.length} records`, created_at: recalcRows[0].created_at,
        is_grouped: true, group_count: recalcRows.length, children: recalcRows,
      });
    } else if (recalcRows.length === 1) {
      combined.push(recalcRows[0]);
    }
    combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return res.json({ rows: combined.slice(offset, offset + pageSize), total: combined.length, page, pageSize });
  }

  const cntRow = await getOne(`SELECT COUNT(*)::int as cnt FROM audit_logs ${where}`, params);
  const rows = await getAll(`SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT $${idx++} OFFSET $${idx++}`, [...params, pageSize, offset]);
  res.json({ rows, total: cntRow.cnt, page, pageSize });
});

app.get('/api/notifications', async (req, res) => {
  const today = getTodayDateInTz();
  const settings = await getSettings();
  const isPrivileged = req.user.role === 'admin' || req.user.role === 'manager';
  const notifications = [];

  const missed = await getAll(
    `SELECT a.date::text as date, e.name FROM attendance a JOIN employees e ON e.id = a.employee_id WHERE a.missed_clock_out = TRUE ${isPrivileged ? '' : 'AND a.employee_id = $1'} ORDER BY a.date DESC LIMIT 10`,
    isPrivileged ? [] : [req.user.id]
  );
  for (const m of missed) notifications.push({ id: `missed-${m.name}-${m.date}`, type: 'warning', title: 'Missed Clock-Out', message: `${m.name} missed clock-out on ${m.date}` });

  const breakOver = await getAll(
    `SELECT e.name, a.break_seconds FROM attendance a JOIN employees e ON e.id = a.employee_id WHERE a.date = $1::date AND a.break_seconds > $2 ${isPrivileged ? '' : 'AND a.employee_id = $3'}`,
    isPrivileged ? [today, settings.totalBreakMinutes * 60] : [today, settings.totalBreakMinutes * 60, req.user.id]
  );
  for (const b of breakOver) notifications.push({ id: `break-${b.name}`, type: 'warning', title: 'Break Over Limit', message: `${b.name} exceeded ${settings.totalBreakMinutes}m break (${Math.round(b.break_seconds / 60)}m)` });

  const tasks = await getAll(
    `SELECT t.*, t.due_date::text as due_date, e.name as assignee_name FROM tasks t JOIN employees e ON e.id = t.assignee_id WHERE t.status != 'completed' ${isPrivileged ? '' : 'AND t.assignee_id = $1'}`,
    isPrivileged ? [] : [req.user.id]
  );
  for (const t of tasks) if (isTaskOverdue(t, today, settings.shiftEnd)) notifications.push({ id: `overdue-${t.id}`, type: 'danger', title: 'Task Overdue', message: `"${t.title}" (${t.assignee_name}) due ${t.due_date}` });

  const saved = await getAll(
    `SELECT id, type, title, message, link, created_at FROM notifications WHERE employee_id = $1 ORDER BY id DESC LIMIT 20`,
    [req.user.id]
  );
  for (const s of saved) {
    notifications.push({ id: `alert-${s.id}`, type: s.type || 'alert', title: s.title, message: s.message, link: s.link || '' });
  }

  res.json(notifications);
});

app.get('/api/alert-rules', requireRole('admin', 'manager'), async (_req, res) => {
  res.json(await getAll(`SELECT * FROM alert_rules ORDER BY id ASC`));
});

app.put('/api/alert-rules/:type', requireRole('admin'), async (req, res) => {
  const { type } = req.params;
  const { enabled, threshold_minutes, channels, quiet_hours, recipients } = req.body;
  const existing = await getOne(`SELECT * FROM alert_rules WHERE type = $1`, [type]);
  if (!existing) return res.status(404).json({ error: 'Alert rule not found' });

  const updated = await getOne(
    `UPDATE alert_rules
     SET enabled = COALESCE($1, enabled),
         threshold_minutes = COALESCE($2, threshold_minutes),
         channels = COALESCE($3::jsonb, channels),
         quiet_hours = COALESCE($4::jsonb, quiet_hours),
         recipients = COALESCE($5, recipients),
         updated_at = NOW()
     WHERE type = $6 RETURNING *`,
    [
      enabled !== undefined ? Boolean(enabled) : null,
      threshold_minutes !== undefined ? Number(threshold_minutes) : null,
      channels !== undefined ? JSON.stringify(channels) : null,
      quiet_hours !== undefined ? JSON.stringify(quiet_hours) : null,
      recipients || null,
      type,
    ]
  );
  await writeAuditLog({ actorId: req.user.id, actorName: req.user.name, action: 'UPDATE_ALERT_RULE', entityType: 'alert_rule', entityId: type, oldValue: existing, newValue: updated });
  res.json(updated);
});

app.get('/api/push/vapid-key', requireRole('admin', 'manager'), (_req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

app.post('/api/push/subscribe', requireRole('admin', 'manager'), async (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Valid push subscription endpoint and keys required.' });
  }
  await query(
    `INSERT INTO push_subscriptions (employee_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET employee_id = $1, p256dh = $3, auth = $4`,
    [req.user.id, endpoint, keys.p256dh, keys.auth]
  );
  res.status(201).json({ ok: true });
});

app.delete('/api/push/subscribe', requireRole('admin', 'manager'), async (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) {
    await query(`DELETE FROM push_subscriptions WHERE endpoint = $1 AND employee_id = $2`, [endpoint, req.user.id]);
  } else {
    await query(`DELETE FROM push_subscriptions WHERE employee_id = $1`, [req.user.id]);
  }
  res.json({ ok: true });
});

// ========================
// CHAT + SUPABASE STORAGE SIGNED IMAGES
// ========================
app.get('/api/chat/contacts', async (req, res) => {
  res.json(await getAll(`SELECT id, emp_code, name, designation, department, avatar_color, status, role FROM employees WHERE is_active = TRUE AND id != $1 ORDER BY id ASC`, [req.user.id]));
});

async function generateBotReply(userId, promptText) {
  const q = promptText.toLowerCase();
  const today = getTodayDateInTz();
  const caller = await getOne('SELECT * FROM employees WHERE id = $1', [Number(userId)]);
  const isPrivileged = caller && (caller.role === 'admin' || caller.role === 'manager');
  const emps = await getAll(
    `SELECT e.*, a.clock_in, a.clock_out, COALESCE(a.status, 'absent') as att_status,
       COALESCE(a.active_seconds, 0) as active_seconds, COALESCE(a.idle_seconds, 0) as idle_seconds,
       COALESCE(a.break_seconds, 0) as break_seconds
     FROM employees e LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = $1::date ${isPrivileged ? 'WHERE e.is_active = TRUE' : 'WHERE e.id = $2'}`,
    isPrivileged ? [today] : [today, Number(userId)]
  );
  const me = emps.find((e) => e.id === Number(userId)) || caller;

  if (q.includes('motivate') || q.includes('encourage') || q === 'hello' || q === 'hi') {
    const myPending = (await getOne(`SELECT COUNT(*)::int as cnt FROM tasks WHERE assignee_id = $1 AND status != 'completed'`, [Number(userId)])).cnt;
    const activeHrs = ((me?.active_seconds || 0) / 3600).toFixed(1);
    const s = await getSettings();
    const [eh, em] = (me?.shift_end || s.shiftEnd).split(':').map(Number);
    if (getLocalMinutesInTz(new Date(), APP_TIMEZONE) > eh * 60 + em) {
      return `Great effort today, ${me?.name || 'teammate'}! You logged ${activeHrs}h of active focus (${myPending} pending task(s)). Shift over — remember to clock out!`;
    }
    return `You've got this, ${me?.name || 'teammate'}! You've already logged ${activeHrs}h of active focus today. Knock out your ${myPending} pending task(s) — finish strong before ${me?.shift_end || s.shiftEnd}!`;
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
        ? new Date(me.clock_in).toLocaleTimeString('en-IN', { timeZone: APP_TIMEZONE, hour: '2-digit', minute: '2-digit' })
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
    const s = await getSettings();
    return `Zaviroq Office Policy:\n• Office Hours: ${s.shiftStart} – ${s.shiftEnd} (${s.lateGraceMinutes}m arrival grace)\n• Lunch Break: ${s.lunchBreak} (${s.lunchMinutes} mins)\n• Tea Break: ${s.teaMinutes} mins after ${s.teaBreakAfter}\n• Net Shift: ${s.netWorkHours}h active work`;
  }

  if (q.includes('leave') || q.includes('holiday') || q.includes('off')) {
    const myLeaves = await getAll(
      `SELECT l.*, l.start_date::text as start_date, l.end_date::text as end_date, e.name
       FROM leaves l JOIN employees e ON e.id = l.employee_id
       WHERE l.status = 'pending' ${isPrivileged ? '' : 'AND l.employee_id = $1'}
       ORDER BY l.id DESC`,
      isPrivileged ? [] : [Number(userId)]
    );
    if (myLeaves.length === 0) return 'You have no pending leave requests right now.';
    return `Pending Leave Requests (${myLeaves.length}):\n` +
      myLeaves.map((l) => `• ${l.name}: ${l.leave_type} (${l.start_date} to ${l.end_date}, ${Number(l.days)}d) — ${l.reason}`).join('\n');
  }

  if (q.includes('pending') || q.includes('task') || q.includes('overdue')) {
    const totalRow = await getOne(
      `SELECT COUNT(*)::int as cnt FROM tasks ${isPrivileged ? '' : 'WHERE assignee_id = $1'}`,
      isPrivileged ? [] : [Number(userId)]
    );
    if (totalRow.cnt === 0) return 'You have no tasks assigned yet.';
    const pending = await getAll(
      `SELECT t.title, t.priority, t.due_date::text as due_date, e.name as assignee FROM tasks t LEFT JOIN employees e ON e.id = t.assignee_id WHERE t.status != 'completed' ${isPrivileged ? '' : 'AND t.assignee_id = $1'} ORDER BY t.due_date ASC LIMIT 5`,
      isPrivileged ? [] : [Number(userId)]
    );
    if (pending.length === 0) return 'All your tasks are currently completed! Great job!';
    return `${isPrivileged ? 'Top Open/Pending Tasks' : 'Your Pending Tasks'} (${pending.length}):\n` + pending.map((t) => `• [${t.priority.toUpperCase()}] ${t.title} — ${t.assignee} (Due ${t.due_date})`).join('\n');
  }
  return `Hi ${caller?.name?.split(' ')[0] || 'there'}! I'm Zavi, your Zaviroq Assistant.`;
}

app.get('/api/chat/messages', async (req, res) => {
  const userId = req.user.id;
  if (req.query.userId && Number(req.query.userId) !== userId) return res.status(403).json({ error: 'Forbidden' });
  const peerId = Number(req.query.peerId ?? 0);
  const after = Number(req.query.after || 0);
  const limit = Math.min(100, Number(req.query.limit || 50));

  const rows = await getAll(
    `SELECT m.*, CASE WHEN m.sender_id = 0 THEN 'Zaviroq Bot' ELSE se.name END as sender_name,
      CASE WHEN m.sender_id = 0 THEN '#6366f1' ELSE se.avatar_color END as sender_color
     FROM chat_messages m LEFT JOIN employees se ON se.id = m.sender_id
     WHERE ((m.sender_id = $1 AND m.recipient_id = $2) OR (m.sender_id = $2 AND m.recipient_id = $1)) AND m.id > $3
     ORDER BY m.id ASC LIMIT $4`,
    [userId, peerId, after, limit]
  );

  for (const r of rows) {
    if (r.image_data) r.image_data = await signChatImageUrl(r.image_data);
  }
  res.json(rows);
});

app.post('/api/chat/messages', async (req, res) => {
  const senderId = req.user.id;
  const { recipient_id, message = '', image_data = '' } = req.body;
  if (recipient_id === undefined || (!message?.trim() && !image_data)) {
    return res.status(400).json({ error: 'recipient_id and message or image are required.' });
  }

  let storedImagePath = '';
  if (image_data) {
    const uploaded = await uploadChatImage(image_data);
    if (uploaded.error) return res.status(400).json({ error: uploaded.error });
    storedImagePath = uploaded.path;
  }

  const userMsg = await getOne(
    `INSERT INTO chat_messages (sender_id, recipient_id, message, image_data, is_bot, created_at) VALUES ($1, $2, $3, $4, FALSE, NOW()) RETURNING *`,
    [senderId, Number(recipient_id), message.trim(), storedImagePath]
  );
  if (userMsg.image_data) userMsg.image_data = await signChatImageUrl(userMsg.image_data);

  let botMsg = null;
  if (Number(recipient_id) === 0) {
    const reply = await generateBotReply(senderId, message || 'Image shared');
    botMsg = await getOne(
      `INSERT INTO chat_messages (sender_id, recipient_id, message, is_bot, created_at) VALUES (0, $1, $2, TRUE, NOW()) RETURNING *`,
      [senderId, reply]
    );
  }
  res.status(201).json({ userMsg, botMsg });
});

app.use((err, req, res, _next) => {
  console.error(`[API Error] ${req.method} ${req.path}:`, err?.message || err);
  if (!res.headersSent) {
    res.status(503).json({ error: err?.message || 'Service temporarily unavailable' });
  }
});

export default app;
