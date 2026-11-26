/**
 * Post-Deploy Smoke Test for Zaviroq Workforce OS
 * Fails if any critical endpoint takes > 5000ms or returns 5xx.
 *
 * Usage:
 *   BASE_URL=https://zaviroq-attendence.vercel.app npm run smoke
 *   # With optional authenticated check:
 *   SMOKE_CODE=ZAV-001 SMOKE_PIN=849201 BASE_URL=https://zaviroq-attendence.vercel.app npm run smoke
 */
const baseUrl = (process.env.BASE_URL || 'https://zaviroq-attendence.vercel.app').replace(/\/$/, '');
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 2000);

async function timedFetch(path, opts = {}) {
  const start = Date.now();
  const res = await fetch(`${baseUrl}${path}`, {
    ...opts,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const ms = Date.now() - start;
  if (ms > timeoutMs) {
    throw new Error(`${path} took ${ms}ms (> ${timeoutMs}ms)`);
  }
  return { res, ms };
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);

  // 1. Health check
  const healthPath = baseUrl.includes('localhost') ? '/healthz' : '/api/healthz';
  const { res: hRes, ms: hMs } = await timedFetch(healthPath);
  if (hRes.status !== 200) {
    throw new Error(`${healthPath} returned ${hRes.status} (${hMs}ms): ${await hRes.text()}`);
  }
  console.log(`✅ ${healthPath} -> 200 (${hMs}ms)`);

  // 2. Optional login if SMOKE_CODE + SMOKE_PIN provided
  let cookie = '';
  if (process.env.SMOKE_CODE && process.env.SMOKE_PIN) {
    const { res: lRes, ms: lMs } = await timedFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: process.env.SMOKE_CODE, pin: process.env.SMOKE_PIN }),
    });
    if (lRes.status !== 200) {
      throw new Error(`/api/auth/login returned ${lRes.status} (${lMs}ms)`);
    }
    cookie = (lRes.headers.get('set-cookie') || '').split(';')[0];
    console.log(`✅ /api/auth/login -> 200 (${lMs}ms)`);
  }

  // 3. Critical endpoints must respond within 5s (200 if authed, 401 if unauthed — never 5xx or hang)
  const endpoints = [
    `/api/dashboard?date=${today}`,
    '/api/leaves',
    `/api/reports/monthly?month=${month}`,
  ];
  for (const ep of endpoints) {
    const { res, ms } = await timedFetch(ep, cookie ? { headers: { Cookie: cookie } } : {});
    const expected = cookie ? 200 : 401;
    if (res.status >= 500 || res.status !== expected) {
      throw new Error(`${ep} returned ${res.status}, expected ${expected} (${ms}ms)`);
    }
    console.log(`✅ ${ep} -> ${res.status} (${ms}ms)`);
  }

  console.log('All smoke checks passed under 5000ms.');
}

main().catch((err) => {
  console.error('❌ Smoke test failed:', err.message);
  process.exit(1);
});
