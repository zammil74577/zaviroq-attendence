/**
 * Apply supabase/migrations/001_init.sql to Postgres (DATABASE_URL).
 * Pass --reset to drop existing Zaviroq tables in public before applying.
 *
 * Usage:
 *   node scripts/apply-schema-pg.js --reset
 */
import fs from 'node:fs';
import path from 'node:path';
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

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is required.');
    process.exit(1);
  }

  const reset = process.argv.includes('--reset');
  const sqlPath = path.resolve(process.cwd(), 'supabase', 'migrations', '001_init.sql');
  const migrationSql = fs.readFileSync(sqlPath, 'utf8');

  const pool = getPool();
  const client = await pool.connect();

  try {
    if (reset) {
      console.log('Dropping existing Zaviroq tables in public schema...');
      await client.query(`
        DROP TABLE IF EXISTS
          rate_limits, sessions, notifications, holidays, settings,
          audit_logs, announcements, chat_messages, payroll_locks,
          salaries, leave_balances, leaves, tasks, activity_logs,
          attendance, employees
        CASCADE;
      `);
    }

    console.log('Applying supabase/migrations/001_init.sql...');
    await client.query(migrationSql);
    console.log('✅ Schema applied successfully.');
  } catch (err) {
    console.error('❌ Failed to apply schema:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
