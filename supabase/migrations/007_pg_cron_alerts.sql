-- Schedule Zaviroq alert evaluation every 5 minutes via Supabase pg_cron + pg_net
-- (Vercel Hobby plan only runs crons once per day, so pg_cron handles 5-minute alert checks.)
-- Replace <CRON_SECRET> with your Vercel CRON_SECRET before running in Supabase SQL Editor.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove existing job if re-running
SELECT cron.unschedule('zaviroq-alerts-every-5m')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'zaviroq-alerts-every-5m');

SELECT cron.schedule(
  'zaviroq-alerts-every-5m',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://zaviroq-attendence.vercel.app/api/cron/alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <CRON_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);
