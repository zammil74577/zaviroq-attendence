-- Consolidated idempotent schema migration for Phase 1/2/Desktop Agent
-- Safe to run repeatedly on production Supabase Postgres.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS joining_date DATE DEFAULT CURRENT_DATE;
UPDATE employees SET joining_date = (created_at AT TIME ZONE 'Asia/Kolkata')::date WHERE joining_date IS NULL;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS must_change_pin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS consent_accepted_at TIMESTAMPTZ;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS active_session_id TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS last_heartbeat_state TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE attendance ADD COLUMN IF NOT EXISTS tracking_mode TEXT NOT NULL DEFAULT 'tab_only';
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS missed_clock_out BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS manual_override BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS overtime_seconds INTEGER NOT NULL DEFAULT 0;

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS alert_rules (
  id SERIAL PRIMARY KEY,
  type TEXT UNIQUE NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  threshold_minutes INTEGER NOT NULL DEFAULT 5,
  channels JSONB NOT NULL DEFAULT '["in_app"]'::jsonb,
  quiet_hours JSONB NOT NULL DEFAULT '{"start":"22:00","end":"08:00"}'::jsonb,
  recipients TEXT NOT NULL DEFAULT 'all',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_episodes (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL,
  episode_key TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_alert_episodes_lookup ON alert_episodes(rule_type, episode_key, active);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_tokens (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  device_name TEXT NOT NULL DEFAULT 'Desktop Device',
  platform TEXT NOT NULL DEFAULT 'windows',
  app_version TEXT NOT NULL DEFAULT '1.0.0',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_emp ON device_tokens(employee_id);

CREATE TABLE IF NOT EXISTS pairing_codes (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE pairing_codes ENABLE ROW LEVEL SECURITY;

INSERT INTO alert_rules (type, enabled, threshold_minutes, channels, quiet_hours, recipients) VALUES
  ('tracker_offline', TRUE, 5, '["in_app","push"]'::jsonb, '{"start":"22:00","end":"08:00"}'::jsonb, 'all'),
  ('idle_too_long', TRUE, 15, '["in_app"]'::jsonb, '{"start":"22:00","end":"08:00"}'::jsonb, 'all'),
  ('break_over_limit', TRUE, 60, '["in_app"]'::jsonb, '{"start":"22:00","end":"08:00"}'::jsonb, 'all'),
  ('not_clocked_in', TRUE, 0, '["in_app"]'::jsonb, '{"start":"22:00","end":"08:00"}'::jsonb, 'all'),
  ('missed_clock_out', TRUE, 0, '["in_app"]'::jsonb, '{"start":"22:00","end":"08:00"}'::jsonb, 'all'),
  ('daily_summary', TRUE, 0, '["in_app"]'::jsonb, '{"start":"22:00","end":"08:00"}'::jsonb, 'all')
ON CONFLICT (type) DO NOTHING;

-- Clean up today's duplicate idle_start/idle_end rows and orphan idle_end rows in activity_logs (audit_logs untouched)
WITH ordered_idle AS (
  SELECT
    id,
    employee_id,
    type,
    LAG(type) OVER (PARTITION BY employee_id, date ORDER BY id) AS prev_type
  FROM activity_logs
  WHERE date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
    AND type IN ('idle_start', 'idle_end')
)
DELETE FROM activity_logs
WHERE id IN (
  SELECT id FROM ordered_idle
  WHERE (type = prev_type)
     OR (type = 'idle_end' AND prev_type IS NULL)
);
