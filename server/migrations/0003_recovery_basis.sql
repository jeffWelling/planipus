alter table projections
  add column source_basis_hash varchar(71)
  check (source_basis_hash ~ '^sha256:[0-9a-f]{64}$'),
  add column recovery_operation text
  check (recovery_operation in ('create', 'update', 'delete'));

alter table outbox_effects
  add column source_basis_hash varchar(71)
  check (source_basis_hash ~ '^sha256:[0-9a-f]{64}$');

comment on column projections.source_basis_hash is
  'Hash of source observation content plus tombstone state used to derive current desired state; null means reconcile rather than replay.';

comment on column projections.recovery_operation is
  'Current shadow-evaluated provider operation allowed only after explicit marker-verified recovery; null means no write is authorized.';

comment on column outbox_effects.source_basis_hash is
  'Hash of source observation content plus tombstone state used to derive this intent; null means it must be superseded and reconciled.';
