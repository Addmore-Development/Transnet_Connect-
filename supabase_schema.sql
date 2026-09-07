-- Run this in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Creates the single "cases" table that backs the whole app (Case
-- Management, Dashboard, Stakeholders, and Intelligence are all derived
-- from this one table, same as the old in-memory/localStorage version).

create table if not exists public.cases (
  id            text primary key,           -- e.g. 'TC-2026-1042'
  created       text not null,               -- display string, e.g. '31 Aug 09:18'
  created_at    timestamptz not null default now(), -- real timestamp, for sorting
  stakeholder   text not null,               -- organisation name
  name          text,                        -- contact person's name
  type          text,                        -- Community / Business / Supplier / Media / Government etc
  channel       text,                        -- WhatsApp / Email / Contact Centre / Web / QR
  issue         text,
  od            text,                        -- TFR / TNPA / TE / SCM / Group CA
  owner         text,
  risk          text,                        -- Low / Medium / High
  status        text not null default 'Open',-- Open / In Progress / Escalated / Resolved
  sla           text,
  province      text,
  sentiment     text,                        -- Positive / Neutral / Negative
  message       text                         -- the original stakeholder message
);

-- Keeps "newest first" queries fast as the table grows.
create index if not exists cases_created_at_idx on public.cases (created_at desc);

-- Row Level Security: ON, with no policies defined for the anon/public role.
-- This means the anon/publishable key CANNOT read or write this table at
-- all — only server-side code using the secret/service_role key can, which
-- matches how this app works (the browser never talks to Supabase
-- directly; it only talks to your own /api/cases endpoint, which uses the
-- secret key). This is the safe default — do not add a public policy here
-- unless you specifically want unauthenticated direct browser access.
alter table public.cases enable row level security;
