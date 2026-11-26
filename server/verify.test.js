import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// Isolate tests in a separate SQLite database so production data/zaviroq.db is never polluted
const testDbPath = path.resolve('data/test-zaviroq.db');
for (const ext of ['', '-wal', '-shm']) {
  if (fs.existsSync(testDbPath + ext)) fs.unlinkSync(testDbPath + ext);
}
process.env.DB_PATH = testDbPath;

const { app, computeArrivalStatus, countWorkingLeaveDays, recalculateAttendanceLateStatuses, formatClockInReason, evaluateAlertRulesForTest } = await import('./index.js');
const { db } = await import('./db.js');

let server;
let baseUrl;
let adminCookie = '';
let empCookie = '';

test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;

  // Ensure ZAV-001 and ZAV-003 are unlocked before test run
  db.prepare(`UPDATE employees SET failed_login_attempts = 0, locked_until = NULL WHERE emp_code IN ('ZAV-001', 'ZAV-003')`).run();
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  for (const ext of ['', '-wal', '-shm']) {
    if (fs.existsSync(testDbPath + ext)) fs.unlinkSync(testDbPath + ext);
  }
});

test('Public health & auth config work, protected routes return 401 without session', async () => {
  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);

  const cfg = await fetch(`${baseUrl}/api/auth/config`);
  assert.equal(cfg.status, 200);
  const cfgJson = await cfg.json();
  assert.equal(cfgJson.demoMode, false);

  for (const path of ['/api/dashboard', '/api/reports/monthly', '/api/leaves', '/api/chat/messages', '/api/auth/me']) {
    const res = await fetch(`${baseUrl}${path}`);
    assert.equal(res.status, 401, `Expected 401 for unauthenticated ${path}`);
  }
});

test('Auth login issues httpOnly session cookie, hides PIN, and locks after 5 failed attempts', async () => {
  // Test lockout on ZAV-006
  for (let i = 1; i <= 4; i++) {
    const bad = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'ZAV-006', pin: '9999' }),
    });
    assert.equal(bad.status, 401);
  }
  const fifth = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'ZAV-006', pin: '9999' }),
  });
  assert.equal(fifth.status, 429);

  // Admin login
  const okAdmin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'ZAV-001', pin: '0000', scanEntry: true }),
  });
  assert.equal(okAdmin.status, 200);
  const setCookieAdmin = okAdmin.headers.get('set-cookie') || '';
  assert.match(setCookieAdmin, /HttpOnly/i);
  assert.match(setCookieAdmin, /SameSite=Lax/i);
  adminCookie = setCookieAdmin.split(';')[0];
  const adminJson = await okAdmin.json();
  assert.equal(adminJson.employee.role, 'admin');
  assert.equal(adminJson.employee.pin, undefined);

  // Employee login
  const okEmp = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'ZAV-003', pin: '1234', scanEntry: true }),
  });
  assert.equal(okEmp.status, 200);
  empCookie = (okEmp.headers.get('set-cookie') || '').split(';')[0];
  const empJson = await okEmp.json();
  assert.equal(empJson.employee.role, 'employee');
  assert.equal(empJson.employee.pin, undefined);
});

test('Role checks enforce admin-only endpoints and strip PIN from /api/dashboard', async () => {
  const dashAdmin = await fetch(`${baseUrl}/api/dashboard`, { headers: { Cookie: adminCookie } });
  assert.equal(dashAdmin.status, 200);
  const dashJson = await dashAdmin.json();
  assert.ok(dashJson.employees.length >= 6);
  for (const e of dashJson.employees) {
    assert.equal(e.pin, undefined, 'PIN must never be returned in /api/dashboard');
  }

  // Employee cannot access admin endpoints
  for (const adminPath of ['/api/reports/monthly', '/api/salaries', '/api/export/monthly', '/api/export/attendance']) {
    const r = await fetch(`${baseUrl}${adminPath}`, { headers: { Cookie: empCookie } });
    assert.equal(r.status, 403, `Expected 403 for employee on ${adminPath}`);
  }

  // Employee /api/dashboard only returns their own record
  const dashEmp = await fetch(`${baseUrl}/api/dashboard`, { headers: { Cookie: empCookie } });
  assert.equal(dashEmp.status, 200);
  const empDashJson = await dashEmp.json();
  assert.equal(empDashJson.employees.length, 1);
  assert.equal(empDashJson.employees[0].emp_code, 'ZAV-003');
});

