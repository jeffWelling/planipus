# `@planipus/calendar-sync`

Provider-neutral, deterministic Calendar Sync policy engine. The package owns
no database, network client, OAuth credential, provider SDK, queue, or UI. Both
editions adapt their own observations into these types and adapt `DesiredCopy`
into provider writes.

```ts
import {
  evaluateHours,
  evaluatePolicy,
  canonicalizeJson,
  sha256Canonical,
  type PolicyEvaluationInput,
  type PolicyEvaluationResult,
  type DesiredCopy,
} from "@planipus/calendar-sync";
```

Main exports:

- `evaluatePolicy(input): PolicyEvaluationResult`
- `evaluateHours(input): HoursEvaluationResult`
- `canonicalizeJson(value): string`
- `sha256Canonical(value): string`
- all provider-neutral contract types

Recurring events are occurrence-materialized in v1. The caller supplies a
normalized occurrence identity and observed occurrence timing. The desired copy
is a single occurrence and does not contain a provider recurrence rule.

Marker-only evidence prevents a source from being recursively mirrored but does
not grant ownership. Only an attached projection authorizes updating or deleting
a destination event. Detached projections retain their marker and produce no
effects.
