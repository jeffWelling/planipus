create table conflict_response_previews (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  principal_id uuid not null references principals(id) on delete cascade,
  draft_document jsonb not null,
  draft_hash varchar(71) not null check (draft_hash ~ '^sha256:[0-9a-f]{64}$'),
  input_snapshot_hash varchar(71) not null check (input_snapshot_hash ~ '^sha256:[0-9a-f]{64}$'),
  result_document jsonb not null,
  reference_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index conflict_response_previews_expiry_idx
  on conflict_response_previews (expires_at) where consumed_at is null;

create table conflict_response_rules (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  owner_principal_id uuid not null references principals(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  response_calendar_id uuid not null,
  status text not null check (status in ('active', 'paused', 'deleted')),
  revision integer not null check (revision > 0),
  rule_document jsonb not null,
  rule_hash varchar(71) not null check (rule_hash ~ '^sha256:[0-9a-f]{64}$'),
  last_evaluated_at timestamptz,
  last_success_at timestamptz,
  safe_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, response_calendar_id)
    references calendar_endpoints(organization_id, id),
  unique (organization_id, id)
);

create index conflict_response_rules_active_idx
  on conflict_response_rules (organization_id, id) where status = 'active';

create table conflict_response_availability_calendars (
  organization_id uuid not null,
  rule_id uuid not null,
  calendar_endpoint_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (rule_id, calendar_endpoint_id),
  foreign key (organization_id, rule_id)
    references conflict_response_rules(organization_id, id) on delete cascade,
  foreign key (organization_id, calendar_endpoint_id)
    references calendar_endpoints(organization_id, id)
);

create index conflict_response_availability_calendar_idx
  on conflict_response_availability_calendars (organization_id, calendar_endpoint_id, rule_id);

alter table source_observations add constraint source_observations_organization_id_id_key
  unique (organization_id, id);

create table invitation_response_actions (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  rule_id uuid not null,
  rule_revision integer not null check (rule_revision > 0),
  response_calendar_id uuid not null,
  work_observation_id uuid not null,
  remote_event_id text not null,
  recurrence_identity text not null default '',
  work_observation_hash varchar(71) not null check (work_observation_hash ~ '^sha256:[0-9a-f]{64}$'),
  conflict_basis_hash varchar(71) not null check (conflict_basis_hash ~ '^sha256:[0-9a-f]{64}$'),
  expected_remote_revision text,
  desired_comment text not null check (char_length(desired_comment) between 1 and 500),
  status text not null check (status in ('pending', 'applied', 'superseded', 'held')),
  remote_revision text,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  safe_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, rule_id)
    references conflict_response_rules(organization_id, id) on delete cascade,
  foreign key (organization_id, response_calendar_id)
    references calendar_endpoints(organization_id, id),
  foreign key (organization_id, work_observation_id)
    references source_observations(organization_id, id),
  unique (rule_id, work_observation_id),
  unique (organization_id, id)
);

create index invitation_response_actions_rule_status_idx
  on invitation_response_actions (organization_id, rule_id, status, created_at);

comment on table conflict_response_rules is
  'No-copy rules that use private free/busy inputs to decline unanswered invitations on one writable work calendar.';
comment on table invitation_response_actions is
  'Durable, idempotent RSVP decline intent. It stores no personal event identity or content.';
