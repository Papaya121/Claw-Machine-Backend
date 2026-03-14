-- Core schema for Claw Machine backend (PostgreSQL)

create extension if not exists "pgcrypto";

create type attempt_status as enum ('started', 'inputs_closed', 'resolved', 'claimed', 'cancelled');
create type attempt_result as enum ('win', 'lose', 'void');
create type reward_grant_status as enum ('pending', 'granted', 'failed');

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint unique not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists wallets (
  user_id uuid primary key references users(id) on delete cascade,
  tickets int not null,
  coins bigint not null,
  version int not null
);

create table if not exists attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  status attempt_status not null,
  config_version text not null,
  seed_hash text not null,
  seed_reveal text,
  started_at timestamptz not null,
  resolved_at timestamptz,
  expires_at timestamptz not null,
  risk_score int not null default 0,
  result attempt_result,
  reward_id uuid,
  machine_id text not null,
  client_build text not null
);

create table if not exists attempt_inputs (
  attempt_id uuid not null references attempts(id) on delete cascade,
  seq int not null,
  client_time_ms bigint not null,
  dir_x real not null,
  dir_y real not null,
  received_at timestamptz not null,
  unique (attempt_id, seq)
);

create table if not exists rewards (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  rarity text not null,
  weight int not null,
  is_active boolean not null,
  stock int
);

create table if not exists reward_grants (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null unique references attempts(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  reward_id uuid not null references rewards(id),
  status reward_grant_status not null,
  idempotency_key text unique not null,
  provider_tx_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_events (
  id bigserial primary key,
  user_id uuid,
  attempt_id uuid,
  event_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists anti_cheat_flags (
  id bigserial primary key,
  user_id uuid not null,
  attempt_id uuid not null,
  flag_type text not null,
  severity int not null,
  details jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_attempts_user_started_desc on attempts(user_id, started_at desc);
create index if not exists idx_attempt_inputs_attempt_seq on attempt_inputs(attempt_id, seq);
create index if not exists idx_audit_events_attempt_created on audit_events(attempt_id, created_at);
create index if not exists idx_anti_cheat_flags_user_created_desc on anti_cheat_flags(user_id, created_at desc);
