-- Daytime refreshes every 2 hours on weekdays (Melbourne business hours), via pg_cron + pg_net.
-- The daily 5:30am run comes from Vercel Cron (vercel.json).
-- Requires two Vault secrets (set once, not committed):
--   select vault.create_secret('https://debtors.precisionthermal.com.au', 'debtors_site_url');
--   select vault.create_secret('<CRON_SECRET>', 'debtors_cron_secret');

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.trigger_debtors_sync()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  site text := (select decrypted_secret from vault.decrypted_secrets where name = 'debtors_site_url');
  secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'debtors_cron_secret');
begin
  if site is null or secret is null then
    raise warning 'debtors sync: vault secrets not set';
    return;
  end if;
  perform net.http_post(
    url := site || '/api/cron/sync-all',
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
end;
$$;
revoke execute on function public.trigger_debtors_sync() from public, anon, authenticated;

-- pg_cron uses UTC. Melbourne is UTC+11 in summer (UTC+10 in winter, so runs shift an hour later).
-- 8am, 10am (prev UTC day, Sun–Thu) and 12pm, 2pm, 4pm, 6pm (Mon–Fri) Melbourne time.
select cron.schedule('debtors-sync-morning', '0 21,23 * * 0-4', 'select public.trigger_debtors_sync()');
select cron.schedule('debtors-sync-day', '0 1,3,5,7 * * 1-5', 'select public.trigger_debtors_sync()');
