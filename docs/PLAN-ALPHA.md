# Alpha implementation plan

Status: **superseded on 2026-07-20** by the clean-room Calendar Sync direction.
This historical plan is immutable; do not execute it. Current work is in
`CALENDAR-SYNC.md`, `FOUNDATION-GATE.md`, and `TODO.md`.

1. Establish an Apache-2.0 Go repository with no runtime dependencies.
2. Model fixed events and flexible work items with priority, deadlines,
   durations, windows, energy, focus, and context metadata.
3. Implement a deterministic candidate-slot scorer and capacity explanations.
4. Stage schedule changes as a preview; apply only against the revision used to
   compute the plan; record the operation in an audit log.
5. Persist the single-pod alpha through atomic JSON replacement.
6. Embed a responsive week planner and login flow in the Go binary.
7. Expose health, readiness, and metrics endpoints.
8. Package a restricted non-root Kubernetes Deployment, Service, PVC, and
   NetworkPolicy.
9. Test solver invariants, preview/apply concurrency, persistence, and HTTP
   behavior.
10. Document the full competitive product target without representing future
    provider integrations as implemented.
