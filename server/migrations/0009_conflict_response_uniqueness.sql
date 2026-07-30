create unique index conflict_response_rules_one_live_response_idx
  on conflict_response_rules (organization_id, response_calendar_id)
  where status <> 'deleted';

comment on index conflict_response_rules_one_live_response_idx is
  'One deterministic non-deleted conflict-response rule may control a response calendar.';
