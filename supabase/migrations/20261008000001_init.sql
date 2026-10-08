-- Precision Thermal Debtors Portal — initial schema
-- Every table has RLS enabled. Browsers only ever SELECT; all writes go through
-- server actions / cron routes using the service-role key after an explicit role check.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null default 'staff' check (role in ('owner', 'manager', 'staff')),
  brand_access text not null default 'all' check (brand_access in ('all', 'DND', 'Gippsland')),
  -- New auth users start inactive. Only an Owner/Manager (via the service role)
  -- activates them, so a stray public sign-up can never see data.
  active boolean not null default false,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);
alter table public.profiles enable row level security;

-- Never trust user metadata for role/active: always create as inactive staff.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helpers used by policies (security definer so they can read profiles without recursion)
create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select active from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select active and role in ('owner', 'manager') from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.my_brand_access()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select brand_access from public.profiles where id = auth.uid() and active), 'none');
$$;

revoke execute on function public.is_active_user() from anon;
revoke execute on function public.is_manager() from anon;
revoke execute on function public.my_brand_access() from anon;

create policy "read own profile or managers read all" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_manager());

-- ---------------------------------------------------------------------------
-- Debtors data (written by sync jobs)
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  xero_contact_id text not null unique,
  name text not null,
  email text,
  brand_override text check (brand_override in ('DND', 'Gippsland')),
  ascora_customer_id text,
  ascora_customer_name text,
  ascora_match text not null default 'none' check (ascora_match in ('none', 'auto', 'review', 'confirmed', 'rejected')),
  ascora_candidates jsonb,
  ascora_checked_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.customers enable row level security;
create index customers_name_idx on public.customers (lower(name));

create table public.invoices (
  xero_invoice_id text primary key,
  number text not null,
  customer_id uuid not null references public.customers (id) on delete cascade,
  doc_type text not null default 'invoice' check (doc_type in ('invoice', 'credit')),
  brand text check (brand in ('DND', 'Gippsland')),
  reference text,
  issue_date date,
  due_date date,
  total numeric(14, 2) not null default 0,
  amount_due numeric(14, 2) not null default 0, -- negative for unallocated credit
  synced_at timestamptz not null default now()
);
alter table public.invoices enable row level security;
create index invoices_customer_idx on public.invoices (customer_id);
create index invoices_number_idx on public.invoices (lower(number));

-- Ascora invoice IDs captured from webhooks (kept separate so Xero syncs never wipe them)
create table public.ascora_invoice_ids (
  invoice_number text primary key,
  ascora_invoice_id text not null,
  updated_at timestamptz not null default now()
);
alter table public.ascora_invoice_ids enable row level security;

create table public.payments (
  id text primary key, -- Xero PaymentID
  customer_id uuid not null references public.customers (id) on delete cascade,
  paid_date date not null,
  amount numeric(14, 2) not null,
  invoice_number text
);
alter table public.payments enable row level security;
create index payments_customer_idx on public.payments (customer_id, paid_date desc);

create table public.remittances (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique, -- Missive message id
  inbox text,
  customer_id uuid references public.customers (id) on delete set null,
  customer_name_raw text,
  kind text not null default 'remittance' check (kind in ('remittance', 'claim', 'note')),
  ref text,
  doc_date date,
  amount numeric(14, 2),
  invoice_numbers text[] not null default '{}',
  note text,
  missive_url text,
  status text not null default 'open' check (status in ('open', 'applied', 'dismissed')),
  status_by uuid references public.profiles (id),
  status_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.remittances enable row level security;

create table public.missive_seen (
  message_id text primary key,
  conversation_id text,
  processed_at timestamptz not null default now(),
  outcome text
);
alter table public.missive_seen enable row level security;

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  author_name text not null,
  body text not null check (length(body) between 1 and 4000),
  tag text check (tag in ('Called', 'Emailed', 'Promised to pay', 'Disputed', 'Other')),
  follow_up_date date,
  follow_up_done boolean not null default false,
  source text not null default 'portal' check (source in ('portal', 'ascora')),
  ascora_note_id text unique,
  sync_status text not null default 'pending' check (sync_status in ('pending', 'synced', 'failed', 'skipped')),
  sync_error text,
  created_at timestamptz not null default now()
);
alter table public.notes enable row level security;
create index notes_customer_idx on public.notes (customer_id, created_at desc);
create index notes_follow_up_idx on public.notes (follow_up_date) where follow_up_date is not null and not follow_up_done;

-- ---------------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------------
create table public.sync_runs (
  id bigserial primary key,
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  detail jsonb,
  error text
);
alter table public.sync_runs enable row level security;
create index sync_runs_job_idx on public.sync_runs (job, started_at desc);

-- Non-secret app state (as-of date, Xero org name, etc.)
create table public.app_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_state enable row level security;

-- Encrypted secrets (Xero refresh token). No policies: service role only.
create table public.integration_secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.integration_secrets enable row level security;

create table public.ascora_events (
  id bigserial primary key,
  received_at timestamptz not null default now(),
  event text,
  payload jsonb
);
alter table public.ascora_events enable row level security;

create table public.audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid,
  user_email text,
  action text not null,
  target text,
  detail jsonb
);
alter table public.audit_log enable row level security;
create index audit_log_at_idx on public.audit_log (at desc);

-- ---------------------------------------------------------------------------
-- Read policies
-- ---------------------------------------------------------------------------
create or replace function public.can_see_brand(b text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case public.my_brand_access()
    when 'all' then true
    when 'none' then false
    else b = public.my_brand_access()
  end;
$$;
revoke execute on function public.can_see_brand(text) from anon;

create policy "active users read customers" on public.customers
  for select to authenticated using (public.is_active_user());

create policy "brand-scoped invoice read" on public.invoices
  for select to authenticated
  using (
    public.is_active_user() and (
      public.my_brand_access() = 'all'
      or public.can_see_brand(coalesce(brand, (select c.brand_override from public.customers c where c.id = customer_id)))
    )
  );

create policy "active users read ascora invoice ids" on public.ascora_invoice_ids
  for select to authenticated using (public.is_active_user());

create policy "brand-scoped payment read" on public.payments
  for select to authenticated
  using (public.is_active_user() and (public.my_brand_access() = 'all'
    or exists (select 1 from public.invoices i where i.customer_id = payments.customer_id)));

create policy "brand-scoped remittance read" on public.remittances
  for select to authenticated
  using (public.is_active_user() and (public.my_brand_access() = 'all'
    or exists (select 1 from public.invoices i where i.customer_id = remittances.customer_id)));

create policy "brand-scoped note read" on public.notes
  for select to authenticated
  using (public.is_active_user() and (public.my_brand_access() = 'all'
    or exists (select 1 from public.invoices i where i.customer_id = notes.customer_id)));

create policy "active users read sync runs" on public.sync_runs
  for select to authenticated using (public.is_active_user());

create policy "active users read app state" on public.app_state
  for select to authenticated using (public.is_active_user());

create policy "managers read audit log" on public.audit_log
  for select to authenticated using (public.is_manager());

-- Lock down anon entirely
revoke all on all tables in schema public from anon;
