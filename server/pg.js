import pg from 'pg';
import bcrypt from 'bcryptjs';

const { Pool } = pg;

export const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';

let pool = null;

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
      ssl: conn.includes('localhost') || conn.includes('127.0.0.1')
        ? false
        : { rejectUnauthorized: false },
    });
  }
  return pool;
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
