begin;

do $$
begin
  if to_regclass('public.triage_runs') is null then
    raise exception 'Required existing table public.triage_runs does not exist.';
  end if;
end
$$;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  external_customer_id text,
  normalized_email text,
  normalized_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists customers_external_customer_id_key
  on public.customers (external_customer_id) where external_customer_id is not null;
create unique index if not exists customers_normalized_email_key
  on public.customers (normalized_email) where normalized_email is not null;
create unique index if not exists customers_normalized_phone_key
  on public.customers (normalized_phone) where normalized_phone is not null;

create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  case_reference text not null unique check (case_reference ~ '^CASE-[2-9A-HJ-NP-Z]{6}$'),
  customer_id uuid not null references public.customers(id) on delete restrict,
  order_id text,
  summary text not null,
  status text not null check (status in ('open', 'awaiting_customer', 'action_pending', 'escalated', 'resolved')),
  decision_due_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  check ((status = 'resolved') = (resolved_at is not null))
);

create index if not exists cases_customer_status_idx on public.cases (customer_id, status);
create index if not exists cases_customer_order_idx on public.cases (customer_id, order_id);

create table if not exists public.case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete restrict,
  request_id text not null,
  source text not null,
  external_message_id text,
  event_type text not null,
  decision_type text check (decision_type is null or decision_type in ('answer', 'escalate', 'contradiction')),
  confidence text check (confidence is null or confidence in ('high', 'medium', 'low')),
  action_status text check (action_status is null or action_status in ('none', 'pending', 'unclear')),
  created_at timestamptz not null default now()
);

create index if not exists case_events_case_created_idx on public.case_events (case_id, created_at);
create index if not exists case_events_request_id_idx on public.case_events (request_id);
create unique index if not exists case_events_external_message_key
  on public.case_events (source, external_message_id) where external_message_id is not null;

alter table if exists public.triage_runs
  add column if not exists request_id text,
  add column if not exists case_id uuid references public.cases(id) on delete restrict;

create index if not exists triage_runs_request_id_idx on public.triage_runs (request_id);
create index if not exists triage_runs_case_id_idx on public.triage_runs (case_id);

alter table public.customers enable row level security;
alter table public.cases enable row level security;
alter table public.case_events enable row level security;

grant select, insert, update, delete on table
  public.customers, public.cases, public.case_events
  to service_role;

-- No client policies are created. These records are server-side only and are accessed
-- by the existing Supabase secret/service credential.

commit;
