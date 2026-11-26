import { setVapidDetails, sendNotification } from 'web-push';

export const DEFAULT_ALERT_RULES = [
  { type: 'tracker_offline', enabled: true, threshold_minutes: 5, channels: ['in_app', 'push'], quiet_hours: { start: '22:00', end: '08:00' }, recipients: 'all' },
  { type: 'idle_too_long', enabled: true, threshold_minutes: 15, channels: ['in_app'], quiet_hours: { start: '22:00', end: '08:00' }, recipients: 'all' },
  { type: 'break_over_limit', enabled: true, threshold_minutes: 60, channels: ['in_app'], quiet_hours: { start: '22:00', end: '08:00' }, recipients: 'all' },
  { type: 'not_clocked_in', enabled: true, threshold_minutes: 0, channels: ['in_app'], quiet_hours: { start: '22:00', end: '08:00' }, recipients: 'all' },
  { type: 'missed_clock_out', enabled: true, threshold_minutes: 0, channels: ['in_app'], quiet_hours: { start: '22:00', end: '08:00' }, recipients: 'all' },
  { type: 'daily_summary', enabled: true, threshold_minutes: 0, channels: ['in_app'], quiet_hours: { start: '22:00', end: '08:00' }, recipients: 'all' },
];

export function getLocalDateAndMins(dateObj = new Date(), timeZone = 'Asia/Kolkata') {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dateObj);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(dateObj);
  const hh = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const mm = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  return { date, mins: hh * 60 + mm, dayOfWeek: new Date(`${date}T12:00:00Z`).getUTCDay() };
}

export function isWithinQuietHours(quietHours, nowDate = new Date(), timeZone = 'Asia/Kolkata') {
  if (!quietHours || !quietHours.start || !quietHours.end) return false;
  const [sh, sm] = String(quietHours.start).split(':').map(Number);
  const [eh, em] = String(quietHours.end).split(':').map(Number);
  if (Number.isNaN(sh) || Number.isNaN(eh)) return false;
  const startM = sh * 60 + (sm || 0);
  const endM = eh * 60 + (em || 0);
  if (startM === endM) return false;
  const { mins } = getLocalDateAndMins(nowDate, timeZone);
  if (startM < endM) {
    return mins >= startM && mins < endM;
  }
  // Overnight quiet hours (e.g. 22:00 -> 08:00)
  return mins >= startM || mins < endM;
}

function parseJsonField(val, fallback) {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

async function sendWebPushBatch(subscriptions, payload, deleteSub) {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subj = process.env.VAPID_SUBJECT || 'mailto:admin@zaviroq.com';
  if (!pub || !priv || subscriptions.length === 0) return;

  setVapidDetails(subj, pub, priv);
  for (const sub of subscriptions) {
    try {
      await sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      );
    } catch (err) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await deleteSub(sub.endpoint);
      }
    }
  }
}

async function sendResendEmail(toEmails, subject, text) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || toEmails.length === 0) return;
  const from = process.env.RESEND_FROM_EMAIL || 'Zaviroq Workforce <alerts@zaviroq.com>';
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: toEmails, subject, text }),
    });
  } catch {
    // Non-fatal email failure
  }
}

