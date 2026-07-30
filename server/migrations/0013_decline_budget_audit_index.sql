create index audit_facts_invitation_decline_budget_idx
  on audit_facts (organization_id, created_at, target_id)
  where action = 'invitation_response.declined'
    and target_type = 'invitation_response_action';

comment on index audit_facts_invitation_decline_budget_idx is
  'Supports the rolling automatic-decline safety budget from immutable provider-write facts.';
