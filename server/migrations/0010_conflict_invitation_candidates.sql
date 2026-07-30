create index source_observations_conflict_candidates_idx
  on source_observations (
    organization_id,
    calendar_endpoint_id,
    ((normalized_event #>> '{timing,start_instant}')),
    id
  )
  where managed_copy = false
    and tombstone = false
    and normalized_event->>'lifecycle' = 'confirmed'
    and normalized_event->>'origin' = 'provider_original'
    and normalized_event #>> '{timing,kind}' = 'timed'
    and normalized_event #>> '{relationship,role}' = 'attendee'
    and normalized_event #>> '{relationship,response}' = 'needs_action';

comment on index source_observations_conflict_candidates_idx is
  'Bounds conflict-response scans to future unanswered provider invitations instead of unrelated calendar history.';
