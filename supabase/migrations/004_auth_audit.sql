-- ============================================================================
-- 004_auth_audit.sql — DA3 Q2: users (bcrypt + TOTP + roles) and audit_log
-- Run in the Supabase SQL Editor. Safe to re-run.
-- ============================================================================

create table if not exists users (
    id            uuid primary key default gen_random_uuid(),
    email         text not null unique,
    password_hash text not null,                         -- bcrypt ($2b$10$...)
    role          text not null default 'viewer' check (role in ('admin','editor','viewer')),
    totp_secret   text,                                  -- AES-256-GCM encrypted (v1:iv:tag:ct)
    mfa_enabled   boolean not null default false,
    created_at    timestamptz not null default now()
);

create table if not exists audit_log (
    id           uuid primary key default gen_random_uuid(),
    ts           timestamptz not null default now(),
    event        text not null,        -- register, login_failed, login_success, mfa_failed, request_rejected, nodes_delete, ...
    actor_id     uuid,
    actor_email  text,
    actor_role   text,
    ip           text,
    method       text,
    path         text,
    status       int,
    details      jsonb default '{}'
);

create index if not exists idx_audit_ts        on audit_log (ts desc);
create index if not exists idx_audit_event_ts  on audit_log (event, ts desc);
create index if not exists idx_audit_email_ts  on audit_log (actor_email, ts desc);

-- Row Level Security ON with NO policies: the public anon key can read nothing here.
-- Only the backend's service key (which bypasses RLS) can touch these tables.
alter table users     enable row level security;
alter table audit_log enable row level security;

-- Append-only audit log: block UPDATE/DELETE even for the service role via trigger.
create or replace function audit_log_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;

drop trigger if exists trg_audit_no_update on audit_log;
create trigger trg_audit_no_update before update or delete on audit_log
  for each row execute function audit_log_immutable();
