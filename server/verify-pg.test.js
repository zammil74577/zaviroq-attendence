import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

async function run() {
  let passed = 0;
  let skipped = 0;
  const ok = (name) => {
    passed++;
    console.log(`✅ PASS: ${name}`);
  };
  const skip = (name, reason) => {
    skipped++;
    console.log(`⏭️  SKIP: ${name} (${reason})`);
  };

  // 1. Static & module integrity checks (always run, no live Postgres required)
  const vercelJson = JSON.parse(fs.readFileSync(path.resolve('vercel.json'), 'utf8'));
  assert.ok(Array.isArray(vercelJson.crons) && vercelJson.crons.length === 2, 'vercel.json must define 2 crons');
  assert.ok(vercelJson.crons.some((c) => c.path === '/api/cron/auto-clockout'), 'auto-clockout cron configured');
  assert.ok(vercelJson.crons.some((c) => c.path === '/api/cron/daily'), 'daily cron configured');
  assert.ok(
    vercelJson.rewrites.some((r) => r.source === '/api/(.*)' && r.destination === '/api/index.js'),
    'vercel.json routes /api/* to /api/index.js'
  );
  ok('vercel.json crons and rewrites valid');

  const migrationSql = fs.readFileSync(path.resolve('supabase/migrations/001_init.sql'), 'utf8');
  const expectedTables = [
    'employees', 'attendance', 'activity_logs', 'tasks', 'leaves', 'leave_balances',
    'salaries', 'payroll_locks', 'chat_messages', 'announcements', 'audit_logs',
    'settings', 'holidays', 'notifications', 'sessions', 'rate_limits',
  ];
  for (const t of expectedTables) {
    assert.ok(
      migrationSql.includes(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`),
      `RLS enabled on ${t}`
    );
  }
  assert.ok(migrationSql.includes('prevent_audit_mutation'), 'audit_logs immutability trigger present');
  assert.ok(migrationSql.includes('TIMESTAMPTZ'), 'TIMESTAMPTZ used in migration');
  ok('supabase/migrations/001_init.sql schema, RLS, and audit trigger valid');

  // Verify serverless entrypoint + modules import cleanly
  const { default: apiEntry } = await import('../api/index.js');
  const { app, validateStrongPin } = await import('../server/app.js');
  assert.equal(typeof apiEntry, 'function', 'api/index.js exports Express app');
  assert.equal(apiEntry, app, 'api/index.js re-exports server/app.js');
  assert.ok(validateStrongPin('123456') !== null, 'sequential PIN rejected');
  assert.ok(validateStrongPin('111111') !== null, 'repeated PIN rejected');
  assert.equal(validateStrongPin('849201'), null, 'strong 6-digit PIN accepted');
  ok('api/index.js & server/app.js import cleanly and PIN policy works');

  // 2. Live Postgres checks (run when DATABASE_URL is configured)
  if (!process.env.DATABASE_URL) {
    skip('Live Postgres /healthz, cron auth, and audit trigger tests', 'DATABASE_URL not set (no local Docker/Postgres)');
    console.log(`\nSummary: ${passed} passed, ${skipped} skipped, 0 failed.`);
    return;
  }

  process.env.CRON_SECRET = process.env.CRON_SECRET || 'test-cron-secret-123456';
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const healthRes = await fetch(`${baseUrl}/api/healthz`);
    assert.equal(healthRes.status, 200, '/api/healthz returns 200');
    const healthJson = await healthRes.json();
    assert.equal(healthJson.ok, true);
    assert.ok(healthJson.db === 'ok' || healthJson.db === 'postgres', 'db status is ok');
    ok('Live /api/healthz connects to Postgres');

    const unauthCron = await fetch(`${baseUrl}/api/cron/auto-clockout`);
    assert.equal(unauthCron.status, 401, 'Cron rejects missing CRON_SECRET');

    const authCron = await fetch(`${baseUrl}/api/cron/auto-clockout`, {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    assert.equal(authCron.status, 200, 'Cron accepts valid CRON_SECRET');
    ok('Cron endpoint protected by CRON_SECRET');

    const { getPool } = await import('../server/pg.js');
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO audit_logs (actor_name, action, entity_type, entity_id, new_value)
       VALUES ('Test', 'PG_VERIFY', 'system', '0', '{}'::jsonb) RETURNING id`
    );
    const auditId = rows[0].id;
    let blockedUpdate = false;
    try {
      await pool.query(`UPDATE audit_logs SET action = 'TAMPERED' WHERE id = $1`, [auditId]);
    } catch {
      blockedUpdate = true;
    }
    assert.equal(blockedUpdate, true, 'Postgres trigger blocks UPDATE on audit_logs');

    let blockedDelete = false;
    try {
      await pool.query(`DELETE FROM audit_logs WHERE id = $1`, [auditId]);
    } catch {
      blockedDelete = true;
    }
    assert.equal(blockedDelete, true, 'Postgres trigger blocks DELETE on audit_logs');
    ok('Live Postgres audit_logs immutability trigger blocks UPDATE and DELETE');
  } finally {
    const { getPool } = await import('../server/pg.js');
    await getPool().end().catch(() => {});
    server.close();
  }

  console.log(`\nSummary: ${passed} passed, ${skipped} skipped, 0 failed.`);
}

run().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
