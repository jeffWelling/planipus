create table planning_previews (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  principal_id uuid not null references principals(id) on delete cascade,
  rule_kind text not null check (rule_kind in ('availability_boundary', 'smart_meeting')),
  draft_document jsonb not null,
  draft_hash varchar(71) not null check (draft_hash ~ '^sha256:[0-9a-f]{64}$'),
  input_snapshot_hash varchar(71) not null check (input_snapshot_hash ~ '^sha256:[0-9a-f]{64}$'),
  result_document jsonb not null,
  planning_reference_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index planning_previews_expiry_idx on planning_previews(expires_at) where consumed_at is null;

create table planning_rules (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  owner_principal_id uuid not null references principals(id) on delete cascade,
  kind text not null check (kind in ('availability_boundary', 'smart_meeting')),
  name text not null check (char_length(name) between 1 and 160),
  target_calendar_id uuid not null,
  status text not null check (status in ('active', 'paused', 'deleting', 'deleted')),
  revision integer not null check (revision > 0),
  rule_document jsonb not null,
  rule_hash varchar(71) not null check (rule_hash ~ '^sha256:[0-9a-f]{64}$'),
  last_planned_at timestamptz,
  last_success_at timestamptz,
  safe_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, target_calendar_id) references calendar_endpoints(organization_id, id),
  unique (organization_id, id)
);
create index planning_rules_active_idx on planning_rules(organization_id, kind, id) where status = 'active';

create table planned_events (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  rule_id uuid not null,
  rule_revision integer not null check (rule_revision > 0),
  occurrence_key text not null check (char_length(occurrence_key) between 1 and 200),
  destination_calendar_id uuid not null,
  generation integer not null default 1 check (generation > 0),
  intent_sequence bigint not null default 0 check (intent_sequence >= 0),
  destination_event_id text,
  destination_etag text,
  desired_hash varchar(71) check (desired_hash ~ '^sha256:[0-9a-f]{64}$'),
  desired_state jsonb,
  status text not null check (status in (
    'pending_create', 'pending_update', 'pending_delete', 'converged',
    'held', 'unmet', 'skipped', 'deleted'
  )),
  send_updates boolean not null default false,
  reason_code text not null,
  last_success_at timestamptz,
  last_verified_at timestamptz,
  safe_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, rule_id) references planning_rules(organization_id, id) on delete cascade,
  foreign key (organization_id, destination_calendar_id) references calendar_endpoints(organization_id, id),
  unique (rule_id, occurrence_key),
  unique (organization_id, id),
  unique (organization_id, rule_id, id),
  check (
    (status in ('unmet', 'skipped', 'pending_delete', 'deleted') and desired_state is null)
    or
    (status not in ('unmet', 'skipped', 'pending_delete', 'deleted') and desired_state is not null and desired_hash is not null)
  )
);
create index planned_events_rule_status_idx on planned_events(organization_id, rule_id, status, occurrence_key);

create table planning_suggestions (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  rule_id uuid not null,
  planned_event_id uuid not null,
  kind text not null check (kind in ('move', 'shorten', 'skip')),
  basis_hash varchar(71) not null check (basis_hash ~ '^sha256:[0-9a-f]{64}$'),
  proposed_state jsonb,
  reason_code text not null,
  status text not null check (status in ('pending', 'accepted', 'dismissed', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, rule_id) references planning_rules(organization_id, id) on delete cascade,
  foreign key (organization_id, rule_id, planned_event_id)
    references planned_events(organization_id, rule_id, id) on delete cascade
);
create unique index planning_suggestions_basis_idx
  on planning_suggestions(planned_event_id, basis_hash);

comment on table planning_rules is
  'Planipus-owned scheduling rules. Calendar bridges remain in sync_policies and never share ownership rows.';
comment on table planned_events is
  'Durable desired state for Planipus-created protection and Smart Meeting events; scheduled_jobs drives provider application.';
