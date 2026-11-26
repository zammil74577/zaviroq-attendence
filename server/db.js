import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const rawDbPath = process.env.DATABASE_PATH || process.env.DB_PATH;
export const dbPath = rawDbPath
  ? path.resolve(rawDbPath)
  : path.join(dataDir, 'zaviroq.db');
const dbParent = path.dirname(dbPath);
if (!fs.existsSync(dbParent)) {
  fs.mkdirSync(dbParent, { recursive: true });
}
export const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export function getTodayDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getCurrentMonth() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function getLocalMinutesInTz(dateObj = new Date(), timeZone = 'Asia/Kolkata') {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(dateObj);
  const hh = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const mm = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  return hh * 60 + mm;
}

export function formatClockInReasonInTz(
  shiftStart = '09:30',
  shiftEnd = '17:30',
  bufferMinutes = 120,
  dateObj = new Date(),
  graceMinutes = 15,
  timeZone = 'Asia/Kolkata'
) {
  const [sh, sm] = shiftStart.split(':').map(Number);
  const [eh, em] = shiftEnd.split(':').map(Number);
  const shiftStartMins = sh * 60 + sm;
  const shiftEndMins = eh * 60 + em;
  const currentMins = getLocalMinutesInTz(dateObj, timeZone);

  if (currentMins > shiftEndMins + bufferMinutes) {
    return 'After-hours clock-in';
  }
  if (currentMins > shiftStartMins + graceMinutes) {
    return `Clocked in late (+${currentMins - shiftStartMins}m)`;
  }
  return 'Clocked in on time';
}

export function sanitizeEmployee(row) {
  if (!row) return null;
  const {
    pin: _pin,
    failed_login_attempts: _fla,
    locked_until: _lu,
    active_session_id: _asid,
    ...safe
  } = row;
  return safe;
}

export function hashPin(plainPin) {
  return bcrypt.hashSync(String(plainPin), 10);
}

