create extension if not exists pgcrypto;

create type public.lead_status as enum ('new','qualified','awaiting_approval','contacted','booked','closed','archived');
create type public.action_risk as enum ('low','approval_required','blocked');
create type public.action_status as enum ('proposed','approved','rejected','executed','failed');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source text not null,
  full_name text,
  email text,
  phone text,
  request text not null,
  status public.lead_status not null default 'new',
  urgency text,
  estimated_value numeric(12,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agent_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  action_type text not null,
  risk public.action_risk not null,
  status public.action_status not null default 'proposed',
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  approved_by uuid,
  approved_at timestamptz,
  executed_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

create table public.metrics_daily (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  metric_date date not null,
  leads_received integer not null default 0,
  median_response_minutes numeric(10,2),
  booked_jobs integer not null default 0,
  estimated_revenue numeric(12,2) not null default 0,
  primary key (organization_id, metric_date)
);

alter table public.organizations enable row level security;
alter table public.leads enable row level security;
alter table public.agent_actions enable row level security;
alter table public.metrics_daily enable row level security;

create index leads_org_status_idx on public.leads (organization_id, status, created_at desc);
create index actions_org_status_idx on public.agent_actions (organization_id, status, created_at desc);

comment on table public.agent_actions is 'Append-oriented audit log for proposed and executed agent actions. Consequential actions require approval before execution.';

