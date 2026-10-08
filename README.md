# Precision Thermal · Debtors portal

Aged debtors for DND Insulation and Gippsland Insulation, with Ascora notes and links.
Plan: see the "Precision Thermal Debtors Portal — Design & Build Plan" doc. Working rules for changes: `CLAUDE.md`.

## One-time setup

1. **Supabase** (`debtors-portal`): migrations in `supabase/migrations/` are already applied.
   - Authentication → Sign In / Providers → turn **off** "Allow new users to sign up".
   - Authentication → URL Configuration → Site URL `https://debtors.precisionthermal.com.au`, and add it to Redirect URLs.
   - Authentication → Emails → paste `supabase/templates/recovery.html` and `invite.html` into the Reset Password and Invite templates.
   - Authentication → Emails → SMTP: Resend (`smtp.resend.com`, port 465, user `resend`, password = Resend API key), sender `noreply@dndinsulation.com.au`.
   - Authentication → Policies: minimum password length 12, enable leaked-password protection.
2. **Vercel**: add the variables from `.env.example`, add domain `debtors.precisionthermal.com.au` (CNAME `debtors` → `cname.vercel-dns.com`).
3. Visit `https://debtors.precisionthermal.com.au/setup?token=<BOOTSTRAP_TOKEN>` to create the first Owner, then delete `BOOTSTRAP_TOKEN`.
4. **Xero**: developer.xero.com → New app (Web app), redirect URI `https://debtors.precisionthermal.com.au/api/xero/callback`.
   Put the client ID/secret in Vercel, redeploy, then Settings → Connect Xero → Refresh from Xero.
5. **Ascora**: API key into `ASCORA_API_KEY`. Copy one customer URL and one invoice URL from Ascora into
   `ASCORA_CUSTOMER_URL` / `ASCORA_INVOICE_URL`, replacing the ID with `{id}`. Subscribe the web hooks (see `src/app/api/webhooks/ascora/route.ts`).
6. **Missive + Claude API**: `MISSIVE_API_TOKEN` (the token's user must see both accounts inboxes) and `ANTHROPIC_API_KEY`.

## Schedules

Vercel Cron runs `/api/cron/sync-all` daily at 18:30 UTC (5:30am Melbourne in summer).
Daytime refreshes run from Supabase `pg_cron` every 2 hours on weekdays (see migration `..._schedules.sql`), and Managers can press **Refresh** in Settings.

## Develop

```
cp .env.example .env.local   # fill in
npm install
npm run dev
```
