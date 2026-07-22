alter table projections
  add column last_verified_at timestamptz;

create index projections_destination_verification_due_idx
  on projections (organization_id, last_verified_at asc nulls first, id)
  where status = 'converged'
    and ownership = 'attached'
    and destination_event_id is not null
    and desired_state is not null;
