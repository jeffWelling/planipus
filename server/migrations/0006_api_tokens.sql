create table api_tokens (
  id uuid primary key,
  organization_id uuid not null,
  principal_id uuid not null,
  label text not null check (char_length(label) between 1 and 80),
  token_hash char(64) not null unique,
  scopes jsonb not null check (
    jsonb_typeof(scopes) = 'array'
    and jsonb_array_length(scopes) between 1 and 3
    and scopes <@ '["read", "propose", "apply"]'::jsonb
  ),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, principal_id)
    references memberships(organization_id, principal_id) on delete cascade
);

create index api_tokens_active_expiry_idx
  on api_tokens (organization_id, expires_at)
  where revoked_at is null;

alter table audit_facts drop constraint audit_facts_actor_kind_check;
alter table audit_facts add constraint audit_facts_actor_kind_check
  check (actor_kind in ('user', 'api_token', 'sync', 'recovery'));

comment on table api_tokens is
  'Scoped machine credentials. Plaintext is returned once and never persisted.';
