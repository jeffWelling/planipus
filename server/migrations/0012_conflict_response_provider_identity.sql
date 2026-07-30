alter table conflict_response_rules
  add column response_provider_identity text;

update conflict_response_rules as rule
set response_provider_identity =
  octet_length(connection.provider)::text || ':' || connection.provider
  || octet_length(case when connection.provider = 'google' then 'global' else endpoint.connection_id::text end)::text
  || ':' || case when connection.provider = 'google' then 'global' else endpoint.connection_id::text end
  || octet_length(endpoint.remote_id)::text || ':' || endpoint.remote_id
from calendar_endpoints as endpoint
join provider_connections as connection on connection.id = endpoint.connection_id
where endpoint.id = rule.response_calendar_id
  and endpoint.organization_id = rule.organization_id;

alter table conflict_response_rules
  alter column response_provider_identity set not null;

create unique index conflict_response_rules_one_live_provider_idx
  on conflict_response_rules (organization_id, response_provider_identity)
  where status <> 'deleted';

comment on column conflict_response_rules.response_provider_identity is
  'Length-prefixed provider calendar identity. Google calendar IDs are global across delegated connections.';
comment on index conflict_response_rules_one_live_provider_idx is
  'One deterministic non-deleted conflict-response rule may control an underlying provider calendar.';