test('Server-authoritative heartbeat uses session user and credits previous state', async () => {
  const before = await (await fetch(`${baseUrl}/api/dashboard`, { headers: { Cookie: adminCookie } })).json();
  const emp1Before = before.employees.find((e) => e.id === 1);
  // Ensure ZAV-001 is clocked in and has last_heartbeat_at 10s ago in 'active' state
  const today = before.summary.date;
  db.prepare(`UPDATE attendance SET clock_out = NULL, missed_clock_out = 0 WHERE employee_id = 1 AND date = ?`).run(today);
  const tenSecAgo = new Date(Date.now() - 10000).toISOString();
  db.prepare(`UPDATE employees SET last_heartbeat_at = ?, last_heartbeat_state = 'active', status = 'active' WHERE id = 1`).run(tenSecAgo);

  // Send transition to 'idle' with spoofed employeeId & deltaSeconds (should be ignored!)
  const hbRes = await fetch(`${baseUrl}/api/activity/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ employeeId: 999, state: 'idle', deltaSeconds: 99999 }),
  });
  assert.equal(hbRes.status, 200);
  const hbJson = await hbRes.json();
  assert.equal(hbJson.creditedState, 'active');
  assert.ok(hbJson.creditedSeconds >= 9 && hbJson.creditedSeconds <= 15);
  assert.equal(hbJson.attendance.active_seconds, emp1Before.active_seconds + hbJson.creditedSeconds);
});

test('Task CRUD, Monthly Report, Salaries, Leaves, and Chat work with auth', async () => {
  const createRes = await fetch(`${baseUrl}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ title: 'Verify API test task', assignee_id: 2, priority: 'high' }),
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();

  const patchRes = await fetch(`${baseUrl}/api/tasks/${created.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ status: 'completed', logged_minutes: 30 }),
  });
  assert.equal(patchRes.status, 200);

  const delRes = await fetch(`${baseUrl}/api/tasks/${created.id}`, {
    method: 'DELETE',
    headers: { Cookie: adminCookie },
  });
  assert.equal(delRes.status, 200);

  const botPost = await fetch(`${baseUrl}/api/chat/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ recipient_id: 0, message: 'Who is idle right now?' }),
  });
  assert.equal(botPost.status, 201);
  const botData = await botPost.json();
  assert.match(botData.botMsg.message, /Live Desk Status/);
});

test('Phase 2: Heartbeat active -> idle -> active -> break -> active credits each prior state accurately', async () => {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`UPDATE attendance SET clock_out = NULL, missed_clock_out = 0 WHERE employee_id = 1 AND date = ?`).run(today);
  const step = async (nextState, agoSec) => {
    const t = new Date(Date.now() - agoSec * 1000).toISOString();
    db.prepare(`UPDATE employees SET last_heartbeat_at = ? WHERE id = 1`).run(t);
    const r = await fetch(`${baseUrl}/api/activity/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ state: nextState, sessionId: 'test-tab-1', claimSession: true }),
    });
    return r.json();
  };

  // Start in active
  await step('active', 0);
  const s1 = await step('idle', 8);
  assert.equal(s1.creditedState, 'active');
  assert.ok(s1.creditedSeconds >= 7 && s1.creditedSeconds <= 10);

  const s2 = await step('active', 6);
  assert.equal(s2.creditedState, 'idle');
  assert.ok(s2.creditedSeconds >= 5 && s2.creditedSeconds <= 8);

  const s3 = await step('break', 5);
  assert.equal(s3.creditedState, 'active');

  const s4 = await step('active', 4);
  assert.equal(s4.creditedState, 'break');
  assert.ok(s4.creditedSeconds >= 3 && s4.creditedSeconds <= 6);
});

test('Phase 2 & 3: Late grace, leave weekend/holiday skip, payroll lock, and blocked task guard', async () => {
  // Late grace: 09:44 is present, 09:46 is late (shift 09:30 + 15m grace)
  const onTime = new Date('2026-11-25T09:44:00');
  const lateTime = new Date('2026-11-25T09:46:00');
  assert.equal(computeArrivalStatus('09:30', onTime, 15), 'present');
  assert.equal(computeArrivalStatus('09:30', lateTime, 15), 'late');

  // Fri 2026-11-27 to Sat 2026-11-28 skips Saturday weekend => 1 day
  assert.equal(countWorkingLeaveDays('2026-11-27', '2026-11-28'), 1);

  // Blocked task cannot go directly to completed
  const tRes = await fetch(`${baseUrl}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ title: 'Blocked Guard Test', status: 'blocked', assignee_id: 1 }),
  });
  const tJson = await tRes.json();
  const badComplete = await fetch(`${baseUrl}/api/tasks/${tJson.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ status: 'completed' }),
  });
  assert.equal(badComplete.status, 400);
  await fetch(`${baseUrl}/api/tasks/${tJson.id}`, { method: 'DELETE', headers: { Cookie: adminCookie } });

  // Payroll lock prevents attendance/salary edits for that month
  const testMonth = '2026-10';
  await fetch(`${baseUrl}/api/payroll/lock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ month: testMonth }),
  });
  const lockedAtt = await fetch(`${baseUrl}/api/attendance/1`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ date: `${testMonth}-15`, status: 'present' }),
  });
  assert.equal(lockedAtt.status, 409);
  await fetch(`${baseUrl}/api/payroll/lock/${testMonth}`, { method: 'DELETE', headers: { Cookie: adminCookie } });
});

