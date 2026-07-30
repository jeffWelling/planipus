alter table provider_connections
  drop constraint provider_connections_intended_role_check;

alter table provider_connections
  add constraint provider_connections_intended_role_check
  check (intended_role in ('availability', 'source', 'destination', 'both'));

comment on column provider_connections.intended_role is
  'availability grants/query free-busy only and is never event-synced; source/destination/both retain bridge semantics.';
