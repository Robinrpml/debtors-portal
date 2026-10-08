-- Ascora "On Hold" status, mirrored per customer.
-- ascora_on_hold          = the customer itself is on hold in Ascora
-- ascora_billing_on_hold  = its billing customer is on hold (site customers billed via a builder)
alter table public.customers
  add column ascora_on_hold boolean not null default false,
  add column ascora_billing_on_hold boolean not null default false,
  add column ascora_hold_checked_at timestamptz;

create index customers_ascora_id_idx on public.customers (ascora_customer_id) where ascora_customer_id is not null;
-- Existing RLS policy on customers ("active users read customers") already covers the new columns.