test('Phase 4 & 5: Chat file upload, incremental polling, settings, audit logs & notifications', async () => {
  // 1x1 transparent PNG base64
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const imgRes = await fetch(`${baseUrl}/api/chat/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ recipient_id: 2, message: 'Check file upload', image_data: tinyPng }),
  });
  assert.equal(imgRes.status, 201);
  const imgJson = await imgRes.json();
  assert.ok(imgJson.userMsg.image_data.startsWith('/uploads/'));

  const incRes = await fetch(`${baseUrl}/api/chat/messages?peerId=2&after=${imgJson.userMsg.id}`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(incRes.status, 200);
  const incRows = await incRes.json();
  assert.equal(incRows.length, 0);

  const settingsRes = await fetch(`${baseUrl}/api/settings`, { headers: { Cookie: adminCookie } });
  assert.equal(settingsRes.status, 200);

  const auditRes = await fetch(`${baseUrl}/api/audit-logs?page=1&pageSize=5`, { headers: { Cookie: adminCookie } });
  assert.equal(auditRes.status, 200);
  const auditJson = await auditRes.json();
  assert.ok(Array.isArray(auditJson.rows));
  assert.equal(auditJson.page, 1);
  assert.equal(auditJson.pageSize, 5);
  assert.ok(typeof auditJson.total === 'number');

  const notifRes = await fetch(`${baseUrl}/api/notifications`, { headers: { Cookie: adminCookie } });
  assert.equal(notifRes.status, 200);
});

test('Employee isolation: 403 on other user chat, exports, reports, and task DELETE', async () => {
  // Employee reading another userId chat -> 403
  const otherChat = await fetch(`${baseUrl}/api/chat/messages?userId=1&peerId=0`, { headers: { Cookie: empCookie } });
  assert.equal(otherChat.status, 403);

  // Employee deleting a task -> 403
  const delTask = await fetch(`${baseUrl}/api/tasks/1`, {
    method: 'DELETE',
    headers: { Cookie: empCookie },
  });
  assert.equal(delTask.status, 403);
});

test('Round 3: Chat contacts, /reports/me, overdue consistency, late recalc, self-deactivation & 6-digit PINs', async () => {
  // 1. GET /api/chat/contacts for employee returns active teammates without pin/salary/attendance
  const contactsRes = await fetch(`${baseUrl}/api/chat/contacts`, { headers: { Cookie: empCookie } });
  assert.equal(contactsRes.status, 200);
  const contacts = await contactsRes.json();
  assert.ok(contacts.length >= 5);
  for (const c of contacts) {
    assert.equal(c.pin, undefined);
    assert.equal(c.base_monthly_salary, undefined);
    assert.equal(c.active_seconds, undefined);
  }

  // 2. GET /api/reports/me & GET /api/export/me return only employee's own row
  const myRepRes = await fetch(`${baseUrl}/api/reports/me`, { headers: { Cookie: empCookie } });
  assert.equal(myRepRes.status, 200);
  const myRep = await myRepRes.json();
  assert.equal(myRep.rows.length, 1);
  assert.equal(myRep.rows[0].emp_code, 'ZAV-003');

  const myCsvRes = await fetch(`${baseUrl}/api/export/me`, { headers: { Cookie: empCookie } });
  assert.equal(myCsvRes.status, 200);
  const myCsv = await myCsvRes.text();
  assert.ok(myCsv.includes('ZAV-003'));
  assert.ok(!myCsv.includes('ZAV-001'));

  // 3. Overdue consistency between dashboard summary and tasks
  const dash = await (await fetch(`${baseUrl}/api/dashboard`, { headers: { Cookie: adminCookie } })).json();
  const overdueFromTasks = dash.tasks.filter((t) => t.is_overdue).length;
  assert.equal(dash.summary.overdueTasks, overdueFromTasks);

  // 4. Self-deactivation block (400)
  const selfDeact = await fetch(`${baseUrl}/api/employees/1`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ is_active: 0 }),
  });
  assert.equal(selfDeact.status, 400);

  // 5. Late recalculation respects grace & leaves manual overrides untouched
  const testDate = '2026-11-24';
  db.prepare(`
    INSERT OR REPLACE INTO attendance (employee_id, date, clock_in, status, manual_override)
    VALUES (2, ?, '2026-11-24T09:40:00', 'late', 0)
  `).run(testDate);
  const changed = recalculateAttendanceLateStatuses({ id: 1, name: 'Test Admin' });
  assert.ok(changed >= 1);
  const updatedRow = db.prepare(`SELECT status FROM attendance WHERE employee_id = 2 AND date = ?`).get(testDate);
  assert.equal(updatedRow.status, 'present');

  // 6. Trivial PIN rejection & valid 6-digit PIN acceptance
  for (const badPin of ['1234', '111111', '123456', '000000']) {
    const r = await fetch(`${baseUrl}/api/auth/change-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: empCookie },
      body: JSON.stringify({ newPin: badPin }),
    });
    assert.equal(r.status, 400, `Expected 400 for trivial PIN ${badPin}`);
  }
  const goodPin = await fetch(`${baseUrl}/api/auth/change-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: empCookie },
    body: JSON.stringify({ newPin: '482915' }),
  });
  assert.equal(goodPin.status, 200);
});

test('Round 5: Double clock-in idempotency, after-hours block, 2s transition debounce & audit immutability', async () => {
  const today = new Date().toISOString().slice(0, 10);

  // 1. Double clock-in idempotency (when open, second clock-in returns idempotent=true & creates no extra log)
  db.prepare(`UPDATE attendance SET clock_out = NULL, missed_clock_out = 0 WHERE employee_id = 1 AND date = ?`).run(today);
  const logsBefore = db.prepare(`SELECT COUNT(*) as cnt FROM activity_logs WHERE employee_id = 1 AND date = ? AND type = 'clock_in'`).get(today).cnt;
  const dupClockIn = await fetch(`${baseUrl}/api/attendance/clock-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({}),
  });
  assert.equal(dupClockIn.status, 200);
  const dupJson = await dupClockIn.json();
  assert.equal(dupJson.idempotent, true);
  const logsAfter = db.prepare(`SELECT COUNT(*) as cnt FROM activity_logs WHERE employee_id = 1 AND date = ? AND type = 'clock_in'`).get(today).cnt;
  assert.equal(logsAfter, logsBefore);

  // 2. After-hours clock-in block when now > shift_end + buffer
  db.prepare(`DELETE FROM attendance WHERE employee_id = 6 AND date = ?`).run(today);
  db.prepare(`UPDATE employees SET shift_end = '00:01' WHERE id = 6`).run();
  const afterHoursRes = await fetch(`${baseUrl}/api/attendance/clock-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ employeeId: 6 }),
  });
  assert.equal(afterHoursRes.status, 400);
  const afterHoursJson = await afterHoursRes.json();
  assert.match(afterHoursJson.error, /Shift ended — clock-in not allowed/);
  db.prepare(`UPDATE employees SET shift_end = '17:30' WHERE id = 6`).run();

  // 3. Transition debouncing within 2s collapses break_start -> break_end into 1 row
  const countBefore = db.prepare(`SELECT COUNT(*) as cnt FROM activity_logs WHERE employee_id = 1 AND date = ?`).get(today).cnt;
  await fetch(`${baseUrl}/api/activity/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ state: 'break', sessionId: 'debounce-tab', claimSession: true }),
  });
  await fetch(`${baseUrl}/api/activity/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ state: 'active', sessionId: 'debounce-tab', claimSession: true }),
  });
  const countAfter = db.prepare(`SELECT COUNT(*) as cnt FROM activity_logs WHERE employee_id = 1 AND date = ?`).get(today).cnt;
  assert.ok(countAfter - countBefore <= 1, 'Rapid transitions within 2s must collapse into at most 1 log row');

  // 4. Audit log immutability trigger prevents DELETE and UPDATE
  assert.throws(() => {
    db.prepare(`DELETE FROM audit_logs`).run();
  }, /Audit logs are immutable/);
  assert.throws(() => {
    db.prepare(`UPDATE audit_logs SET action = 'TAMPERED'`).run();
  }, /Audit logs are immutable/);
});

test('Persistent SQLite sessions survive verification & revoke on logout', async () => {
  const token = adminCookie.split('=')[1];
  const row = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(token);
  assert.ok(row, 'Session token must be stored in SQLite sessions table');

  const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { Cookie: adminCookie },
  });
  assert.equal(logoutRes.status, 200);
  const afterRow = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(token);
  assert.equal(afterRow, undefined, 'Session token must be removed from SQLite on logout');

  const meAfter = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: adminCookie } });
  assert.equal(meAfter.status, 401);
});

test('Round 6: IST timezone clock-in labels (on time / late / after-hours) and audit paging', async () => {
  // 04:10 UTC = 09:40 IST (within 15m grace of 09:30)
  assert.equal(
    formatClockInReason('09:30', new Date('2026-11-25T04:10:00.000Z'), 15, '17:30', 120),
    'Clocked in on time'
  );
  // 04:20 UTC = 09:50 IST (20m late)
  assert.equal(
    formatClockInReason('09:30', new Date('2026-11-25T04:20:00.000Z'), 15, '17:30', 120),
    'Clocked in late (+20m)'
  );
  // 14:46 UTC = 20:16 IST (after 17:30 + 120m buffer = 19:30)
  assert.equal(
    formatClockInReason('09:30', new Date('2026-11-25T14:46:00.000Z'), 15, '17:30', 120),
    'After-hours clock-in'
  );
});

test('Pre-launch: tracking_mode recorded, consent gate, /healthz, and backup script', async () => {
  // 1. /healthz
  const hz = await fetch(`${baseUrl}/healthz`);
  assert.equal(hz.status, 200);
  const hzJson = await hz.json();
  assert.equal(hzJson.ok, true);
  assert.equal(hzJson.db, 'ok');

  // 2. Consent gate (POST /api/auth/consent sets tracking_consent_at)
  const consentRes = await fetch(`${baseUrl}/api/auth/consent`, {
    method: 'POST',
    headers: { Cookie: empCookie },
  });
  assert.equal(consentRes.status, 200);
  const consentJson = await consentRes.json();
  assert.ok(consentJson.employee.tracking_consent_at);

  // 3. tracking_mode recorded on attendance via heartbeat ('system' and 'tab_only')
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`UPDATE attendance SET clock_out = NULL, missed_clock_out = 0 WHERE employee_id = 3 AND date = ?`).run(today);
  const hbSys = await fetch(`${baseUrl}/api/activity/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: empCookie },
    body: JSON.stringify({ state: 'idle', trackingMode: 'system', sessionId: 'sys-tab', claimSession: true }),
  });
  assert.equal(hbSys.status, 200);
  const hbSysJson = await hbSys.json();
  assert.equal(hbSysJson.attendance.tracking_mode, 'system');

  // 4. Backup script creates valid SQLite backup file
  const { execFileSync } = await import('node:child_process');
  const backupDir = path.resolve('data/test-backups');
  if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
  const out = execFileSync(process.execPath, ['scripts/backup-db.js'], {
    env: { ...process.env, DATABASE_PATH: testDbPath, BACKUP_DIR: backupDir },
    encoding: 'utf8',
  });
  const parsed = JSON.parse(out.trim());
  assert.equal(parsed.ok, true);
  assert.ok(fs.existsSync(parsed.backupFile));
  assert.ok(parsed.sizeBytes > 0);
  fs.rmSync(backupDir, { recursive: true, force: true });
});

