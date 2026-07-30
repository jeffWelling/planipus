alter table conflict_response_previews
  drop constraint conflict_response_previews_input_snapshot_hash_check;
alter table conflict_response_previews
  alter column input_snapshot_hash type varchar(76);
alter table conflict_response_previews
  add constraint conflict_response_previews_input_snapshot_hash_check
  check (input_snapshot_hash ~ '^(sha256|hmac-sha256):[0-9a-f]{64}$');

alter table invitation_response_actions
  drop constraint invitation_response_actions_conflict_basis_hash_check;
alter table invitation_response_actions
  alter column conflict_basis_hash type varchar(76);
alter table invitation_response_actions
  add constraint invitation_response_actions_conflict_basis_hash_check
  check (conflict_basis_hash ~ '^(sha256|hmac-sha256):[0-9a-f]{64}$');

comment on column conflict_response_previews.input_snapshot_hash is
  'New values are domain-separated HMAC-SHA-256; sha256 is accepted only for pre-release migration compatibility.';
comment on column invitation_response_actions.conflict_basis_hash is
  'New values are domain-separated HMAC-SHA-256 so busy intervals resist offline enumeration.';
