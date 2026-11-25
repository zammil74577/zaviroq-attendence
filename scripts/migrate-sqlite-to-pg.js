/**
 * One-time SQLite -> Supabase Postgres Data Migration Script
 *
 * Reads from local SQLite (DATABASE_PATH or ./data/zaviroq.db) and inserts into
 * Postgres (DATABASE_URL) idempotently.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npm run migrate:pg
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { getPool } from '../server/pg.js';

const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const sqlitePath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.resolve(process.cwd(), 'data', 'zaviroq.db');

function toBool(v) {
  return Boolean(v && v !== 0 && v !== '0' && v !== 'false');
}

function toIsoOrNull(v) {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)) {
    return v.replace(' ', 'T') + 'Z';
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function migrate() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is required.');
    process.exit(1);
  }
  if (!fs.existsSync(sqlitePath)) {
    console.error(`❌ SQLite file not found at ${sqlitePath}`);
    process.exit(1);
  }

  const sqlite = new Database(sqlitePath, { readonly: true });
  const pool = getPool();
  const client = await pool.connect();

  const tableExists = (name) =>
    Boolean(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));

  try {
    await client.query('BEGIN');

    if (tableExists('employees')) {
      const rows = sqlite.prepare('SELECT * FROM employees').all();
      for (const r of rows) {
        await client.query(
          `INSERT INTO employees (
            id, employee_code, name, email, role, department, designation,
            avatar_color, pin, must_change_pin, consent_accepted_at,
            base_salary, shift_start, shift_end, break_limit_minutes,
            status, live_state, last_seen, created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
          ON CONFLICT (employee_code) DO NOTHING`,
          [
            r.id, r.employee_code, r.name, r.email, r.role || 'employee',
            r.department || 'Engineering', r.designation || 'Software Engineer',
            r.avatar_color || '#6366f1', r.pin, toBool(r.must_change_pin),
            toIsoOrNull(r.consent_accepted_at), Number(r.base_salary || 0),
            r.shift_start || '09:30', r.shift_end || '18:30',
            Number(r.break_limit_minutes || 60), r.status || 'active',
            r.live_state || 'Offline', toIsoOrNull(r.last_seen),
            toIsoOrNull(r.created_at) || new Date().toISOString(),
          ]
        );
      }
      console.log(`Migrated ${rows.length} employees`);
    }

    if (tableExists('attendance')) {
      const rows = sqlite.prepare('SELECT * FROM attendance').all();
      for (const r of rows) {
        await client.query(
          `INSERT INTO attendance (
            id, employee_id, date, clock_in, clock_out, status,
            is_late, late_minutes, total_active_seconds, total_idle_seconds,
            total_break_seconds, overtime_seconds, break_start, last_heartbeat,
            tracking_mode, notes
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
          ON CONFLICT (id) DO NOTHING`,
          [
            r.id, r.employee_id, r.date, toIsoOrNull(r.clock_in), toIsoOrNull(r.clock_out),
            r.status || 'present', toBool(r.is_late), Number(r.late_minutes || 0),
            Number(r.total_active_seconds || 0), Number(r.total_idle_seconds || 0),
            Number(r.total_break_seconds || 0), Number(r.overtime_seconds || 0),
            toIsoOrNull(r.break_start), toIsoOrNull(r.last_heartbeat),
            r.tracking_mode || 'tab_only', r.notes || null,
          ]
        );
      }
      console.log(`Migrated ${rows.length} attendance rows`);
    }

    if (tableExists('activity_logs')) {
      const rows = sqlite.prepare('SELECT * FROM activity_logs').all();
      for (const r of rows) {
        await client.query(
          `INSERT INTO activity_logs (id, employee_id, attendance_id, event_type, state, duration_seconds, reason, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
          [
            r.id, r.employee_id, r.attendance_id || null, r.event_type,
            r.state || null, Number(r.duration_seconds || 0), r.reason || null,
            toIsoOrNull(r.created_at) || new Date().toISOString(),
          ]
        );
      }
      console.log(`Migrated ${rows.length} activity_logs rows`);
    }

    if (tableExists('tasks')) {
      const rows = sqlite.prepare('SELECT * FROM tasks').all();
      for (const r of rows) {
        await client.query(
          `INSERT INTO tasks (id, employee_id, title, description, priority, status, due_date, estimated_minutes, actual_minutes, created_by, completed_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
          [
            r.id, r.employee_id, r.title, r.description || null,
            r.priority || 'medium', r.status || 'pending', r.due_date || null,
            Number(r.estimated_minutes || 60), Number(r.actual_minutes || 0),
            r.created_by || null, toIsoOrNull(r.completed_at),
            toIsoOrNull(r.created_at) || new Date().toISOString(),
          ]
        );
      }
      console.log(`Migrated ${rows.length} tasks`);
    }

    if (tableExists('leaves')) {
      const rows = sqlite.prepare('SELECT * FROM leaves').all();
      for (const r of rows) {
        await client.query(
          `INSERT INTO leaves (id, employee_id, leave_type, start_date, end_date, days_count, reason, status, approved_by, review_note, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
          [
            r.id, r.employee_id, r.leave_type, r.start_date, r.end_date,
            Number(r.days_count || 1), r.reason || null, r.status || 'pending',
            r.approved_by || null, r.review_note || null,
            toIsoOrNull(r.created_at) || new Date().toISOString(),
          ]
        );
      }
      console.log(`Migrated ${rows.length} leaves`);
    }

    if (tableExists('leave_balances')) {
      const rows = sqlite.prepare('SELECT * FROM leave_balances').all();
      for (const r of rows) {
        await client.query(
          `INSERT INTO leave_balances (id, employee_id, year, annual, sick, casual)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (employee_id, year) DO NOTHING`,
          [r.id, r.employee_id, r.year, Number(r.annual ?? 18), Number(r.sick ?? 12), Number(r.casual ?? 8)]
        );
      }
      console.log(`Migrated ${rows.length} leave_balances`);
    }

    if (tableExists('salaries')) {
      const rows = sqlite.prepare('SELECT * FROM salaries').all();
      for (const r of rows) {
        await client.query(
          `INSERT INTO salaries (id, employee_id, month, base_pay, allowances, overtime_pay, deductions, lop_deduction, net_pay, working_days, present_days, absent_days, late_days, status, paid_at, notes, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           ON CONFLICT (employee_id, month) DO NOTHING`,
          [
            r.id, r.employee_id, r.month, Number(r.base_pay || 0), Number(r.allowances || 0),
            Number(r.overtime_pay || 0), Number(r.deductions || 0), Number(r.lop_deduction || 0),
            Number(r.net_pay || 0), Number(r.working_days || 22), Number(r.present_days || 0),
            Number(r.absent_days || 0), Number(r.late_days || 0), r.status || 'draft',
            toIsoOrNull(r.paid_at), r.notes || null,
            toIsoOrNull(r.created_at) || new Date().toISOString(),
          ]
        );
      }
      console.log(`Migrated ${rows.length} salaries`);
    }

    if (tableExists('payroll_locks')) {
      const rows = sqlite.prepare('SELECT * FROM payroll_locks').all();
      for (const r of rows) {
        await client.query(
          `INSERT INTO payroll_locks (month, locked_by, locked_at) VALUES ($1,$2,$3) ON CONFLICT (month) DO NOTHING`,
          [r.month, r.locked_by || null, toIsoOrNull(r.locked_at) || new Date().toISOString()]
        );
      }
    }

    if (tableExists('chat_messages')) {
      const rows = sqlite.prepare('SELECT * FROM chat_messages').all();
      for (const r of rows) {
        await client.query(
          `INSERT INTO chat_messages (id, sender_id, receiver_id, channel, message, image_data, is_read, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
          [
            r.id, r.sender_id, r.receiver_id || null, r.channel || 'general',
            r.message || '', r.image_data || null, toBool(r.is_read),
            toIsoOrNull(r.created_at) || new Date().toISOString(),
          ]
        );
      }
      console.log(`Migrated ${rows.length} chat_messages`);
    }

    if (tableExists('announcements')) {
      const rows = sqlite.prepare('SELECT * FROM announcements').all();
      for (const r of rows) {
        await client.query(
          `INSERT INTO announcements (id, title, body, priority, created_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
          [r.id, r.title, r.body, r.priority || 'normal', r.created_by || null, toIsoOrNull(r.created_at) || new Date().toISOString()]
        );
      }
    }

    if (tableExists('audit_logs')) {
      const rows = sqlite.prepare('SELECT * FROM audit_logs').all();
      for (const r of rows) {
        await client.query(
          `INSERT INTO audit_logs (id, actor_id, actor_name, action, target_type, target_id, details, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
          [r.id, r.actor_id || null, r.actor_name || 'System', r.action, r.target_type || null, r.target_id || null, r.details || null, toIsoOrNull(r.created_at) || new Date().toISOString()]
        );
      }
      console.log(`Migrated ${rows.length} audit_logs`);
    }

    if (tableExists('settings')) {
      const rows = sqlite.prepare('SELECT * FROM settings').all();
      for (const r of rows) {
        await client.query(
          `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [r.key, String(r.value)]
        );
      }
    }

    if (tableExists('holidays')) {
      const rows = sqlite.prepare('SELECT * FROM holidays').all();
      for (const r of rows) {
        await client.query(
          `INSERT INTO holidays (id, date, name, type) VALUES ($1,$2,$3,$4) ON CONFLICT (date) DO NOTHING`,
          [r.id, r.date, r.name, r.type || 'public']
        );
      }
    }

    if (tableExists('notifications')) {
      const rows = sqlite.prepare('SELECT * FROM notifications').all();
      for (const r of rows) {
        await client.query(
          `INSERT INTO notifications (id, employee_id, title, body, type, link, is_read, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
          [r.id, r.employee_id, r.title, r.body || null, r.type || 'info', r.link || null, toBool(r.is_read), toIsoOrNull(r.created_at) || new Date().toISOString()]
        );
      }
    }

    // Reset BIGSERIAL sequences to max(id)
    const seqTables = [
      'employees', 'attendance', 'activity_logs', 'tasks', 'leaves',
      'leave_balances', 'salaries', 'chat_messages', 'announcements',
      'audit_logs', 'holidays', 'notifications',
    ];
    for (const t of seqTables) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1), true)`,
        [t]
      );
    }

    await client.query('COMMIT');
    console.log('✅ SQLite -> Postgres migration complete.');
    console.log('   Next: if you have base64 chat images, run: npm run migrate:chat-images');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    sqlite.close();
    await pool.end();
  }
}

migrate();