export function verifyPin(plainPin, storedHash) {
  if (!storedHash) return false;
  if (storedHash.startsWith('$2')) {
    return bcrypt.compareSync(String(plainPin), storedHash);
  }
  return String(plainPin) === storedHash;
}

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      emp_code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL DEFAULT 'employee',
      department TEXT NOT NULL,
      designation TEXT NOT NULL,
      shift_start TEXT NOT NULL DEFAULT '09:30',
      shift_end TEXT NOT NULL DEFAULT '17:30',
      status TEXT NOT NULL DEFAULT 'offline',
      avatar_color TEXT NOT NULL DEFAULT '#6366f1',
      joining_date TEXT,
      pin TEXT NOT NULL DEFAULT '1234',
      failed_login_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      tracking_consent_at TEXT,
      active_session_id TEXT,
      last_heartbeat_at TEXT,
      last_heartbeat_state TEXT,
      last_seen_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      clock_in TEXT,
      clock_out TEXT,
      status TEXT NOT NULL DEFAULT 'present',
      active_seconds INTEGER NOT NULL DEFAULT 0,
      idle_seconds INTEGER NOT NULL DEFAULT 0,
      break_seconds INTEGER NOT NULL DEFAULT 0,
      overtime_seconds INTEGER NOT NULL DEFAULT 0,
      missed_clock_out INTEGER NOT NULL DEFAULT 0,
      tracking_mode TEXT NOT NULL DEFAULT 'tab_only',
      notes TEXT DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(employee_id, date),
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      reason TEXT DEFAULT '',
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      assignee_id INTEGER NOT NULL,
      created_by INTEGER,
      department TEXT NOT NULL DEFAULT 'Engineering',
      priority TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'pending',
      due_date TEXT NOT NULL,
      estimated_minutes INTEGER NOT NULL DEFAULT 60,
      logged_minutes INTEGER NOT NULL DEFAULT 0,
      tags TEXT DEFAULT '[]',
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (assignee_id) REFERENCES employees(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      author_id INTEGER,
      priority TEXT NOT NULL DEFAULT 'normal',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (author_id) REFERENCES employees(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS leaves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      leave_type TEXT NOT NULL DEFAULT 'casual',
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      days REAL NOT NULL DEFAULT 1,
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by INTEGER,
      reviewer_comment TEXT DEFAULT '',
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS salary_structures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER UNIQUE NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      base_monthly_salary REAL NOT NULL DEFAULT 50000,
      hra REAL NOT NULL DEFAULT 15000,
      transport_allowance REAL NOT NULL DEFAULT 3000,
      special_allowance REAL NOT NULL DEFAULT 7000,
      pf_deduction REAL NOT NULL DEFAULT 3600,
      tax_deduction REAL NOT NULL DEFAULT 2500,
      overtime_hourly_rate REAL NOT NULL DEFAULT 450,
      working_days_per_month INTEGER NOT NULL DEFAULT 22,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      recipient_id INTEGER NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      image_data TEXT DEFAULT '',
      is_bot INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payroll_locks (
      month TEXT PRIMARY KEY,
      locked_by INTEGER,
      locked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id INTEGER,
      actor_name TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      old_value TEXT,
      new_value TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      employee_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER,
      type TEXT NOT NULL DEFAULT 'info',
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      link TEXT DEFAULT '',
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS alert_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT UNIQUE NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      threshold_minutes INTEGER NOT NULL DEFAULT 5,
      channels TEXT NOT NULL DEFAULT '["in_app"]',
      quiet_hours TEXT NOT NULL DEFAULT '{"start":"22:00","end":"08:00"}',
      recipients TEXT NOT NULL DEFAULT 'all',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS alert_episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER,
      rule_type TEXT NOT NULL,
      episode_key TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      triggered_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function runMigrations() {
  const safeAlter = (sql) => {
    try { db.exec(sql); } catch { /* column already exists */ }
  };
  safeAlter(`ALTER TABLE employees ADD COLUMN pin TEXT NOT NULL DEFAULT '1234'`);
  safeAlter(`ALTER TABLE employees ADD COLUMN must_change_pin INTEGER NOT NULL DEFAULT 0`);
  safeAlter(`ALTER TABLE employees ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0`);
  safeAlter(`ALTER TABLE employees ADD COLUMN locked_until TEXT`);
  safeAlter(`ALTER TABLE employees ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`);
  safeAlter(`ALTER TABLE employees ADD COLUMN tracking_consent_at TEXT`);
  safeAlter(`ALTER TABLE employees ADD COLUMN active_session_id TEXT`);
  safeAlter(`ALTER TABLE employees ADD COLUMN last_heartbeat_at TEXT`);
  safeAlter(`ALTER TABLE employees ADD COLUMN last_heartbeat_state TEXT`);
  safeAlter(`ALTER TABLE employees ADD COLUMN joining_date TEXT`);
  try {
    db.exec(`UPDATE employees SET joining_date = substr(created_at, 1, 10) WHERE joining_date IS NULL`);
  } catch { /* ignore */ }
  safeAlter(`ALTER TABLE attendance ADD COLUMN missed_clock_out INTEGER NOT NULL DEFAULT 0`);
  safeAlter(`ALTER TABLE attendance ADD COLUMN manual_override INTEGER NOT NULL DEFAULT 0`);
  safeAlter(`ALTER TABLE attendance ADD COLUMN tracking_mode TEXT NOT NULL DEFAULT 'tab_only'`);
  safeAlter(`ALTER TABLE leaves ADD COLUMN reviewer_comment TEXT DEFAULT ''`);
  safeAlter(`ALTER TABLE chat_messages ADD COLUMN image_data TEXT DEFAULT ''`);

  // Default app_settings
  const defaultSettings = {
    shiftStart: '09:30',
    shiftEnd: '17:30',
    lateGraceMinutes: '15',
    lunchBreak: '13:00-13:45',
    lunchMinutes: '45',
    teaBreakAfter: '15:00',
    teaMinutes: '15',
    totalBreakMinutes: '60',
    netWorkHours: '7',
    idleThresholdSeconds: '60',
    autoClockOutBufferMinutes: '120',
    afterHoursClockInMode: 'block',
    weekendDays: '[0,6]',
    lateDeductionEnabled: 'false',
    lateDaysPerHalfDayLop: '3',
    overtimePolicy: 'net_hours',
    prorateAnnualLeave: 'true',
  };
  const upsertSetting = db.prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)`);
  for (const [k, v] of Object.entries(defaultSettings)) {
    upsertSetting.run(k, v);
  }

  const upsertRule = db.prepare(
    `INSERT OR IGNORE INTO alert_rules (type, enabled, threshold_minutes, channels, quiet_hours, recipients) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const defaultRules = [
    ['tracker_offline', 1, 5, '["in_app","push"]', '{"start":"22:00","end":"08:00"}', 'all'],
    ['idle_too_long', 1, 15, '["in_app"]', '{"start":"22:00","end":"08:00"}', 'all'],
    ['break_over_limit', 1, 60, '["in_app"]', '{"start":"22:00","end":"08:00"}', 'all'],
    ['not_clocked_in', 1, 0, '["in_app"]', '{"start":"22:00","end":"08:00"}', 'all'],
    ['missed_clock_out', 1, 0, '["in_app"]', '{"start":"22:00","end":"08:00"}', 'all'],
    ['daily_summary', 1, 0, '["in_app"]', '{"start":"22:00","end":"08:00"}', 'all'],
  ];
  for (const r of defaultRules) upsertRule.run(...r);

  // Hash any unhashed plain-text PINs in employees (existing data migration)
  const emps = db.prepare('SELECT id, emp_code, pin FROM employees').all();
  const updatePin = db.prepare('UPDATE employees SET pin = ?, must_change_pin = 1 WHERE id = ?');
  for (const emp of emps) {
    if (!emp.pin || !emp.pin.startsWith('$2')) {
      const plain = emp.emp_code === 'ZAV-001' && (!emp.pin || emp.pin === '1234') ? '0000' : (emp.pin || '1234');
      updatePin.run(hashPin(plain), emp.id);
    }
  }

  // Round 3 #12: Cleanup leaked bot messages & leftover test tasks/logs
  db.prepare(`
    DELETE FROM chat_messages
    WHERE is_bot = 1 AND recipient_id != 1 AND message LIKE '%Top Open/Pending Tasks%'
  `).run();
  db.prepare(`DELETE FROM tasks WHERE title LIKE '%Verify API test task%'`).run();
  db.prepare(`DELETE FROM activity_logs WHERE reason LIKE '%Verify API test task%'`).run();

  // Round 4 #2: Sync existing clock_in activity_logs reason with attendance late status
  db.prepare(`
    UPDATE activity_logs
    SET reason = 'Clocked in late (+' ||
      CAST(MAX(1, (CAST(strftime('%H', timestamp) AS INTEGER) * 60 + CAST(strftime('%M', timestamp) AS INTEGER)) - (9 * 60 + 30)) AS TEXT) ||
      'm)'
    WHERE type = 'clock_in' AND reason = 'Entry Scanner Login'
      AND EXISTS (
        SELECT 1 FROM attendance a
        WHERE a.employee_id = activity_logs.employee_id
          AND a.date = activity_logs.date
          AND a.status = 'late'
      )
  `).run();
  db.prepare(`
    UPDATE activity_logs
    SET reason = 'Clocked in on time'
    WHERE type = 'clock_in' AND reason IN ('Entry Scanner Login', 'Shift started on time', 'Shift clocked in')
  `).run();

  // Round 5 #6: Enforce audit_logs immutability via SQLite triggers
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS prevent_audit_delete
    BEFORE DELETE ON audit_logs
    BEGIN
      SELECT RAISE(ABORT, 'Audit logs are immutable');
    END;
    CREATE TRIGGER IF NOT EXISTS prevent_audit_update
    BEFORE UPDATE ON audit_logs
    BEGIN
      SELECT RAISE(ABORT, 'Audit logs are immutable');
    END;
  `);

  const gapNoteExists = db.prepare(`SELECT id FROM audit_logs WHERE action = 'AUDIT_INTEGRITY_NOTE'`).get();
  if (!gapNoteExists) {
    db.prepare(`
      INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, new_value, created_at)
      VALUES (NULL, 'System', 'AUDIT_INTEGRITY_NOTE', 'audit_logs', 'immutability', ?, ?)
    `).run(
      JSON.stringify({ note: 'Audit log immutability triggers enabled; any prior unlogged cleanup gap occurred before Round 5.' }),
      new Date().toISOString()
    );
  }

  // Round 6 #2: Append correction note (append-only, never delete/update audit_logs)
  const correctionExists = db.prepare(`SELECT id FROM audit_logs WHERE action = 'AUDIT_INTEGRITY_NOTE' AND entity_id = 'correction'`).get();
  if (!correctionExists) {
    db.prepare(`
      INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, new_value, created_at)
      VALUES (NULL, 'System', 'AUDIT_INTEGRITY_NOTE', 'audit_logs', 'correction', ?, ?)
    `).run(
      JSON.stringify({ note: 'Previous note was incorrect — no audit gap; earlier entries were hidden by the 80-row API limit.' }),
      new Date().toISOString()
    );
  }

  // Round 6 #1: One-off cleanup for 2026-11-25 (dedupe Sneha's 14:46 UTC clock_in, collapse same-second bursts, relabel in IST)
  // 1a. Keep only 1 clock_in per employee per minute on 2026-11-25
  db.prepare(`
    DELETE FROM activity_logs
    WHERE date = '2026-11-25' AND type = 'clock_in'
      AND id NOT IN (
        SELECT MIN(id) FROM activity_logs
        WHERE date = '2026-11-25' AND type = 'clock_in'
        GROUP BY employee_id, substr(timestamp, 1, 16)
      )
  `).run();

  // 1b. Collapse same-second state-change bursts on 2026-11-25 (keep final state = MAX(id))
  db.prepare(`
    DELETE FROM activity_logs
    WHERE date = '2026-11-25' AND type IN ('idle_start', 'idle_end', 'break_start', 'break_end')
      AND id NOT IN (
        SELECT MAX(id) FROM activity_logs
        WHERE date = '2026-11-25' AND type IN ('idle_start', 'idle_end', 'break_start', 'break_end')
        GROUP BY employee_id, substr(timestamp, 1, 19)
      )
  `).run();

  // Relabel all clock_in logs on 2026-11-25 using Asia/Kolkata local time
  const clockIns = db.prepare(`
    SELECT l.id, l.timestamp, e.shift_start, e.shift_end
    FROM activity_logs l
    JOIN employees e ON e.id = l.employee_id
    WHERE l.date = '2026-11-25' AND l.type = 'clock_in'
  `).all();
  const round6Settings = getSettings();
  const updClockIn = db.prepare(`UPDATE activity_logs SET reason = ? WHERE id = ?`);
  for (const row of clockIns) {
    const dt = new Date(row.timestamp);
    if (!Number.isNaN(dt.getTime())) {
      const label = formatClockInReasonInTz(
        row.shift_start || round6Settings.shiftStart,
        row.shift_end || round6Settings.shiftEnd,
        round6Settings.autoClockOutBufferMinutes || 120,
        dt,
        round6Settings.lateGraceMinutes,
        'Asia/Kolkata'
      );
      updClockIn.run(label, row.id);
    }
  }

  // Round 3 #5: Recalculate leave days excluding weekends & holidays
  const settings = getSettings();
  const weekendSet = new Set(settings.weekendDays || [0, 6]);
  const holidaySet = new Set(db.prepare('SELECT date FROM holidays').all().map((h) => h.date));
  const allLeaves = db.prepare('SELECT id, start_date, end_date, days FROM leaves').all();
  const updLeaveDays = db.prepare('UPDATE leaves SET days = ? WHERE id = ?');
  for (const lv of allLeaves) {
    const s = new Date(`${lv.start_date}T00:00:00`);
    const e = new Date(`${lv.end_date}T00:00:00`);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) continue;
    let cnt = 0;
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!weekendSet.has(d.getDay()) && !holidaySet.has(ds)) cnt += 1;
    }
    if (cnt > 0 && cnt !== lv.days) {
      updLeaveDays.run(cnt, lv.id);
    }
  }
}

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM app_settings').all();
  const map = {};
  for (const r of rows) map[r.key] = r.value;
  return {
    shiftStart: map.shiftStart || '09:30',
    shiftEnd: map.shiftEnd || '17:30',
    lateGraceMinutes: Number(map.lateGraceMinutes ?? 15),
    lunchBreak: map.lunchBreak || '13:00-13:45',
    lunchMinutes: Number(map.lunchMinutes ?? 45),
    teaBreakAfter: map.teaBreakAfter || '15:00',
    teaMinutes: Number(map.teaMinutes ?? 15),
    totalBreakMinutes: Number(map.totalBreakMinutes ?? 60),
    netWorkHours: Number(map.netWorkHours ?? 7),
    idleThresholdSeconds: Number(map.idleThresholdSeconds ?? 60),
    autoClockOutBufferMinutes: Number(map.autoClockOutBufferMinutes ?? 120),
    afterHoursClockInMode: map.afterHoursClockInMode || 'block',
    weekendDays: JSON.parse(map.weekendDays || '[0,6]'),
    lateDeductionEnabled: map.lateDeductionEnabled === 'true',
    lateDaysPerHalfDayLop: Number(map.lateDaysPerHalfDayLop ?? 3),
    overtimePolicy: map.overtimePolicy || 'net_hours',
    prorateAnnualLeave: map.prorateAnnualLeave !== 'false',
  };
}

export function writeAuditLog({ actorId, actorName, action, entityType, entityId, oldValue, newValue }) {
  db.prepare(`
    INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, old_value, new_value, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    actorId ?? null,
    actorName || 'System',
    action,
    entityType,
    entityId != null ? String(entityId) : null,
    oldValue !== undefined ? JSON.stringify(oldValue) : null,
    newValue !== undefined ? JSON.stringify(newValue) : null,
    new Date().toISOString()
  );
}

