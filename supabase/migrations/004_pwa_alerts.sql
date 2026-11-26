-- PWA & Admin Alerts Migration
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

ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

INSERT INTO alert_rules (type, enabled, threshold_minutes, channels, quiet_hours, recipients) VALUES
  ('tracker_offline', TRUE, 5, '["in_app","push"]'::jsonb, '{"start":"22:00","end":"08:00"}'::jsonb, 'all'),
  ('idle_too_long', TRUE, 15, '["in_app"]'::jsonb, '{"start":"22:00","end":"08:00"}'::jsonb, 'all'),
  ('break_over_limit', TRUE, 60, '["in_app"]'::jsonb, '{"start":"22:00","end":"08:00"}'::jsonb, 'all'),
  ('not_clocked_in', TRUE, 0, '["in_app"]'::jsonb, '{"start":"22:00","end":"08:00"}'::jsonb, 'all'),
  ('missed_clock_out', TRUE, 0, '["in_app"]'::jsonb, '{"start":"22:00","end":"08:00"}'::jsonb, 'all'),
  ('daily_summary', TRUE, 0, '["in_app"]'::jsonb, '{"start":"22:00","end":"08:00"}'::jsonb, 'all')
ON CONFLICT (type) DO NOTHING;
