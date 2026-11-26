import crypto from 'node:crypto';
import { getOne, query, sanitizeEmployee } from './pg.js';

export const SESSION_COOKIE_NAME = 'zaviroq_sid';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export async function createSessionToken(employeeId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await query(
    `INSERT INTO sessions (id, employee_id, expires_at) VALUES ($1, $2, $3::timestamptz)`,
    [token, Number(employeeId), expiresAt]
  );
  await query(`DELETE FROM sessions WHERE expires_at < NOW()`);
  return token;
}

export async function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const row = await getOne(
    `SELECT id, employee_id, expires_at FROM sessions WHERE id = $1`,
    [token]
  );
  if (!row) return null;
  if (Date.now() > new Date(row.expires_at).getTime()) {
    await query(`DELETE FROM sessions WHERE id = $1`, [token]);
    return null;
  }
  return { uid: row.employee_id, exp: row.expires_at };
}

export async function revokeSessionToken(token) {
  if (!token) return;
  await query(`DELETE FROM sessions WHERE id = $1`, [token]);
}

export async function setSessionCookie(res, employeeId) {
  const token = await createSessionToken(employeeId);
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
}

export function hashDeviceToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

const DEVICE_ALLOWED_PATHS = new Set([
  '/activity/heartbeat',
  '/attendance/clock-in',
  '/attendance/clock-out',
  '/devices/me',
  '/devices/revoke-self',
]);

export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer zav_dev_')) {
      if (!DEVICE_ALLOWED_PATHS.has(req.path)) {
        return res.status(401).json({ error: 'Device token not permitted on this endpoint' });
      }
      const raw = authHeader.slice('Bearer '.length).trim();
      const dev = await getOne(
        `SELECT id, employee_id, device_name, platform, revoked_at FROM device_tokens WHERE token_hash = $1`,
        [hashDeviceToken(raw)]
      );
      if (!dev || dev.revoked_at) {
        return res.status(401).json({ error: 'Device token revoked or invalid' });
      }
      const emp = await getOne(`SELECT * FROM employees WHERE id = $1 AND is_active = TRUE`, [dev.employee_id]);
      if (!emp) {
        return res.status(401).json({ error: 'Invalid or deactivated employee' });
      }
      await query(`UPDATE device_tokens SET last_seen_at = NOW() WHERE id = $1`, [dev.id]);
      req.user = sanitizeEmployee(emp);
      req.deviceAuth = { deviceId: dev.id, deviceName: dev.device_name, platform: dev.platform };
      return next();
    }

    const token = req.cookies?.[SESSION_COOKIE_NAME];
    const payload = await verifySessionToken(token);
    if (!payload) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const emp = await getOne(
      `SELECT * FROM employees WHERE id = $1 AND is_active = TRUE`,
      [payload.uid]
    );
    if (!emp) {
      return res.status(401).json({ error: 'Invalid or deactivated session' });
    }
    req.user = sanitizeEmployee(emp);
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
    }
    next();
  };
}