export function seedIfEmpty() {
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM employees').get();
  if (countRow.cnt === 0) {
    const today = getTodayDate();
    const now = new Date();
    const isoAgo = (mins) => new Date(now.getTime() - mins * 60000).toISOString();
    const dayOffset = (days) => {
      const d = new Date(now.getTime() + days * 86400000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    const insertEmp = db.prepare(`
      INSERT INTO employees (emp_code, name, email, role, department, designation, shift_start, shift_end, status, avatar_color, pin, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const employees = [
      ['ZAV-001', 'Aarav Mehta', 'aarav@zaviroq.com', 'admin', 'Operations', 'Head of Operations', '09:30', '17:30', 'active', '#6366f1', hashPin('0000'), 1, isoAgo(0)],
      ['ZAV-002', 'Priya Nair', 'priya@zaviroq.com', 'manager', 'Engineering', 'Engineering Lead', '09:30', '17:30', 'active', '#06b6d4', hashPin('1234'), 1, isoAgo(1)],
      ['ZAV-003', 'Rohan Kulkarni', 'rohan@zaviroq.com', 'employee', 'Engineering', 'Full-Stack Developer', '09:30', '17:30', 'idle', '#f59e0b', hashPin('1234'), 1, isoAgo(9)],
      ['ZAV-004', 'Sneha Kapoor', 'sneha@zaviroq.com', 'employee', 'Product & Design', 'Senior UI/UX Designer', '09:30', '17:30', 'active', '#ec4899', hashPin('1234'), 1, isoAgo(0)],
      ['ZAV-005', 'Vikram Joshi', 'vikram@zaviroq.com', 'employee', 'QA & Release', 'QA Automation Engineer', '09:30', '17:30', 'break', '#10b981', hashPin('1234'), 1, isoAgo(6)],
      ['ZAV-006', 'Ananya Rao', 'ananya@zaviroq.com', 'employee', 'People & HR', 'HR Coordinator', '09:30', '17:30', 'offline', '#8b5cf6', hashPin('1234'), 1, isoAgo(180)],
    ];

    const insertEmpWithFlag = db.prepare(`
      INSERT INTO employees (emp_code, name, email, role, department, designation, shift_start, shift_end, status, avatar_color, pin, must_change_pin, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const emp of employees) insertEmpWithFlag.run(...emp);

    const insertAtt = db.prepare(`
      INSERT INTO attendance (employee_id, date, clock_in, clock_out, status, active_seconds, idle_seconds, break_seconds, overtime_seconds, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const attRows = [
      [1, today, isoAgo(485), null, 'present', 25200, 1140, 1800, 0, 'Morning ops sync & sprint review'],
      [2, today, isoAgo(470), null, 'present', 24600, 900, 1500, 0, 'API architecture & PR reviews'],
      [3, today, isoAgo(430), null, 'late', 18400, 3420, 1200, 0, 'Late login (traffic) — working on Auth module'],
      [4, today, isoAgo(450), null, 'present', 23100, 780, 1800, 0, 'Design system tokens & dashboard polish'],
      [5, today, isoAgo(465), null, 'present', 21800, 1260, 2100, 0, 'Regression suite & Playwright checks'],
      [6, today, isoAgo(480), isoAgo(180), 'half_day', 14400, 600, 900, 0, 'Approved half-day leave (afternoon)'],
    ];
    for (const row of attRows) insertAtt.run(...row);

    const insertTask = db.prepare(`
      INSERT INTO tasks (title, description, assignee_id, created_by, department, priority, status, due_date, estimated_minutes, logged_minutes, tags, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const taskRows = [
      ['Finalize Q4 Attendance Policy & Shift Rules', 'Review late-arrival grace period and overtime thresholds for all departments.', 1, 1, 'Operations', 'high', 'in_progress', today, 120, 75, '["policy","hr"]', null],
      ['Deploy Real-time Idle Detection WebSocket/Heartbeat', 'Ensure sub-minute accuracy for active vs idle state transitions.', 2, 1, 'Engineering', 'urgent', 'in_progress', today, 180, 140, '["backend","telemetry"]', null],
      ['Fix OAuth Token Refresh Race Condition', 'Concurrent API calls trigger duplicate refresh requests.', 3, 2, 'Engineering', 'urgent', 'pending', dayOffset(-1), 150, 30, '["auth","bug"]', null],
      ['Design Employee Self-Service Mobile Drawer', 'Responsive sidebar and quick clock-in card for mobile viewports.', 4, 2, 'Product & Design', 'high', 'review', today, 120, 115, '["ui","mobile"]', null],
      ['Automate Daily Attendance CSV Export Tests', 'Verify timezone formatting and total hour calculations.', 5, 2, 'QA & Release', 'medium', 'pending', dayOffset(1), 90, 0, '["qa","export"]', null],
      ['Onboard 3 New Engineering Hires', 'Prepare Zaviroq workspace accounts, shift schedules, and welcome kits.', 6, 1, 'People & HR', 'medium', 'pending', dayOffset(2), 180, 45, '["onboarding"]', null],
      ['Database Backup & Retention Audit', 'Verify SQLite WAL checkpointing and daily snapshot rotation.', 2, 1, 'Engineering', 'high', 'completed', today, 90, 85, '["infra","db"]', isoAgo(120)],
      ['Build Pending Task Escalation Alerts', 'Highlight overdue pending tasks in red on Admin Command Center.', 3, 2, 'Engineering', 'medium', 'blocked', today, 120, 40, '["frontend","alerts"]', null],
      ['Accessibility Contrast Audit (WCAG AA)', 'Validate dark-mode surface contrast ratios across KPI cards.', 4, 4, 'Product & Design', 'low', 'completed', today, 60, 55, '["a11y"]', isoAgo(95)],
      ['Load Test Attendance Heartbeat Endpoint', 'Simulate 250 concurrent employees sending 15s heartbeats.', 5, 2, 'QA & Release', 'high', 'in_progress', dayOffset(1), 150, 90, '["performance"]', null],
      ['Prepare Monthly Payroll Hours Summary', 'Reconcile active hours, approved breaks, and overtime.', 1, 1, 'Operations', 'urgent', 'pending', today, 180, 20, '["payroll","ops"]', null],
      ['Update Shift Handover Runbook', 'Document evening shift escalation contacts and SLA targets.', 6, 1, 'People & HR', 'low', 'completed', dayOffset(-1), 60, 60, '["docs"]', isoAgo(300)],
    ];
    for (const t of taskRows) insertTask.run(...t);

    const insertLog = db.prepare(`
      INSERT INTO activity_logs (employee_id, date, type, duration_seconds, reason, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const logs = [
      [1, today, 'clock_in', 0, 'Shift started on time', isoAgo(485)],
      [2, today, 'clock_in', 0, 'Shift started on time', isoAgo(470)],
      [3, today, 'clock_in', 0, 'Late login (+40m)', isoAgo(430)],
      [3, today, 'idle_start', 0, 'No keyboard/mouse activity for 5m', isoAgo(9)],
      [4, today, 'clock_in', 0, 'Shift started on time', isoAgo(450)],
      [5, today, 'break_start', 0, 'Evening tea break', isoAgo(6)],
      [6, today, 'clock_out', 14400, 'Approved half-day completed', isoAgo(180)],
    ];
    for (const l of logs) insertLog.run(...l);

    db.prepare(`
      INSERT INTO announcements (title, message, author_id, priority)
      VALUES (?, ?, ?, ?)
    `).run(
      'Zaviroq Workforce OS v2.0 Live',
      'All teams must use the live Clock-In / Clock-Out tracker and keep pending tasks updated before 5:30 PM IST.',
      1,
      'important'
    );
  }

  const salaryCnt = db.prepare('SELECT COUNT(*) as cnt FROM salary_structures').get();
  if (salaryCnt.cnt === 0) {
    const insertSal = db.prepare(`
      INSERT OR IGNORE INTO salary_structures
      (employee_id, currency, base_monthly_salary, hra, transport_allowance, special_allowance, pf_deduction, tax_deduction, overtime_hourly_rate, working_days_per_month)
      VALUES (?, 'INR', ?, ?, ?, ?, ?, ?, ?, 22)
    `);
    const salaries = [
      [1, 95000, 28500, 5000, 16500, 5400, 12000, 850],
      [2, 85000, 25500, 4500, 14000, 4800, 9500, 750],
      [3, 55000, 16500, 3000, 8500, 3600, 3800, 500],
      [4, 62000, 18600, 3500, 10900, 3800, 4800, 550],
      [5, 48000, 14400, 3000, 7600, 3200, 2800, 450],
      [6, 45000, 13500, 3000, 6500, 3000, 2200, 400],
    ];
    for (const s of salaries) insertSal.run(...s);
  }

  const leaveCnt = db.prepare('SELECT COUNT(*) as cnt FROM leaves').get();
  if (leaveCnt.cnt === 0) {
    const now = new Date();
    const ym = getCurrentMonth();
    const dayStr = (d) => `${ym}-${String(d).padStart(2, '0')}`;
    const insertLeave = db.prepare(`
      INSERT INTO leaves (employee_id, leave_type, start_date, end_date, days, reason, status, reviewed_by, reviewed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const leaves = [
      [3, 'sick', dayStr(5), dayStr(5), 1, 'Viral fever & doctor consultation', 'approved', 1, now.toISOString()],
      [4, 'casual', dayStr(12), dayStr(13), 2, 'Family function out of town', 'approved', 1, now.toISOString()],
      [5, 'earned', dayStr(27), dayStr(28), 1, 'Planned year-end travel', 'pending', null, null],
      [6, 'casual', dayStr(26), dayStr(26), 1, 'Personal bank & passport appointment', 'pending', null, null],
    ];
    for (const l of leaves) insertLeave.run(...l);
  }

  const attCount = db.prepare('SELECT COUNT(*) as cnt FROM attendance').get();
  if (attCount.cnt <= 6) {
    const now = new Date();
    const ym = getCurrentMonth();
    const todayDay = now.getDate();
    const emps = db.prepare('SELECT id, shift_start, shift_end FROM employees').all();
    const insertHist = db.prepare(`
      INSERT OR IGNORE INTO attendance (employee_id, date, clock_in, clock_out, status, active_seconds, idle_seconds, break_seconds, overtime_seconds, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (let day = 1; day < todayDay; day++) {
      const dt = new Date(now.getFullYear(), now.getMonth(), day);
      const dow = dt.getDay();
      if (dow === 0 || dow === 6) continue;
      const dateStr = `${ym}-${String(day).padStart(2, '0')}`;

      for (const emp of emps) {
        const isLate = (emp.id === 3 && day % 4 === 0);
        const isOnLeave = (emp.id === 3 && day === 5) || (emp.id === 4 && (day === 12 || day === 13));
        const status = isOnLeave ? 'on_leave' : isLate ? 'late' : 'present';
        const clockIn = isOnLeave ? null : `${dateStr}T${isLate ? '09:55:00' : emp.shift_start + ':00'}.000Z`;
        const clockOut = isOnLeave ? null : `${dateStr}T${emp.id === 2 && day % 3 === 0 ? '19:00:00' : emp.shift_end + ':00'}.000Z`;
        const activeSec = isOnLeave ? 0 : (emp.id === 2 && day % 3 === 0 ? 30600 : 25200);
        const idleSec = isOnLeave ? 0 : (emp.id === 3 ? 2700 : 1200);
        const breakSec = isOnLeave ? 0 : 1800;
        const otSec = Math.max(0, activeSec - 25200);

        insertHist.run(
          emp.id,
          dateStr,
          clockIn,
          clockOut,
          status,
          activeSec,
          idleSec,
          breakSec,
          otSec,
          isOnLeave ? 'Approved Leave' : 'Regular shift'
        );
      }
    }
  }

  const chatCnt = db.prepare('SELECT COUNT(*) as cnt FROM chat_messages').get();
  if (chatCnt.cnt === 0) {
    const now = new Date();
    const ago = (m) => new Date(now.getTime() - m * 60000).toISOString();
    const insertMsg = db.prepare(`
      INSERT INTO chat_messages (sender_id, recipient_id, message, is_bot, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertMsg.run(0, 1, 'Hello! I am Zaviroq Assistant Bot. Ask me about live attendance, idle employees, pending tasks, leaves, office timings, or payroll.', 1, ago(45));
    insertMsg.run(2, 1, 'Hi Aarav, the heartbeat idle detection endpoint is live and passing all tests.', 0, ago(25));
    insertMsg.run(1, 2, 'Great work Priya! Please also review Rohan’s OAuth token refresh task before 5:30 PM.', 0, ago(20));
    insertMsg.run(3, 1, 'Hey Aarav, I had a brief traffic delay this morning. Catching up on the Auth race condition now.', 0, ago(12));
  }
}

initSchema();
runMigrations();
seedIfEmpty();
