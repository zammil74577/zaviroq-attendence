/**
 * Postgres Seed-Reset Script for Zaviroq Workforce OS (Supabase)
 *
 * Removes demo/existing employee & operational data (preserving immutable audit_logs
 * by default unless --wipe-all is passed in a fresh DB) and creates the first real
 * Master Admin from environment variables:
 *   ADMIN_CODE  (default: ZAV-001)
 *   ADMIN_NAME  (default: Master Admin)
 *   ADMIN_EMAIL (default: admin@zaviroq.com)
 *   ADMIN_PIN   (required in production, 6+ chars, non-sequential/non-repeated)
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." ADMIN_PIN="849201" npm run seed:reset:pg
 */
import fs from 'node:fs';
import path from 'node:path';
import { getPool, hashPin } from '../server/pg.js';

// Load local .env if present (without requiring dotenv package)
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

function validateAdminPin(pin) {
  if (!pin || typeof pin !== 'string' || pin.length < 6) {
    throw new Error('ADMIN_PIN must be at least 6 characters.');
  }
  if (/^(\d)\1+$/.test(pin)) {
    throw new Error('ADMIN_PIN cannot be all repeated digits.');
  }
  const seq = '01234567890123456789';
  const rev = '98765432109876543210';
  if (seq.includes(pin) || rev.includes(pin)) {
    throw new Error('ADMIN_PIN cannot be a simple sequential pattern.');
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is required.');
    process.exit(1);
  }

  const adminCode = (process.env.ADMIN_CODE || 'ZAV-001').trim();
  const adminName = (process.env.ADMIN_NAME || 'Master Admin').trim();
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@zaviroq.com').trim().toLowerCase();
  const adminPin = process.env.ADMIN_PIN;

  try {
    validateAdminPin(adminPin);
  } catch (err) {
    console.error('❌', err.message);
    process.exit(1);
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Clear operational tables in FK-safe order (audit_logs is append-only/immutable)
    await client.query('DELETE FROM sessions');
    await client.query('DELETE FROM rate_limits');
    await client.query('DELETE FROM notifications');
    await client.query('DELETE FROM activity_logs');
    await client.query('DELETE FROM attendance');
    await client.query('DELETE FROM tasks');
    await client.query('DELETE FROM leaves');
    await client.query('DELETE FROM leave_balances');
    await client.query('DELETE FROM salaries');
    await client.query('DELETE FROM payroll_locks');
    await client.query('DELETE FROM chat_messages');
    await client.query('DELETE FROM announcements');
    await client.query('DELETE FROM holidays');
    await client.query('DELETE FROM employees');

    const pinHash = hashPin(adminPin);

    const { rows } = await client.query(
      `INSERT INTO employees (
        emp_code, name, email, role, department, designation,
        shift_start, shift_end, status, avatar_color, joining_date, pin, must_change_pin, is_active
      ) VALUES (
        $1, $2, $3, 'admin', 'Executive', 'Master Administrator',
        '09:30', '17:30', 'offline', '#6366f1', (NOW() AT TIME ZONE 'Asia/Kolkata')::date, $4, TRUE, TRUE
      ) RETURNING id, emp_code, name, email, role, must_change_pin`,
      [adminCode, adminName, adminEmail, pinHash]
    );

    const admin = rows[0];

    await client.query(
      `INSERT INTO leave_balances (employee_id)
       VALUES ($1)
       ON CONFLICT (employee_id) DO NOTHING`,
      [admin.id]
    );

    await client.query(
      `INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, new_value)
       VALUES ($1, $2, 'SEED_RESET_ADMIN', 'employee', $3, $4::jsonb)`,
      [
        admin.id,
        'System',
        String(admin.id),
        JSON.stringify({ emp_code: admin.emp_code, email: admin.email, must_change_pin: true }),
      ]
    );

    await client.query('COMMIT');
    console.log('✅ Postgres seed-reset complete.');
    console.log(`   Admin Code : ${admin.emp_code}`);
    console.log(`   Admin Name : ${admin.name}`);
    console.log(`   Admin Email: ${admin.email}`);
    console.log('   must_change_pin = TRUE (forced PIN change on first login)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed-reset failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
