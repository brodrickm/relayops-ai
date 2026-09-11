create extension if not exists pgcrypto;

create table if not exists public.testers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  full_name text,
  phone text,
  sms_consent boolean not null default false,
  lifecycle_status text not null default 'intake_received' check (lifecycle_status in ('intake_received','acknowledged','testing','feedback_received','completed','failed')),
  acknowledgment_status text not null default 'pending' check (acknowledgment_status in ('pending','queued','sent','delivered','failed')),
  followup_status text not null default 'pending' check (followup_status in ('pending','queued','sent','delivered','cancelled','failed')),
  followup_due_at timestamptz,
  last_intake_at timestamptz,
  last_feedback_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists testers_org_email_uidx on public.testers (organization_id, lower(trim(email)));
create index if not exists testers_lifecycle_idx on public.testers (organization_id, lifecycle_status, updated_at desc);

create table if not exists public.intake_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tester_id uuid not null references public.testers(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  idempotency_key text not null unique,
  source text not null default 'korra_web',
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'received' check (status in ('received','processing','completed','duplicate','retrying','failed')),
  attempt_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists intake_submissions_tester_idx on public.intake_submissions (tester_id, created_at desc);

alter table public.intake_submissions add column if not exists feedback_token_hash text;
alter table public.intake_submissions add column if not exists feedback_expires_at timestamptz;
create unique index if not exists intake_submissions_feedback_token_uidx on public.intake_submissions (feedback_token_hash) where feedback_token_hash is not null;

create table if not exists public.organization_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  owner_email text not null,
  owner_phone text,
  owner_sms_consent boolean not null default false,
  sms_provider text,
  app_url text not null default 'https://korra-iota.vercel.app',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tester_id uuid references public.testers(id) on delete set null,
  action_id uuid references public.agent_actions(id) on delete set null,
  channel text not null check (channel in ('email','sms')),
  message_kind text not null check (message_kind in ('tester_acknowledgment','tester_followup','approval_request','approval_result','action_execution')),
  recipient text not null,
  idempotency_key text not null unique,
  status text not null default 'queued' check (status in ('queued','sending','sent','delivered','retrying','failed','cancelled','skipped')),
  provider text,
  provider_message_id text,
  payload jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  next_retry_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists outbound_messages_queue_idx on public.outbound_messages (status, next_retry_at, created_at);
create index if not exists outbound_messages_tester_idx on public.outbound_messages (tester_id, created_at desc);

create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  action_id uuid not null unique references public.agent_actions(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  decision text not null default 'pending' check (decision in ('pending','approved','rejected','expired')),
  decided_at timestamptz,
  decision_source text check (decision_source in ('secure_link','sms_reply','operator')),
  email_status text not null default 'queued' check (email_status in ('queued','sent','delivered','failed','skipped')),
  sms_status text not null default 'skipped' check (sms_status in ('queued','sent','delivered','failed','skipped')),
  sms_correlation_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists approval_requests_pending_idx on public.approval_requests (decision, expires_at);

create table if not exists public.tester_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tester_id uuid not null references public.testers(id) on delete cascade,
  intake_submission_id uuid references public.intake_submissions(id) on delete set null,
  idempotency_key text not null unique,
  easy_text text,
  confusing_text text,
  failed_text text,
  expected_next text,
  rating integer check (rating between 1 and 5),
  raw_feedback jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tester_feedback_tester_idx on public.tester_feedback (tester_id, created_at desc);

create table if not exists public.lifecycle_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tester_id uuid references public.testers(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  action_id uuid references public.agent_actions(id) on delete set null,
  event_type text not null,
  event_status text not null default 'recorded',
  idempotency_key text unique,
  details jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists lifecycle_events_org_created_idx on public.lifecycle_events (organization_id, created_at desc);
create index if not exists lifecycle_events_failures_idx on public.lifecycle_events (event_status, created_at desc) where event_status = 'failed';

alter table public.testers enable row level security;
alter table public.organization_settings enable row level security;
alter table public.intake_submissions enable row level security;
alter table public.outbound_messages enable row level security;
alter table public.approval_requests enable row level security;
alter table public.tester_feedback enable row level security;
alter table public.lifecycle_events enable row level security;

create or replace view public.korra_owner_attention
with (security_invoker = true)
as
select
  aa.organization_id,
  aa.id as action_id,
  aa.lead_id,
  l.full_name,
  l.email,
  l.phone,
  l.request,
  l.urgency,
  aa.action_type,
  aa.status as action_status,
  aa.risk,
  aa.output,
  ar.decision as approval_decision,
  ar.expires_at as approval_expires_at,
  ar.email_status as approval_email_status,
  ar.sms_status as approval_sms_status,
  case
    when aa.error is not null then 'Resolve action failure'
    when ar.decision = 'pending' and ar.expires_at <= now() then 'Renew expired approval request'
    when aa.status = 'proposed' and aa.risk = 'approval_required' then 'Review and approve or reject'
    when aa.status = 'approved' and aa.executed_at is null then 'Run approved action'
    else 'No action required'
  end as next_best_action,
  aa.created_at
from public.agent_actions aa
left join public.leads l on l.id = aa.lead_id
left join public.approval_requests ar on ar.action_id = aa.id
where aa.status in ('proposed','approved','failed')
order by
  case when aa.error is not null then 0 when aa.status = 'approved' then 1 else 2 end,
  aa.created_at asc;

revoke all on public.testers, public.organization_settings, public.intake_submissions, public.outbound_messages, public.approval_requests, public.tester_feedback, public.lifecycle_events from anon, authenticated;
revoke all on public.korra_owner_attention from anon, authenticated;

comment on view public.korra_owner_attention is 'Private owner queue showing approvals, failures, and the next best action. Access only through privileged server workflows.';

