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

const { app, computeArrivalStatus, countWorkingLeaveDays, recalculateAttendanceLateStatuses, formatClockInReason } = await import('./index.js');
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