test('Production fixes: joining_date proration (joined 25th, 1 day attended -> ~1-2 days pay, not 19)', async () => {
  const { createSessionToken, SESSION_COOKIE_NAME } = await import('./auth.js');
  const freshAdminCookie = `${SESSION_COOKIE_NAME}=${createSessionToken(1)}`;
  const month = new Date().toISOString().slice(0, 7);
  const joinDay25 = `${month}-25`;

  const createRes = await fetch(`${baseUrl}/api/employees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: freshAdminCookie },
    body: JSON.stringify({
      name: 'Mid Month Joiner',
      email: 'joiner25@zaviroq.com',
      department: 'Engineering',
      designation: 'Engineer',
      joining_date: joinDay25,
    }),
  });
  assert.equal(createRes.status, 201);
  const joiner = await createRes.json();

  // Set salary for joiner (new employees no longer get a default salary)
  const salRes = await fetch(`${baseUrl}/api/salaries/${joiner.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: freshAdminCookie },
    body: JSON.stringify({
      base_monthly_salary: 50000,
      hra: 15000,
      transport_allowance: 3000,
      special_allowance: 7000,
      pf_deduction: 3600,
      tax_deduction: 2500,
      overtime_hourly_rate: 450,
      working_days_per_month: 22,
    }),
  });
  assert.equal(salRes.status, 200);

  // Record 1 attended day on the 25th
  db.prepare(`INSERT INTO attendance (employee_id, date, clock_in, status) VALUES (?, ?, ?, 'present')`)
    .run(joiner.id, joinDay25, `${joinDay25}T04:00:00.000Z`);

  const repRes = await fetch(`${baseUrl}/api/reports/monthly?month=${month}`, {
    headers: { Cookie: freshAdminCookie },
  });
  assert.equal(repRes.status, 200);
  const rep = await repRes.json();
  const row = rep.rows.find((r) => r.employee_id === joiner.id);
  assert.ok(row, 'joiner appears in monthly report');
  // Default gross = 75,000 / 22 = ~3,409/day. 1 attended day (+ at most 0-1 holiday) must be < 10,000, not 19 days (~60,000+)
  assert.ok(row.salary.prorated_net_salary > 2000 && row.salary.prorated_net_salary < 10000,
    `Expected ~1-2 days pay, got ${row.salary.prorated_net_salary}`);
});

