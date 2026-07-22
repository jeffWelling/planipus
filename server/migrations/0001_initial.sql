create table organizations (
  id uuid primary key,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name text not null check (char_length(name) between 1 and 120),
  default_timezone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table principals (
  id uuid primary key,
  email_normalized text not null unique,
  display_name text not null,
  status text not null check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table memberships (
  organization_id uuid not null references organizations(id) on delete cascade,
  principal_id uuid not null references principals(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, principal_id)
);

create table browser_sessions (
  id uuid primary key,
  principal_id uuid not null references principals(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  token_hash char(64) not null unique,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index browser_sessions_expiry_idx on browser_sessions(expires_at) where revoked_at is null;

create table oauth_transactions (
  id uuid primary key,
  principal_id uuid not null references principals(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  state_hash char(64) not null unique,
  verifier_envelope jsonb not null,
  intent_envelope jsonb not null,
  redirect_uri text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table provider_connections (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  owner_principal_id uuid not null references principals(id) on delete cascade,
  provider text not null check (provider in ('google', 'fake')),
  remote_subject text not null,
  account_label text not null,
  display_label text not null check (char_length(display_label) between 1 and 80),
  intended_role text not null check (intended_role in ('source', 'destination', 'both')),
  email_masked text not null,
  credential_envelope jsonb not null,
  key_version text not null,
  scopes jsonb not null,
  status text not null check (status in ('active', 'action_required', 'revoked')),
  last_success_at timestamptz,
  safe_error_code text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider, remote_subject)
);

create table calendar_endpoints (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  connection_id uuid not null references provider_connections(id) on delete cascade,
  remote_id text not null,
  name text not null,
  timezone text not null,
  access_role text not null,
  readable boolean not null,
  writable boolean not null,
  primary_calendar boolean not null default false,
  capabilities jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, remote_id),
  unique (organization_id, id)
);

create table hours_profiles (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  timezone text not null,
  dst_resolution jsonb not null,
  weekly_intervals jsonb not null,
  exceptions jsonb not null default '[]'::jsonb,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sync_policies (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  source_calendar_id uuid not null,
  destination_calendar_id uuid not null,
  hours_profile_id uuid references hours_profiles(id),
  status text not null check (status in ('active', 'paused', 'deleted')),
  revision integer not null check (revision > 0),
  policy_document jsonb not null,
  policy_hash varchar(71) not null check (policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  last_success_at timestamptz,
  safe_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_calendar_id <> destination_calendar_id),
  foreign key (organization_id, source_calendar_id) references calendar_endpoints(organization_id, id),
  foreign key (organization_id, destination_calendar_id) references calendar_endpoints(organization_id, id)
);
create unique index sync_policy_active_route_idx
  on sync_policies(organization_id, source_calendar_id, destination_calendar_id, policy_hash)
  where status <> 'deleted';

create table policy_previews (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  principal_id uuid not null references principals(id) on delete cascade,
  policy_document jsonb not null,
  policy_hash varchar(71) not null check (policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  source_cursor_fingerprint varchar(71) not null check (source_cursor_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  result_document jsonb not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table source_observations (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  calendar_endpoint_id uuid not null,
  remote_event_id text not null,
  recurrence_identity text not null default '',
  remote_etag text,
  normalized_event jsonb not null,
  observation_hash varchar(71) not null check (observation_hash ~ '^sha256:[0-9a-f]{64}$'),
  managed_copy boolean not null default false,
  tombstone boolean not null default false,
  sync_generation bigint not null,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, calendar_endpoint_id) references calendar_endpoints(organization_id, id),
  unique (calendar_endpoint_id, remote_event_id, recurrence_identity)
);
create index source_observations_policy_idx on source_observations(organization_id, calendar_endpoint_id, tombstone);

create table sync_cursors (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  calendar_endpoint_id uuid not null,
  query_fingerprint varchar(71) not null check (query_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  sync_token text,
  generation bigint not null default 1,
  state text not null check (state in ('full_required', 'syncing', 'ready', 'action_required')),
  last_started_at timestamptz,
  last_full_sync_at timestamptz,
  last_success_at timestamptz,
  safe_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, calendar_endpoint_id) references calendar_endpoints(organization_id, id),
  unique (calendar_endpoint_id, query_fingerprint)
);

create table projections (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  policy_id uuid not null references sync_policies(id) on delete cascade,
  policy_revision integer not null,
  source_observation_id uuid not null references source_observations(id) on delete cascade,
  recurrence_identity text not null default '',
  destination_calendar_id uuid not null,
  destination_event_id text,
  destination_etag text,
  generation integer not null default 1 check (generation > 0),
  intent_sequence bigint not null default 0 check (intent_sequence >= 0),
  desired_hash varchar(71) check (desired_hash ~ '^sha256:[0-9a-f]{64}$'),
  desired_state jsonb,
  status text not null,
  ownership text not null check (ownership in ('attached', 'detached', 'ambiguous')),
  last_success_at timestamptz,
  safe_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, destination_calendar_id) references calendar_endpoints(organization_id, id),
  unique (policy_id, source_observation_id, recurrence_identity)
);

create table outbox_effects (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  policy_id uuid not null references sync_policies(id) on delete cascade,
  projection_id uuid not null references projections(id) on delete cascade,
  policy_revision integer not null,
  operation text not null check (operation in ('create', 'update', 'delete')),
  idempotency_key varchar(71) not null unique check (idempotency_key ~ '^sha256:[0-9a-f]{64}$'),
  desired_state jsonb,
  state text not null check (state in ('pending', 'leased', 'retry', 'succeeded', 'dead')),
  attempt_count integer not null default 0,
  run_after timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  ambiguous boolean not null default false,
  safe_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index outbox_effects_due_idx on outbox_effects(run_after) where state in ('pending', 'retry');
create index outbox_effects_projection_order_idx on outbox_effects(projection_id, created_at, id);

create table scheduled_jobs (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  kind text not null,
  dedupe_key text not null,
  payload jsonb not null,
  state text not null check (state in ('pending', 'leased', 'retry', 'succeeded', 'dead')),
  attempt_count integer not null default 0,
  run_after timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  safe_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index scheduled_jobs_active_dedupe_idx on scheduled_jobs(organization_id, kind, dedupe_key)
  where state in ('pending', 'leased', 'retry');
create index scheduled_jobs_due_idx on scheduled_jobs(run_after) where state in ('pending', 'retry');

create table provider_subscriptions (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  calendar_endpoint_id uuid not null,
  channel_id text not null unique,
  resource_id text,
  token_hash char(64) not null,
  expires_at timestamptz,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, calendar_endpoint_id) references calendar_endpoints(organization_id, id)
);

create table inbox_notifications (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  channel_id text not null,
  message_number text not null,
  resource_state text not null,
  received_at timestamptz not null default now(),
  unique (channel_id, message_number)
);

create table audit_facts (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  principal_id uuid references principals(id) on delete set null,
  actor_kind text not null check (actor_kind in ('user', 'sync', 'recovery')),
  action text not null,
  target_type text not null,
  target_id text not null,
  reason_code text not null,
  before_hash varchar(71) check (before_hash ~ '^sha256:[0-9a-f]{64}$'),
  after_hash varchar(71) check (after_hash ~ '^sha256:[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into organizations(id, slug, name, default_timezone)
values ('00000000-0000-7000-8000-000000000001', 'personal', 'Personal', 'UTC')
on conflict do nothing;

insert into principals(id, email_normalized, display_name, status)
values ('00000000-0000-7000-8000-000000000002', 'owner@localhost.invalid', 'Owner', 'active')
on conflict do nothing;

insert into memberships(organization_id, principal_id, role)
values ('00000000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000002', 'owner')
on conflict do nothing;