export async function evaluateAlertRules(adapter, { now = new Date(), timeZone = 'Asia/Kolkata' } = {}) {
  const { date: today, mins: nowMins, dayOfWeek } = getLocalDateAndMins(now, timeZone);
  const settings = await adapter.getSettings();
  const rawRules = await adapter.getRules();
  const rules = new Map(
    rawRules.map((r) => [
      r.type,
      {
        ...r,
        enabled: Boolean(r.enabled),
        channels: parseJsonField(r.channels, ['in_app']),
        quiet_hours: parseJsonField(r.quiet_hours, { start: '22:00', end: '08:00' }),
        recipients: r.recipients || 'all',
      },
    ])
  );

  const weekendSet = new Set(settings.weekendDays || [0, 6]);
  const isHoliday = await adapter.isHoliday(today);
  const isWorkingDay = !weekendSet.has(dayOfWeek) && !isHoliday;
  const emps = await adapter.getEmployeesWithAttendance(today);
  const leaveEmpIds = new Set(await adapter.getApprovedLeaveEmployeeIds(today));
  const allRecipients = await adapter.getPrivilegedRecipients();
  const triggered = [];

  const filterRecipients = (ruleRecipients, targetDept) =>
    allRecipients.filter((rec) => {
      if (ruleRecipients === 'admins' && rec.role !== 'admin') return false;
      if (ruleRecipients === 'managers' && rec.role !== 'manager') return false;
      if (rec.role === 'manager' && targetDept && rec.department !== targetDept) return false;
      return true;
    });

  const handleCondition = async ({ ruleType, employeeId, episodeKey, isActive, title, message, targetDept }) => {
    const rule = rules.get(ruleType);
    if (!rule || !rule.enabled) return;

    const existing = await adapter.getActiveEpisode(ruleType, episodeKey);
    if (!isActive) {
      if (existing) {
        await adapter.resolveEpisode(existing.id, now.toISOString());
      }
      return;
    }

    // Already alerted for this episode
    if (existing) return;
    // Respect quiet hours
    if (isWithinQuietHours(rule.quiet_hours, now, timeZone)) return;

    await adapter.openEpisode({ employeeId, ruleType, episodeKey, nowIso: now.toISOString() });
    const recipients = filterRecipients(rule.recipients, targetDept);
    const link = employeeId
      ? `/?tab=attendance&date=${today}&employeeId=${employeeId}`
      : `/?tab=attendance&date=${today}`;

    if (rule.channels.includes('in_app')) {
      for (const rec of recipients) {
        await adapter.insertNotification({
          employeeId: rec.id,
          type: 'alert',
          title,
          message,
          link,
          nowIso: now.toISOString(),
        });
      }
    }

    if (rule.channels.includes('push') && recipients.length > 0) {
      const subs = await adapter.getPushSubscriptions(recipients.map((r) => r.id));
      await sendWebPushBatch(subs, { title, body: message, url: link }, adapter.deletePushSubscription);
    }

    if (rule.channels.includes('email') && (ruleType === 'daily_summary' || ruleType === 'tracker_offline')) {
      const emails = recipients.map((r) => r.email).filter(Boolean);
      await sendResendEmail(emails, `[Zaviroq Alert] ${title}`, `${message}\n\nView: ${link}`);
    }

    await adapter.writeAudit({
      action: 'ALERT_TRIGGERED',
      entityType: employeeId ? 'attendance' : 'system',
      entityId: employeeId ? `${employeeId}:${today}` : today,
      newValue: { rule: ruleType, title, message, link, recipients: recipients.map((r) => r.id) },
    });

    triggered.push({ ruleType, employeeId, episodeKey, title, recipientIds: recipients.map((r) => r.id) });
  };

  for (const emp of emps) {
    const isClockedIn = Boolean(emp.clock_in && !emp.clock_out);
    const shiftStart = emp.shift_start || settings.shiftStart || '09:30';
    const shiftEnd = emp.shift_end || settings.shiftEnd || '17:30';
    const [sh, sm] = shiftStart.split(':').map(Number);
    const [eh, em] = shiftEnd.split(':').map(Number);
    const shiftStartMins = sh * 60 + sm;
    const shiftEndMins = eh * 60 + em;

    // 1. tracker_offline: clocked in AND (now - last_heartbeat_at) > threshold AND within shift
    const offlineRule = rules.get('tracker_offline');
    const offlineMs = (offlineRule?.threshold_minutes ?? 5) * 60 * 1000;
    const lastHbMs = emp.last_heartbeat_at ? new Date(emp.last_heartbeat_at).getTime() : 0;
    const isWithinShift = shiftStartMins <= shiftEndMins
      ? nowMins >= shiftStartMins && nowMins <= shiftEndMins
      : nowMins >= shiftStartMins || nowMins <= shiftEndMins;
    const isTrackerOffline = isClockedIn && isWithinShift && lastHbMs > 0 && now.getTime() - lastHbMs > offlineMs;
    await handleCondition({
      ruleType: 'tracker_offline',
      employeeId: emp.id,
      episodeKey: `tracker_offline:${emp.id}:${emp.attendance_id || today}`,
      isActive: isTrackerOffline,
      title: `Tracker Offline: ${emp.name}`,
      message: `${emp.name} (${emp.emp_code}) has had no heartbeat for > ${offlineRule?.threshold_minutes ?? 5}m.`,
      targetDept: emp.department,
    });

    // 2. idle_too_long: continuous idle > threshold_minutes (15m)
    const idleRule = rules.get('idle_too_long');
    const idleThreshSec = (idleRule?.threshold_minutes ?? 15) * 60;
    const isIdleTooLong = isClockedIn && emp.status === 'idle' && (emp.idle_seconds || 0) >= idleThreshSec;
    await handleCondition({
      ruleType: 'idle_too_long',
      employeeId: emp.id,
      episodeKey: `idle_too_long:${emp.id}:${today}`,
      isActive: isIdleTooLong,
      title: `Idle Too Long: ${emp.name}`,
      message: `${emp.name} (${emp.emp_code}) has been idle for > ${idleRule?.threshold_minutes ?? 15}m.`,
      targetDept: emp.department,
    });

    // 3. break_over_limit: break total > settings.totalBreakMinutes
    const breakRule = rules.get('break_over_limit');
    const breakLimitSec = (breakRule?.threshold_minutes || settings.totalBreakMinutes || 60) * 60;
    const isBreakOver = (emp.break_seconds || 0) > breakLimitSec;
    await handleCondition({
      ruleType: 'break_over_limit',
      employeeId: emp.id,
      episodeKey: `break_over_limit:${emp.id}:${today}`,
      isActive: isBreakOver,
      title: `Break Over Limit: ${emp.name}`,
      message: `${emp.name} (${emp.emp_code}) exceeded the ${Math.round(breakLimitSec / 60)}m break limit.`,
      targetDept: emp.department,
    });

    // 4. not_clocked_in: no clock-in by shift_start + grace (working days, not on leave)
    const notInRule = rules.get('not_clocked_in');
    const notInCutoff = shiftStartMins + (settings.lateGraceMinutes ?? 15) + (notInRule?.threshold_minutes ?? 0);
    const isNotClockedIn = isWorkingDay && !emp.clock_in && !leaveEmpIds.has(emp.id) && nowMins >= notInCutoff;
    await handleCondition({
      ruleType: 'not_clocked_in',
      employeeId: emp.id,
      episodeKey: `not_clocked_in:${emp.id}:${today}`,
      isActive: isNotClockedIn,
      title: `Not Clocked In: ${emp.name}`,
      message: `${emp.name} (${emp.emp_code}) has not clocked in by ${shiftStart} + ${settings.lateGraceMinutes ?? 15}m grace.`,
      targetDept: emp.department,
    });

    // 5. missed_clock_out: still clocked in at shift_end + buffer
    const missedRule = rules.get('missed_clock_out');
    const missedCutoff = shiftEndMins + (settings.autoClockOutBufferMinutes ?? 120) + (missedRule?.threshold_minutes ?? 0);
    const isMissedOut = isClockedIn && nowMins >= missedCutoff;
    await handleCondition({
      ruleType: 'missed_clock_out',
      employeeId: emp.id,
      episodeKey: `missed_clock_out:${emp.id}:${today}`,
      isActive: isMissedOut,
      title: `Missed Clock-Out: ${emp.name}`,
      message: `${emp.name} (${emp.emp_code}) is still clocked in past shift end + buffer.`,
      targetDept: emp.department,
    });
  }

  // 6. daily_summary at 19:00 IST (1140 mins)
  const presentCnt = emps.filter((e) => e.clock_in).length;
  const lateCnt = emps.filter((e) => e.att_status === 'late').length;
  await handleCondition({
    ruleType: 'daily_summary',
    employeeId: null,
    episodeKey: `daily_summary:${today}`,
    isActive: nowMins >= 19 * 60,
    title: `Daily Summary (${today})`,
    message: `${presentCnt}/${emps.length} clocked in today (${lateCnt} late).`,
    targetDept: null,
  });

  return triggered;
}
