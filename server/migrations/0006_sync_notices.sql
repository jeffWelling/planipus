create table sync_notices (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  policy_id uuid not null references sync_policies(id) on delete cascade,
  projection_id uuid not null references projections(id) on delete cascade,
  kind text not null check (kind in (
    'copy_edit_reverted',
    'copy_delete_restored',
    'copy_edit_held',
    'copy_delete_held'
  )),
  status text not null default 'unread' check (status in ('unread', 'acknowledged', 'resolved')),
  resolution text check (resolution in ('restore', 'keep_and_detach')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sync_notices_open_idx
  on sync_notices (organization_id, created_at desc)
  where status <> 'resolved';

create index sync_notices_projection_idx
  on sync_notices (projection_id);

comment on table sync_notices is
  'User-facing records of direct edits/deletions of managed destination copies. detail carries only fields already present in the projection''s privacy-transformed desired state, never raw source event content.';

comment on column sync_notices.resolution is
  'For held notices: the decision the user took. restore re-applies the source-authoritative copy; keep_and_detach keeps the direct change and stops managing the copy.';
