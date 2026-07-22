-- Windowed scheduler deduplication must see retained terminal jobs as well as
-- active jobs. Keep the existing partial unique index for repeatable source
-- sync, and add a non-unique all-state lookup index for enqueueOnce.
create index scheduled_jobs_history_dedupe_idx
  on scheduled_jobs (organization_id, kind, dedupe_key);
