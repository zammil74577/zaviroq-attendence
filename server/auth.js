import crypto from 'node:crypto';
import { db, sanitizeEmployee } from './db.js';

export const SESSION_COOKIE_NAME = 'zaviroq_sid';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export function createSessionToken(employeeId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  db.prepare(`INSERT INTO sessions (id, employee_id, expires_at) VALUES (?, ?, ?)`).run(
    token,
    Number(employeeId),
    expiresAt
  );
  // Opportunistic cleanup of expired sessions
  db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(Date.now());
  return token;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const row = db.prepare(`SELECT id, employee_id, expires_at FROM sessions WHERE id = ?`).get(token);
  if (!row) return null;
  if (Date.now() > row.expires_at) {
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(token);
    return null;
  }
  return { uid: row.employee_id, exp: row.expires_at };
}

export function revokeSessionToken(token) {
  if (!token) return;
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(token);
}

export function setSessionCookie(res, employeeId) {
  const token = createSessionToken(employeeId);
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

export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer zav_dev_')) {
    if (!DEVICE_ALLOWED_PATHS.has(req.path)) {
      return res.status(401).json({ error: 'Device token not permitted on this endpoint' });
    }
    const raw = authHeader.slice('Bearer '.length).trim();
    const dev = db
      .prepare(`SELECT id, employee_id, device_name, platform, revoked_at FROM device_tokens WHERE token_hash = ?`)
      .get(hashDeviceToken(raw));
    if (!dev || dev.revoked_at) {
      return res.status(401).json({ error: 'Device token revoked or invalid' });
    }
    const emp = db.prepare('SELECT * FROM employees WHERE id = ? AND is_active = 1').get(dev.employee_id);
    if (!emp) {
      return res.status(401).json({ error: 'Invalid or deactivated employee' });
    }
    db.prepare(`UPDATE device_tokens SET last_seen_at = ? WHERE id = ?`).run(new Date().toISOString(), dev.id);
    req.user = sanitizeEmployee(emp);
    req.deviceAuth = { deviceId: dev.id, deviceName: dev.device_name, platform: dev.platform };
    return next();
  }

  const token = req.cookies?.[SESSION_COOKIE_NAME];
  const payload = verifySessionToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const emp = db.prepare('SELECT * FROM employees WHERE id = ? AND is_active = 1').get(payload.uid);
  if (!emp) {
    return res.status(401).json({ error: 'Invalid or deactivated session' });
  }
  req.user = sanitizeEmployee(emp);
  next();
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
