import pg from 'pg';
import bcrypt from 'bcryptjs';

const { Pool } = pg;

export const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';

let pool = null;
let schemaEnsured = false;

export function getPool() {
  if (!pool) {
    const conn = process.env.DATABASE_URL;
    if (!conn) {
      throw new Error('DATABASE_URL environment variable is required for Postgres.');
    }
    pool = new Pool({
      connectionString: conn,
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 8000,
      query_timeout: 8000,
      ssl: conn.includes('localhost') || conn.includes('127.0.0.1')
        ? false
        : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export async function ensureSchemaOnce() {
  if (schemaEnsured) return;
  try {
    await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS joining_date DATE DEFAULT CURRENT_DATE`);
    await query(`UPDATE employees SET joining_date = (created_at AT TIME ZONE '${APP_TIMEZONE}')::date WHERE joining_date IS NULL`);
    await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS must_change_pin BOOLEAN NOT NULL DEFAULT FALSE`);
    await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS consent_accepted_at TIMESTAMPTZ`);
    await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS active_session_id TEXT`);
    await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ`);
    await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS last_heartbeat_state TEXT`);
    await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);
    await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT ''`);
    await query(`ALTER TABLE attendance ADD COLUMN IF NOT EXISTS tracking_mode TEXT NOT NULL DEFAULT 'tab_only'`);
    await query(`ALTER TABLE attendance ADD COLUMN IF NOT EXISTS missed_clock_out BOOLEAN NOT NULL DEFAULT FALSE`);
    await query(`ALTER TABLE attendance ADD COLUMN IF NOT EXISTS manual_override BOOLEAN NOT NULL DEFAULT FALSE`);
    await query(`ALTER TABLE attendance ADD COLUMN IF NOT EXISTS overtime_seconds INTEGER NOT NULL DEFAULT 0`);
    await query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link TEXT DEFAULT ''`);

    await query(`
      CREATE TABLE IF NOT EXISTS alert_rules (
        id SERIAL PRIMARY KEY,
        type TEXT UNIQUE NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        threshold_minutes INTEGER NOT NULL DEFAULT 5,
        channels JSONB NOT NULL DEFAULT '["in_app"]'::jsonb,
        quiet_hours JSONB NOT NULL DEFAULT '{"start":"22:00","end":"08:00"}'::jsonb,
        recipients TEXT NOT NULL DEFAULT 'all',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS alert_episodes (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
        rule_type TEXT NOT NULL,
        episode_key TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMPTZ
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_alert_episodes_lookup ON alert_episodes(rule_type, episode_key, active)`);
    await query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        endpoint TEXT UNIQUE NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS device_tokens (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        token_hash TEXT UNIQUE NOT NULL,
        device_name TEXT NOT NULL DEFAULT 'Desktop Device',
        platform TEXT NOT NULL DEFAULT 'windows',
        app_version TEXT NOT NULL DEFAULT '1.0.0',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_device_tokens_emp ON device_tokens(employee_id)`);
    await query(`
      CREATE TABLE IF NOT EXISTS pairing_codes (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        code TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await query(`ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY`);
    await query(`ALTER TABLE alert_episodes ENABLE ROW LEVEL SECURITY`);
    await query(`ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY`);
    await query(`ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY`);
    await query(`ALTER TABLE pairing_codes ENABLE ROW LEVEL SECURITY`);

    await query(`
      INSERT INTO alert_rules (type, enabled, threshold_minutes, channels, quiet_hours, recipients) VALUES
        ('tracker_offline', TRUE, 5, '["in_app","push"]'::jsonb, '{"start":"22:00","end":"08:00"}'::jsonb, 'all'),
        ('idle_too_long', TRUE, 15, '["in_app"]'::jsonb, '{"start":"22:00","end":"08:00"}'::jsonb, 'all'),
        ('break_over_limit', TRUE, 60, '["in_app"]'::jsonb, '{"start":"22:00","end":"08:00"}'::jsonb, 'all'),
        ('not_clocked_in', TRUE, 0, '["in_app"]'::jsonb, '{"start":"22:00","end":"08:00"}'::jsonb, 'all'),
        ('missed_clock_out', TRUE, 0, '["in_app"]'::jsonb, '{"start":"22:00","end":"08:00"}'::jsonb, 'all'),
        ('daily_summary', TRUE, 0, '["in_app"]'::jsonb, '{"start":"22:00","end":"08:00"}'::jsonb, 'all')
      ON CONFLICT (type) DO NOTHING
    `);

    await query(`
      WITH ordered_idle AS (
        SELECT
          id,
          type,
          LAG(type) OVER (PARTITION BY employee_id, date ORDER BY id) AS prev_type
        FROM activity_logs
        WHERE date = (NOW() AT TIME ZONE '${APP_TIMEZONE}')::date
          AND type IN ('idle_start', 'idle_end')
      )
      DELETE FROM activity_logs
      WHERE id IN (
        SELECT id FROM ordered_idle
        WHERE (type = prev_type) OR (type = 'idle_end' AND prev_type IS NULL)
      )
    `);

    schemaEnsured = true;
  } catch (err) {
    console.error('[ensureSchemaOnce] non-fatal:', err?.message || err);
  }
}

const REQUIRED_TABLES = [
  'employees',
  'attendance',
  'activity_logs',
  'tasks',
  'leaves',
  'holidays',
  'settings',
  'notifications',
  'audit_logs',
  'chat_messages',
  'alert_rules',
  'alert_episodes',
  'push_subscriptions',
  'device_tokens',
  'pairing_codes',
];

const REQUIRED_COLUMNS = [
  ['notifications', 'link'],
  ['employees', 'joining_date'],
  ['employees', 'must_change_pin'],
  ['attendance', 'tracking_mode'],
];

export async function checkPgSchemaHealth() {
  const tablesRes = await getAll(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
  );
  const tableSet = new Set(tablesRes.map((r) => r.table_name));
  const missingTables = REQUIRED_TABLES.filter((t) => !tableSet.has(t));

  const colsRes = await getAll(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`
  );
  const colSet = new Set(colsRes.map((r) => `${r.table_name}.${r.column_name}`));
  const missingColumns = REQUIRED_COLUMNS
    .map(([t, c]) => `${t}.${c}`)
    .filter((k) => !colSet.has(k));

  return {
    ok: missingTables.length === 0 && missingColumns.length === 0,
    missingTables,
    missingColumns,
  };
}

export async function query(sql, params = []) {
  return getPool().query(sql, params);
}

export async function getOne(sql, params = []) {
  const res = await query(sql, params);
  return res.rows[0] || null;
}

export async function getAll(sql, params = []) {
  const res = await query(sql, params);
  return res.rows;
}

export function getTodayDateInTz(dateObj = new Date(), timeZone = APP_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(dateObj);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

export function getCurrentMonthInTz(dateObj = new Date(), timeZone = APP_TIMEZONE) {
  return getTodayDateInTz(dateObj, timeZone).slice(0, 7);
}

export function getLocalMinutesInTz(dateObj = new Date(), timeZone = APP_TIMEZONE) {
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

export function computeArrivalStatus(shiftStart = '09:30', dateObj = new Date(), graceMinutes = 15, timeZone = APP_TIMEZONE) {
  const [sh, sm] = shiftStart.split(':').map(Number);
  const shiftMinutes = sh * 60 + sm + graceMinutes;
  const currentMinutes = getLocalMinutesInTz(dateObj, timeZone);
  return currentMinutes > shiftMinutes ? 'late' : 'present';
}

export function formatClockInReasonInTz(
  shiftStart = '09:30',
  shiftEnd = '17:30',
  bufferMinutes = 120,
  dateObj = new Date(),
  graceMinutes = 15,
  timeZone = APP_TIMEZONE
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

export async function getSettings() {
  const rows = await getAll('SELECT key, value FROM settings');
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
    heroBannerUrl: map.heroBannerUrl || '',
  };
}

export async function writeAuditLog({ actorId, actorName, action, entityType, entityId, oldValue, newValue }) {
  await query(
    `INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, old_value, new_value, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [
      actorId ?? null,
      actorName || 'System',
      action,
      entityType,
      entityId != null ? String(entityId) : null,
      oldValue !== undefined ? JSON.stringify(oldValue) : null,
      newValue !== undefined ? JSON.stringify(newValue) : null,
    ]
  );
}

// Postgres-backed rate limiter (stateless across Vercel serverless invocations)
export function pgRateLimit(prefix, maxRequests, windowMs) {
  return async (req, res, next) => {
    try {
      const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
      const key = `${prefix}:${ip}`;
      const resetAt = new Date(Date.now() + windowMs).toISOString();
      const row = await getOne(
        `INSERT INTO rate_limits (key, count, reset_at)
         VALUES ($1, 1, $2::timestamptz)
         ON CONFLICT (key) DO UPDATE SET
           count = CASE WHEN rate_limits.reset_at < NOW() THEN 1 ELSE rate_limits.count + 1 END,
           reset_at = CASE WHEN rate_limits.reset_at < NOW() THEN $2::timestamptz ELSE rate_limits.reset_at END
         RETURNING count, reset_at`,
        [key, resetAt]
      );
      if (row && row.count > maxRequests) {
        return res.status(429).json({ error: 'Too many requests, please try again later.' });
      }
      next();
    } catch {
      next();
    }
  };
}