test('Production fixes: deactivation auto clock-out (Deactivated) & reactivation audit log', async () => {
  const { createSessionToken, SESSION_COOKIE_NAME } = await import('./auth.js');
  const freshAdminCookie = `${SESSION_COOKIE_NAME}=${createSessionToken(1)}`;
  const today = new Date().toISOString().slice(0, 10);

  // Create a fresh employee and give them an open attendance record
  const createRes = await fetch(`${baseUrl}/api/employees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: freshAdminCookie },
    body: JSON.stringify({
      name: 'Temp Worker',
      email: 'tempworker@zaviroq.com',
      department: 'Ops',
      designation: 'Analyst',
    }),
  });
  assert.equal(createRes.status, 201);
  const emp = await createRes.json();
  db.prepare(`INSERT INTO attendance (employee_id, date, clock_in, status) VALUES (?, ?, ?, 'present')`)
    .run(emp.id, today, new Date().toISOString());

  // Deactivate -> auto clock-out with reason 'Deactivated'
  const deactRes = await fetch(`${baseUrl}/api/employees/${emp.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: freshAdminCookie },
    body: JSON.stringify({ is_active: 0 }),
  });
  assert.equal(deactRes.status, 200);

  const att = db.prepare(`SELECT * FROM attendance WHERE employee_id = ? AND date = ?`).get(emp.id, today);
  assert.ok(att.clock_out, 'Deactivation auto clocked out open attendance');
  assert.ok(String(att.notes).includes('Deactivated'));

  const outLog = db.prepare(`SELECT * FROM activity_logs WHERE employee_id = ? AND type = 'clock_out' ORDER BY id DESC LIMIT 1`).get(emp.id);
  assert.equal(outLog?.reason, 'Deactivated');

  // Reactivate -> audit logged as REACTIVATE_EMPLOYEE
  const reactRes = await fetch(`${baseUrl}/api/employees/${emp.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: freshAdminCookie },
    body: JSON.stringify({ is_active: 1 }),
  });
  assert.equal(reactRes.status, 200);
  const audit = db.prepare(`SELECT * FROM audit_logs WHERE action = 'REACTIVATE_EMPLOYEE' AND entity_id = ?`).get(String(emp.id));
  assert.ok(audit, 'REACTIVATE_EMPLOYEE audit log created');
});

test('Round 2: create employee -> no salary, temp PIN shown once, first-login PIN change, leave proration & /reports/me', async () => {
  const { createSessionToken, SESSION_COOKIE_NAME } = await import('./auth.js');
  const freshAdminCookie = `${SESSION_COOKIE_NAME}=${createSessionToken(1)}`;
  const month = new Date().toISOString().slice(0, 7);
  const currentYear = month.slice(0, 4);
  const joinNov = `${currentYear}-11-01`;

  // 1. Create employee -> returns tempPin once, must_change_pin = 1, NO salary row
  const createRes = await fetch(`${baseUrl}/api/employees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: freshAdminCookie },
    body: JSON.stringify({
      name: 'New Onboard',
      email: 'onboard@zaviroq.com',
      department: 'Product',
      designation: 'Designer',
      joining_date: joinNov,
    }),
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  assert.match(String(created.tempPin), /^\d{6}$/, 'tempPin is 6 digits');
  assert.equal(created.must_change_pin, 1);

  const salRow = db.prepare(`SELECT * FROM salary_structures WHERE employee_id = ?`).get(created.id);
  assert.equal(salRow, undefined, 'No default salary created for new employee');

  // 2. First login with tempPin -> must_change_pin is true, then change PIN
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: created.emp_code, pin: created.tempPin }),
  });
  assert.equal(loginRes.status, 200);
  const loginJson = await loginRes.json();
  assert.equal(loginJson.employee.must_change_pin, 1);
  const newEmpCookie = loginRes.headers.get('set-cookie').split(';')[0];

  const changeRes = await fetch(`${baseUrl}/api/auth/change-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: newEmpCookie },
    body: JSON.stringify({ newPin: '739182' }),
  });
  assert.equal(changeRes.status, 200);

  // 3. /api/reports/me always returns a row with salary_set: false and salary: null
  const meRepRes = await fetch(`${baseUrl}/api/reports/me?month=${month}`, {
    headers: { Cookie: newEmpCookie },
  });
  assert.equal(meRepRes.status, 200);
  const meRep = await meRepRes.json();
  assert.equal(meRep.rows.length, 1);
  assert.equal(meRep.rows[0].salary_set, false);
  assert.equal(meRep.rows[0].salary, null);

  // 4. Leave balance proration for Nov joiner: 15 * 2 / 12 = 2.5
  const leaveRes = await fetch(`${baseUrl}/api/leaves`, {
    headers: { Cookie: newEmpCookie },
  });
  assert.equal(leaveRes.status, 200);
  const leaveJson = await leaveRes.json();
  assert.equal(leaveJson.balances[0].earned_total, 2.5);
});

test('Round 3: bot quick replies, zero-task bot reply, and leave date/overlap validation', async () => {
  const { createSessionToken, SESSION_COOKIE_NAME } = await import('./auth.js');
  const freshAdminCookie = `${SESSION_COOKIE_NAME}=${createSessionToken(1)}`;

  // Create a fresh employee with 0 tasks
  const createRes = await fetch(`${baseUrl}/api/employees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: freshAdminCookie },
    body: JSON.stringify({
      name: 'Bot Tester',
      email: 'bottester@zaviroq.com',
      department: 'QA',
      designation: 'QA Engineer',
    }),
  });
  assert.equal(createRes.status, 201);
  const emp = await createRes.json();
  const empCookieLocal = `${SESSION_COOKIE_NAME}=${createSessionToken(emp.id)}`;

  const askBot = async (msg) => {
    const r = await fetch(`${baseUrl}/api/chat/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: empCookieLocal },
      body: JSON.stringify({ recipient_id: 0, message: msg }),
    });
    assert.equal(r.status, 201);
    const j = await r.json();
    return j.botMsg.message;
  };

  assert.match(await askBot('My live status'), /Current State:.*Active: \d+m \| Idle: \d+m \| Break: \d+m/s);
  assert.equal(await askBot('Show pending tasks'), 'You have no tasks assigned yet.');
  assert.match(await askBot("Today's attendance"), /Clock-in:.*Hours so far:/s);
  assert.match(await askBot('Pending leaves'), /no pending leave requests/i);
  assert.match(await askBot('Office timings & breaks'), /Office Hours:.*Lunch Break:.*Tea Break:/s);

  // Leave validation: end_date < start_date -> 400
  const badRange = await fetch(`${baseUrl}/api/leaves`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: empCookieLocal },
    body: JSON.stringify({ leave_type: 'casual', start_date: '2026-12-10', end_date: '2026-12-08', reason: 'Trip' }),
  });
  assert.equal(badRange.status, 400);

  // Leave validation: clocked-in day -> 400
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`INSERT INTO attendance (employee_id, date, clock_in, status) VALUES (?, ?, ?, 'present')`)
    .run(emp.id, today, new Date().toISOString());
  const clockedOverlap = await fetch(`${baseUrl}/api/leaves`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: empCookieLocal },
    body: JSON.stringify({ leave_type: 'casual', start_date: today, end_date: today, reason: 'Overlap' }),
  });
  assert.equal(clockedOverlap.status, 400);
});

test('Round 4: combined idle signal (no flapping), 180s stale offline, and includeInactive=true', async () => {
  const { createSessionToken, SESSION_COOKIE_NAME } = await import('./auth.js');
  const freshAdminCookie = `${SESSION_COOKIE_NAME}=${createSessionToken(1)}`;

  // 1. Combined signal logic (matches resolveCombinedIdleState in useIdleDetector.ts)
  const resolveCombined = ({ userState, screenState, msSinceTabInput, idleThresholdMs }) => {
    if (screenState === 'locked') return 'idle';
    if (userState === 'active' || msSinceTabInput < idleThresholdMs) return 'active';
    return 'idle';
  };
  // Alternating detector idle while tab input is recent -> stays active (no flapping)
  assert.equal(resolveCombined({ userState: 'idle', screenState: 'unlocked', msSinceTabInput: 5000, idleThresholdMs: 60000 }), 'active');
  // Detector active while tab has no input -> stays active
  assert.equal(resolveCombined({ userState: 'active', screenState: 'unlocked', msSinceTabInput: 90000, idleThresholdMs: 60000 }), 'active');
  // Both say idle -> idle
  assert.equal(resolveCombined({ userState: 'idle', screenState: 'unlocked', msSinceTabInput: 65000, idleThresholdMs: 60000 }), 'idle');
  // Screen locked -> idle immediately
  assert.equal(resolveCombined({ userState: 'active', screenState: 'locked', msSinceTabInput: 0, idleThresholdMs: 60000 }), 'idle');

  // 2. Stale heartbeat > 180s -> /api/dashboard returns status: 'offline'
  const staleTime = new Date(Date.now() - 200 * 1000).toISOString();
  db.prepare(`UPDATE employees SET status = 'active', last_heartbeat_at = ? WHERE id = 2`).run(staleTime);
  const dashRes = await fetch(`${baseUrl}/api/dashboard`, { headers: { Cookie: freshAdminCookie } });
  assert.equal(dashRes.status, 200);
  const dash = await dashRes.json();
  const emp2 = dash.employees.find((e) => e.id === 2);
  assert.equal(emp2.status, 'offline', 'Employee with heartbeat > 180s ago must appear offline');

  // 3. includeInactive=true includes deactivated employees
  db.prepare(`UPDATE employees SET is_active = 0 WHERE id = 6`).run();
  const activeOnlyRes = await fetch(`${baseUrl}/api/dashboard`, { headers: { Cookie: freshAdminCookie } });
  const activeOnly = await activeOnlyRes.json();
  assert.equal(activeOnly.employees.some((e) => e.id === 6), false);

  const withInactiveRes = await fetch(`${baseUrl}/api/dashboard?includeInactive=true`, { headers: { Cookie: freshAdminCookie } });
  const withInactive = await withInactiveRes.json();
  const emp6 = withInactive.employees.find((e) => e.id === 6);
  assert.ok(emp6, 'includeInactive=true must return deactivated employee');
  assert.equal(emp6.is_active, 0);
  db.prepare(`UPDATE employees SET is_active = 1 WHERE id = 6`).run();
});

test('PWA + Alerts: each rule triggers once per episode, quiet hours respected, managers scoped to department', async () => {
  // Ensure clean alert episodes and rules
  db.prepare(`DELETE FROM alert_episodes`).run();
  db.prepare(`DELETE FROM notifications`).run();
  db.prepare(`UPDATE alert_rules SET enabled = 1, quiet_hours = '{"start":"22:00","end":"08:00"}', recipients = 'all'`).run();

  // Ensure we have a manager in 'Sales' and an employee in 'Sales' + an employee in 'Engineering'
  const { hashPin } = await import('./db.js');
  db.prepare(`INSERT OR IGNORE INTO employees (emp_code, name, email, role, department, designation, pin, is_active) VALUES ('ZAV-901', 'Sales Mgr', 'salesmgr@zaviroq.com', 'manager', 'Sales', 'Lead', ?, 1)`).run(hashPin('849201'));
  db.prepare(`INSERT OR IGNORE INTO employees (emp_code, name, email, role, department, designation, pin, is_active) VALUES ('ZAV-902', 'Sales Rep', 'salesrep@zaviroq.com', 'employee', 'Sales', 'Rep', ?, 1)`).run(hashPin('849201'));
  const salesMgr = db.prepare(`SELECT id FROM employees WHERE emp_code = 'ZAV-901'`).get();
  const salesRep = db.prepare(`SELECT id FROM employees WHERE emp_code = 'ZAV-902'`).get();

  // Set Sales Rep clocked in with stale heartbeat (> 5m), idle > 15m, break > 60m on a weekday 14:00 IST (08:30 UTC)
  const testNow = new Date('2026-11-26T08:30:00.000Z'); // 14:00 IST (outside 22:00-08:00 quiet hours)
  const staleHb = new Date(testNow.getTime() - 10 * 60 * 1000).toISOString();
  db.prepare(`UPDATE employees SET status = 'idle', last_heartbeat_at = ? WHERE id = ?`).run(staleHb, salesRep.id);
  db.prepare(`INSERT OR REPLACE INTO attendance (employee_id, date, clock_in, status, idle_seconds, break_seconds) VALUES (?, '2026-11-26', '2026-11-26T04:00:00.000Z', 'present', 1200, 4000)`).run(salesRep.id);

  // 1. First evaluation triggers tracker_offline, idle_too_long, break_over_limit for Sales Rep
  const firstRun = await evaluateAlertRulesForTest(testNow, 'Asia/Kolkata');
  const repRules = firstRun.filter((t) => t.employeeId === salesRep.id).map((t) => t.ruleType);
  assert.ok(repRules.includes('tracker_offline'));
  assert.ok(repRules.includes('idle_too_long'));
  assert.ok(repRules.includes('break_over_limit'));

  // Manager in Sales MUST receive Sales Rep's alert, NOT alerts for Engineering employees
  const mgrNotifs = db.prepare(`SELECT * FROM notifications WHERE employee_id = ?`).all(salesMgr.id);
  assert.ok(mgrNotifs.some((n) => n.link.includes(`employeeId=${salesRep.id}`)), 'Sales manager gets Sales Rep alert with link');
  assert.equal(mgrNotifs.some((n) => n.link.includes('employeeId=3')), false, 'Sales manager must NOT get Engineering employee alert');

  // 2. Second evaluation immediately after -> NO duplicate alerts while episode active
  const secondRun = await evaluateAlertRulesForTest(testNow, 'Asia/Kolkata');
  assert.equal(secondRun.filter((t) => t.employeeId === salesRep.id).length, 0, 'Must not re-alert during active episode');

  // 3. Resolve episode (fresh heartbeat), then go stale again -> re-alerts!
  db.prepare(`UPDATE employees SET status = 'active', last_heartbeat_at = ? WHERE id = ?`).run(testNow.toISOString(), salesRep.id);
  await evaluateAlertRulesForTest(testNow, 'Asia/Kolkata'); // resolves tracker_offline & idle_too_long
  const later = new Date(testNow.getTime() + 12 * 60 * 1000);
  db.prepare(`UPDATE employees SET last_heartbeat_at = ? WHERE id = ?`).run(testNow.toISOString(), salesRep.id);
  const thirdRun = await evaluateAlertRulesForTest(later, 'Asia/Kolkata');
  assert.ok(thirdRun.some((t) => t.employeeId === salesRep.id && t.ruleType === 'tracker_offline'), 'Re-alerts after episode resolves and starts again');

  // 4. Quiet hours respected (23:00 IST = 17:30 UTC is inside 22:00-08:00)
  db.prepare(`DELETE FROM alert_episodes`).run();
  const quietNow = new Date('2026-11-26T17:30:00.000Z');
  const quietRun = await evaluateAlertRulesForTest(quietNow, 'Asia/Kolkata');
  assert.equal(quietRun.length, 0, 'Quiet hours must suppress all alerts');
});
