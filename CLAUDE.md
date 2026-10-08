# Precision Thermal Debtors Portal

Login-protected aged-debtors app for DND Insulation and Gippsland Insulation (one Xero org, "Brand" tracking category).
Next.js 16 (App Router, `src/`), Supabase (Postgres + Auth), deployed on Vercel from `main`.
Read `AGENTS.md` — this Next.js version differs from older training data (e.g. `proxy.ts` replaces `middleware.ts`, request APIs are async).

## Rules that must survive every change

1. **Secrets stay server-side.** Only `NEXT_PUBLIC_*` vars reach the browser. Xero/Ascora/Missive/Anthropic keys and
   `SUPABASE_SERVICE_ROLE_KEY` are used only in files that `import "server-only"`.
2. **Every route needs a session** (`src/proxy.ts`), except `/login`, `/forgot-password`, `/auth/confirm`, `/setup`,
   and `/api/cron/*` + `/api/webhooks/*`, which authenticate themselves with shared secrets (`safeEqual`).
3. **Pages call `requireUser` / `requireManager` / `requireOwner`; server actions call `assertUser` / `assertManager` / `assertOwner`
   before touching `createAdminClient()`.** The service-role client bypasses RLS.
4. **RLS on every table, in the same migration that creates it.** Browsers only SELECT; writes go through server actions.
   New auth users are inactive staff until a Manager/Owner activates them — never read role from user metadata.
5. **Aging is by due date, monthly, matching Xero** — `src/lib/aging.ts`. An invoice due today is overdue (`L`).
   It was verified against the original dashboard (452/452 invoices). Don't change it without re-checking.
6. **Xero is the source of truth for amounts.** `invoices` is replaced each sync; Ascora invoice IDs live in
   `ascora_invoice_ids` so syncs never wipe them.
7. **Notes save locally first, then post to Ascora** (`notes-actions.ts`). Failed/skipped pushes keep the note and can be retried.
8. Record admin actions with `audit()`.
9. Schema changes: add a new file in `supabase/migrations/` (timestamped) and apply it — never edit an applied migration.
10. **On Hold lives in Ascora.** The portal mirrors `onHold` / `billingCustomerOnHold` (nightly, webhook, after writes). Writing goes through
    `setCustomerOnHold` (read full record, change onHold, post back, re-read and diff) and is gated by `ASCORA_HOLD_WRITE_ENABLED`.

## Map

- `src/app/(app)/` — signed-in pages: Debtors (`page.tsx` + `dashboard.tsx`), `follow-ups`, `admin/users|mappings|settings`
- `src/app/(auth)/` — login, forgot-password, set-password; `src/app/auth/confirm` handles emailed links
- `src/app/setup` — one-time first-Owner bootstrap (needs `BOOTSTRAP_TOKEN`; 404s once an Owner exists)
- `src/app/api/cron/[job]` — `sync-xero`, `sync-remittances`, `sync-ascora-customers`, `sync-ascora-holds`, `sync-all`
- `src/app/api/xero/connect|callback` — Owner-only OAuth; tokens AES-GCM encrypted in `integration_secrets`
- `src/app/api/webhooks/ascora` — captures Ascora invoice IDs for deep links
- `src/lib/` — `xero.ts`, `ascora.ts`, `missive.ts`, `sync/*`, `aging.ts`, `auth.ts`, `data.ts`
- `docs/ascora-api.pdf` — Ascora API reference (v1.6). It has no endpoint to READ notes or look up a customer invoice by number.

## Commands

`npm run dev` · `npm run build` · `npx tsc --noEmit` · `npm run lint`
