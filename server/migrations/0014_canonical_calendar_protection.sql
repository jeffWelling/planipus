alter table sync_policies
  add column source_provider_identity text,
  add column destination_provider_identity text;

update sync_policies as policy
set source_provider_identity =
  octet_length(connection.provider)::text || ':' || connection.provider
  || octet_length(case when connection.provider = 'google' then 'global' else endpoint.connection_id::text end)::text
  || ':' || case when connection.provider = 'google' then 'global' else endpoint.connection_id::text end
  || octet_length(endpoint.remote_id)::text || ':' || endpoint.remote_id
from calendar_endpoints as endpoint
join provider_connections as connection on connection.id = endpoint.connection_id
where endpoint.id = policy.source_calendar_id
  and endpoint.organization_id = policy.organization_id;

update sync_policies as policy
set destination_provider_identity =
  octet_length(connection.provider)::text || ':' || connection.provider
  || octet_length(case when connection.provider = 'google' then 'global' else endpoint.connection_id::text end)::text
  || ':' || case when connection.provider = 'google' then 'global' else endpoint.connection_id::text end
  || octet_length(endpoint.remote_id)::text || ':' || endpoint.remote_id
from calendar_endpoints as endpoint
join provider_connections as connection on connection.id = endpoint.connection_id
where endpoint.id = policy.destination_calendar_id
  and endpoint.organization_id = policy.organization_id;

alter table sync_policies
  alter column source_provider_identity set not null,
  alter column destination_provider_identity set not null;

-- Fail closed on any pre-existing delegated-alias self-copy bridge. Preserve
-- its rows for audit/recovery, stop queued effects/jobs, and leave historical
-- destination copies untouched for explicit operator review.
update sync_policies
set status = 'deleted',
    safe_error_code = 'same_provider_calendar',
    updated_at = now()
where source_provider_identity = destination_provider_identity
  and status <> 'deleted';

insert into audit_facts (
  id,
  organization_id,
  principal_id,
  actor_kind,
  action,
  target_type,
  target_id,
  reason_code,
  before_hash,
  after_hash,
  detail
)
select (
    substr(md5('planipus:0014:' || policy.id::text), 1, 8) || '-'
    || substr(md5('planipus:0014:' || policy.id::text), 9, 4) || '-'
    || substr(md5('planipus:0014:' || policy.id::text), 13, 4) || '-'
    || substr(md5('planipus:0014:' || policy.id::text), 17, 4) || '-'
    || substr(md5('planipus:0014:' || policy.id::text), 21, 12)
  )::uuid,
  policy.organization_id,
  null,
  'recovery',
  'policy.quarantined_same_provider_calendar',
  'sync_policy',
  policy.id::text,
  'same_provider_calendar',
  null,
  null,
  '{"historical_copies_untouched":true}'::jsonb
from sync_policies as policy
where policy.source_provider_identity = policy.destination_provider_identity
  and policy.safe_error_code = 'same_provider_calendar'
on conflict (id) do nothing;

update outbox_effects as effect
set state = 'dead',
    lease_owner = null,
    lease_expires_at = null,
    safe_error_code = 'same_provider_calendar',
    updated_at = now()
from sync_policies as policy
where policy.id = effect.policy_id
  and policy.source_provider_identity = policy.destination_provider_identity
  and effect.state in ('pending', 'leased', 'retry');

update scheduled_jobs as job
set state = 'succeeded',
    lease_owner = null,
    lease_expires_at = null,
    safe_error_code = 'same_provider_calendar',
    updated_at = now()
from sync_policies as policy
where job.organization_id = policy.organization_id
  and job.kind = 'reconcile_policy'
  and job.payload->>'policy_id' = policy.id::text
  and policy.source_provider_identity = policy.destination_provider_identity
  and job.state in ('pending', 'leased', 'retry');

alter table sync_policies
  add constraint sync_policies_distinct_provider_calendars
    check (status = 'deleted' or source_provider_identity <> destination_provider_identity);

create index sync_policies_source_provider_identity_idx
  on sync_policies (organization_id, source_provider_identity, status);

create index sync_policies_destination_provider_identity_idx
  on sync_policies (organization_id, destination_provider_identity, status);

alter table conflict_response_availability_calendars
  add column provider_calendar_identity text;

update conflict_response_availability_calendars as availability
set provider_calendar_identity =
  octet_length(connection.provider)::text || ':' || connection.provider
  || octet_length(case when connection.provider = 'google' then 'global' else endpoint.connection_id::text end)::text
  || ':' || case when connection.provider = 'google' then 'global' else endpoint.connection_id::text end
  || octet_length(endpoint.remote_id)::text || ':' || endpoint.remote_id
from calendar_endpoints as endpoint
join provider_connections as connection on connection.id = endpoint.connection_id
where endpoint.id = availability.calendar_endpoint_id
  and endpoint.organization_id = availability.organization_id;

alter table conflict_response_availability_calendars
  alter column provider_calendar_identity set not null;

create unique index conflict_response_availability_provider_identity_rule_idx
  on conflict_response_availability_calendars (rule_id, provider_calendar_identity);

create index conflict_response_availability_provider_identity_lookup_idx
  on conflict_response_availability_calendars
    (organization_id, provider_calendar_identity, rule_id);

comment on column sync_policies.source_provider_identity is
  'Canonical underlying provider calendar; Google delegated aliases share one global identity.';
comment on column sync_policies.destination_provider_identity is
  'Canonical underlying provider calendar; differs from source to prevent alias self-copy loops.';
comment on column conflict_response_availability_calendars.provider_calendar_identity is
  'Canonical protected availability calendar identity across delegated connection aliases.';
