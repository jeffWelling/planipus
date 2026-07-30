# Surface contract — API, CLI, MCP, and web

Status: **decided, unimplemented.** This document specifies the operation
registry, the parity contract between surfaces, and the CLI's agent-output
envelope. It supersedes the implicit position in which `web/src/api.ts` was the
de-facto API contract.

`CALENDAR-SYNC.md` and `conformance/calendar-sync/v1` remain authoritative for
*behavior*. This document is authoritative for *surface reachability*. They are
siblings: one binds what the product does, the other binds who can ask it to.

---

## 1. Principle

> **One registry is the source of truth. Thin surfaces are generated from it;
> thick surfaces are checked against it. Human mode is the product; agent mode
> is the same facts with the prose removed.**

The repository already demonstrates the failure this exists to prevent. One
1,462-line `server/src/api/app.ts` holds 46 hand-registered routes; a hand-written
339-line MCP tool table sits beside it; `web/src/api.ts` is a third hand-written
catalogue; `docs/API.md` documents roughly thirty routes that do not exist, plus a
representative policy draft that would `400` against the shipped `parsePolicyDraft`.

Nobody *decided* that `bridge.recover` would be web-reachable with no MCP tool
while `bridge.reconcile` got an MCP tool no UI calls, or that the MCP Zod schemas
would be stricter than the routes they wrap. That is simply what a fourth
hand-written catalogue buys.

`registry/v1/operations.json` declares every operation once: `id`,
`noun`, `verb`, HTTP method/path, `auth_preset` (one of the four literal preset
names at `app.ts:287-299`), `scope`, `mutating`, danger class, capability gate,
`effects[]`, output schema id, exit codes, `status` (`shipped|planned`), and a
`surfaces` object binding it to web, mcp and cli.

**Generate vs. check is decided by blast radius, not ideology.**

| Surface | Treatment | Why |
|---|---|---|
| MCP tool registrations | Generated | Thin, declarative, and currently *present-but-wrong* in three places |
| CLI parser + completions | Generated | Handwriting adds nothing |
| Operation tables in docs | Generated into fences | `docs/API.md`'s thirty fictional routes could not have been written under this gate |
| Served OpenAPI + JSON Schemas | Generated | Today's `openapi.json` is a bare path list with no models |
| `app.ts` routes and auth presets | **Checked** by AST extractor | Real code on the release-critical path; rewriting adds risk, checking adds none |
| `web/src/api.ts` call sites | **Checked** by AST extractor | Same |

Both mechanisms fail the build on divergence, so both are structural.

### Four commitments

1. **The API is the only authority.** The CLI imports no server internals, no
   `pg`, no `kysely`, no `fastify`, no `@modelcontextprotocol/sdk`. It speaks
   nothing but `/api/v1/`.
2. **Human mode is the product; `--agent` removes rather than adds.** Both modes
   render from the same handler return value, so they cannot disagree about
   facts — only about presentation.
3. **Honesty over convenience.** A 202 is `accepted`, never `applied`. A mutation
   timeout is outcome-unknown with its own exit code. A capability-gated
   activation is `gated`, not `failed`.
4. **Parity is a floor, not a ceiling.** The web bridge wizard hard-codes the
   selection block, the 30/365 horizon, DST resolution and `#nosync`
   (`web/src/api.ts:408-446`) where the API accepts all of them. The CLI exposes
   the full draft. `cli_exceeds_web` is expected to be positive and is the reason
   the CLI is worth using.

---

## 2. Current surface truth

Measured, not assumed. All routes live in one file; a repo-wide grep for
`app.get|post|delete|patch|put|route|.register` outside `server/src/api/app.ts`
returns nothing.

| | Count |
|---|---|
| Handlers registered | 47 (44 API + `GET /` + `GET /assets/*` + SPA fallback) |
| Bearer-token reachable | 20 |
| **Owner-browser-session only** | **18** |
| Unauthenticated | 6 (3 health probes, `openapi.json`, OAuth callback, origin-gated bootstrap) |
| CLI | **0 — does not exist** |

`cmd/hourfold/` is an empty directory left over from the pre-rename era and is
deleted by this work. `server/src/commands/` holds process entrypoints
(`api`, `scheduler`, `worker`, `migrate`, `seed-fake`), not a user CLI.

The 18 session-only routes are the ceiling on what any CLI or agent can reach
without a deliberate posture change. Fifteen of them are also web-bound: the ten
planning operations (`app.ts:526-586`), `sync.run` (806),
`connection.google.authorize` (438), `metrics.read` (311), and the three
api-token routes (373, 380, 402).

---

## 3. Parity, defined mechanically

Parity is a set relation over operation ids, asserted in CI as a single integer
that must equal zero, plus one ratchet that must never increase.

Sets: `R` = shipped ops; `W` = web-bound; `C` = cli-bound; `M` = mcp-bound;
`T` = token-credentialed; `X` = declared CLI exemptions (each carrying a reason,
an owner and an `expires_on`).

```
PARITY_DEBT = |W \ C|
            + |M \ C|
            + |T \ (C ∪ X)|
            + |R \ (C ∪ X)|
            + |{x ∈ X : x.expires_on < today}|
            + |Δroutes| + |Δpresets| + |Δmcp| + |Δcli| + |Δweb|
```

`PARITY_DEBT` must be exactly **0**. Ten terms, each independently attributable,
printed as a named table so a failure says which operation and which surface.

- The first term is the requirement made mechanical: **every operation the web UI
  can perform, the CLI can perform.**
- The second makes the CLI a superset of MCP, catching today's inversion.
- The third catches the six read documents MCP exposes only as resources.
- The fourth means adding a route without a CLI command, or without an explicit
  expiring exemption, fails the build in the same commit.
- `Δpresets` catches the silent killer: flipping `protectedRead` to
  `protectedMutation` removes an operation from every machine client's reach.
  Today that is a green build and a mysterious 401 weeks later.

### The ratchet

```
SESSION_ONLY_WEB_OPS = |{op ∈ R : op.auth.credentials == ["session"] ∧ op.surfaces.web ≠ null}|
```

Today **15**. After the Phase 3 promotion, **3** — the api-token lifecycle, which
stays browser-only forever with a permanent exemption citing `UX-SPEC.md:546`.
CI forbids the count increasing. This turns "we should fix the bearer gap
someday" into a visible countdown rather than a wish.

### Fiction becomes backlog

`docs/API.md`'s ~30 non-existent routes become `status: "planned"` registry rows,
rendered into a visibly separate *Not implemented* table and excluded from every
denominator. Passing the gate means complete against what **ships**.

---

## 4. Agent-output contract

### The flag

`--agent`, global and position-independent. **Never auto-detected.** A non-TTY
stdout disables colour, spinners and progress — presentation only — and never
changes the payload shape, because TTY-sniffing means `planipus status | less` and
`planipus status > file` yield different documents.

`--json` is explicitly **not** an alias. It means "show me the raw API document,
still pretty-printed and colourised" — a human debugging convenience with no
stability promise. Keeping them distinct prevents the classic failure where
someone scripts against `--json` and is broken by a readability improvement.

Environment: `PLANIPUS_AGENT=1`. Precedence is flag > env > profile > default.
Profiles are `human|ci|agent`.

### Format: minified JSON, one document, one trailing newline

**YAML is rejected**, and this codebase makes the hazard concrete rather than
theoretical:

- `selection.source_exclusion_marker` defaults to `#nosync` (`web/src/api.ts:440`).
  Unquoted in YAML that is a comment and the field silently becomes null.
- `LocalTimeString` is `HH:MM` (`packages/calendar-sync/src/types.ts:14-15`) —
  exactly the sexagesimal shape YAML 1.1 mangles.
- Enums include bare `free`, `busy`, `skip`; timezone strings and user labels walk
  into the Norway problem (`no`/`on`/`off`/`y` coercing to booleans).
- A truncated YAML stream yields a valid-but-wrong document; a truncated JSON
  object throws.

For a tool that mutates real calendars and sends declines to real colleagues,
fail-loud beats fail-quiet.

Token cost was measured rather than assumed. A representative `overview.get`
payload encodes to **1,371 chars** minified JSON, 1,828 pretty JSON, **1,508
block YAML**. The folk claim that YAML is cheaper is false for Planipus payloads:
they are overwhelmingly arrays of uniform records, so block YAML pays indentation
on every line and still quotes every timestamp — it came out ~10% *larger*.
Format choice buys roughly nothing; the terseness rules buy 30–50%.

Agents must also **produce** input: `bridge preview --draft -` takes a policy
draft on stdin, and same-format-in-and-out lets an agent round-trip
`bridge show --agent --policy` straight back into `bridge preview --draft -`.

NDJSON is used only for `watch`, where each line is an independent complete
envelope with `seq` and `emitted_at`, so a consumer that reads half the stream
still has N valid documents.

**stdout carries the envelope and nothing else, ever.** Logs, warnings, progress
and all human rendering go to stderr — the discipline `mcp/src/stdio.ts:31-35`
already enforces.

### Envelope

Keys in exactly this order, minified:
`schema, op, ok, outcome, data|error, warnings, next, meta`

```json
{"schema":"planipus.cli/v1","op":"bridge.preview","ok":true,"outcome":"previewed","data":{"preview_token":"9d0c7f11-2a4e-4c88-b0a3-5f2e91c7d640","expires_at":"2026-07-30T02:12:31Z","confirm":"a41c8e2b7605","creates":41,"updates":0,"deletes":0,"unchanged":107,"attendee_invites":0,"excluded_by_reason":{"outside_horizon":12,"all_day":6,"nosync":1},"disclosed_fields":["start","end","transparency"]},"warnings":[{"code":"destination_has_existing_copies","count":3}],"next":["bridge.activate"],"meta":{"request_id":"req_01JZ8Q4M7V","elapsed_ms":142,"registry_version":"1.0.0"}}
```

| Field | Contract |
|---|---|
| `schema` | Always first, a literal string, so a consumer identifies the document from its first 30 bytes |
| `op` | Registry operation id. The join key across CLI, MCP tool, HTTP route, OpenAPI `operationId` and docs. An agent that logs `op` can replay the action on any surface |
| `ok` | A real boolean. The single branch an agent must take |
| `outcome` | Closed enum: `read \| previewed \| applied \| accepted \| unchanged \| gated \| handoff_required \| failed`. Exists so a 202 can never be mistaken for a completed change |
| `data` | The API document verbatim in snake_case, minus elided empties. `{}` for 204, never `null` |
| `warnings` | `{code, …}` from the shared reason-code registry. Never affects `ok` or the exit code |
| `next` | Registry-sourced follow-ups. The affordance that stops an agent inventing a polling strategy |
| `meta` | `request_id`, `elapsed_ms`, `registry_version`. Suppressible with `--no-meta` |

Capability gating is deliberately `ok:true` with `outcome:"gated"`, **not** an
error, so an agent does not retry-loop against a condition only a human changing
configuration can resolve.

### Errors

```json
{"schema":"planipus.cli/v1","op":"bridge.activate","ok":false,"outcome":"failed","error":{"code":"preview_stale","status":409,"request_id":"req_01JC8Q2E7","retry_after_seconds":null,"class":"conflict","retryable":false,"remedy":["bridge.preview"]}}
```

The first four fields are byte-identical to the MCP adapter's
`SafeApiErrorDocument` (`api-client.ts:20-25`), so the two machine surfaces share
one vocabulary and the same 41-entry `SAFE_REMOTE_ERROR_CODES` allowlist.
Unrecognised server codes collapse to `http_<status>`; no server message string,
provider body or stack ever reaches stdout. `error.message` does not exist —
human text is composed locally in human mode only.

Three universal added fields, all registry-derived: `class` (1:1 with the exit
code), `retryable`, and `remedy[]` (operations that resolve *this* failure,
distinct from `next[]`).

### Exit codes

| Code | Class | Meaning |
|---|---|---|
| 0 | — | `read`, `previewed`, `applied`, `accepted` or `unchanged` |
| 1 | — | `cli_internal_error`. Its appearance is a ticket |
| 2 | `usage` | Decided locally; nothing was sent. Fix the invocation, never retry |
| 3 | `auth` | Re-credential; do not retry |
| 4 | `forbidden` | Insufficient scope, or apply without `PLANIPUS_CLI_ENABLE_APPLY` |
| 5 | `not_found` | |
| 6 | `invalid` | Rejected by the **server**. Distinct from 2 because that gap is a registry bug |
| 7 | `conflict` | `preview_stale`, `confirm_mismatch`, … Re-read state and re-decide |
| 8 | `rate_limited` | `retry_after_seconds` carries the delay; the CLI never sleeps for the agent |
| 9 | `unavailable` | Back off and re-check capabilities |
| 10 | `timeout` | GET timeout, outcome **known safe**. Repeat the read verbatim |
| **11** | `timeout_unknown` | **POST/DELETE timeout. The mutation MAY HAVE COMMITTED** |
| 12 | `refused` | Local gate; nothing sent |
| 13 | `gated` | Installation capability gate. Stop, do not loop |
| 14 | `handoff` | Google OAuth consent needed. Non-zero so `&&` chains stop |

> **Code 11 is the single most important exit code in this design and must never
> be merged into 10.** It exists precisely so that `until planipus …; do :; done`
> cannot double-activate a bridge or send a second round of cancellations.
> Codes 15–63 are reserved and never reused; 64+ is never used, avoiding
> `sysexits` and shell `128+N` signal collisions.

### Terseness rules

- Exactly one JSON document on stdout. No banner, no version header, no trailing
  summary, no `Done.`, no blank lines.
- stderr is empty on success **and** on failure. Diagnostics only under
  `PLANIPUS_DEBUG`.
- No ANSI whatsoever. `FORCE_COLOR` and `CLICOLOR_FORCE` are ignored.
- Stable key order, asserted by golden files. Byte-identical inputs produce
  byte-identical output.
- Elide nulls, empty arrays, empty objects, empty strings. Absent means
  empty-or-not-applicable.
- **No prose in the payload.** `data` carries codes; the human renderer owns
  English. Raw codes are the primary representation: `excluded_by_reason` keys
  stay `outside_horizon`/`all_day`/`nosync`; presets stay `busy_only`.
- All instants RFC 3339 UTC with trailing `Z` at second precision. Never local
  time, never an offset, never epoch millis, never a humanised relative time.
- Durations are integer seconds with a `_seconds` suffix; sizes integer bytes
  with `_bytes`. No unit strings to parse.
- Ids, not display names. Where the API supplies only a label, emit both.
- Real booleans and real numbers. Never `"true"`, never `"148"`. Counts always
  present as integers even when zero, because a zero count is information.
- No locale formatting.

### Discovery

An agent discovers the surface by asking the binary, never by reading docs and
never by parsing `--help` prose. The opening move is two calls:

- `planipus --agent doctor` — reachability, edition, credential kind, effective
  scopes, apply opt-in state, clock skew, CLI and server schema majors, token
  expiry, and which command groups this installation can run.
- `planipus --agent explain` — the machine-readable command surface, **filtered
  to this installation's live capabilities and this credential's actual scopes**.

That filter is the single most valuable affordance for an autonomous agent and is
exactly what the MCP adapter lacks today: it advertises nine apply tools to a
read-only token and only fails at call time with a 403.

Unavailable operations are annotated rather than hidden, so an agent learns *why*
before acting:

```json
{"op":"bridge.activate","available":false,"unavailable_reason":"insufficient_scope","needs_scope":"apply","have_scopes":["read","propose"]}
```

Progressive disclosure: `explain` (full, ~14 KB), `explain bridge` (one noun),
`explain "bridge activate"` (~400 bytes, the form every usage error points at),
`explain --format schema`, and `explain --format mcp-tools` — which emits the
exact MCP `tools/list` payload from the same registry, so an agent can *prove*
the two surfaces are one catalogue rather than trusting a claim.

This is trustworthy rather than aspirational because `explain` renders from the
same in-process command-tree structure the dispatcher executes, and CI asserts
that structure equals the registry. There is no second description that can rot.

### Stability

The agent payload is a published API with two independent version lines,
versioned separately from the CLI release. `schema` carries an integer major
inside the literal `planipus.cli/v1`; `meta.registry_version` is semver over the
operation catalogue.

**The must-ignore rule is part of the contract**, stated in
`planipus --agent explain`: consumers MUST ignore unknown keys, unknown warning
codes and unknown enum members, and MUST NOT treat an unknown `error.code` as
fatal beyond its `class`.

Four mechanical locks in one CI job (`npm run cli:contract`): a byte-compared
golden envelope corpus; an additive-only JSON-Schema diff classified by schema
subsumption (mechanical, not editorial — no arguing in review); a consumer pin
(`PLANIPUS_CLI_SCHEMA=1` exits 2 rather than emitting a different major); and a
frozen exit map where an existing `code → exit` edge may never change.

Explicitly **outside** the contract: all human-mode rendering, all stderr text,
help wording, table column widths, `--labels` prose, and the ordering of `next`
beyond its first element.

---

## 5. Authentication

The governing constraint is respected rather than circumvented: `requireSession`
(`app.ts:176-184`) hard-rejects any `Authorization` header, and
`mutationOriginAndCsrf` returns immediately when one is set (`app.ts:283`). There
is no way to reach a `protectedMutation` route with a bearer token.

**A `login --local` that presents the bootstrap token to obtain a browser session
is rejected.** That is the CLI impersonating a browser: it silently falsifies
`requireSession`'s guarantee without a line of security review, puts the bootstrap
secret on every host that wants a CLI, and once it works nobody funds the real
fix. If it shipped it would stop being a stopgap and become the architecture.

| Case | Mechanism |
|---|---|
| **Owner on the server host** | A **Unix-domain operator socket**, mode 0600, owned by the service user, whose route table is derived from registry entries carrying `transport:"uds"` — exactly one: `api-token.issue`. Authentication is filesystem permission; there is no Origin, no cookie, no CSRF, no network path. Ownership of the service user's socket is a strictly *stronger* proof of authority than a cookie |
| **Owner remote** | Loopback-callback login. The CLI starts a listener on `127.0.0.1:<ephemeral>`, generates an S256 challenge, and opens an *Authorize CLI* screen that calls the **existing browser-only** issue route. The browser remains the sole HTTP minter — `UX-SPEC.md:546` is preserved exactly. `--manual` for headless SSH |
| **CI** | `PLANIPUS_API_TOKEN` from a secret store, never a flag. `PLANIPUS_CLI_PROFILE=ci` forces agent mode on, apply off, beta ops off, pinned schema. Recommended credential is **read+propose** — enough to preview a bridge change in a PR check, structurally incapable of activating anything |
| **Autonomous agent** | Same transport, strictest gates, `PLANIPUS_CLI_PROFILE=agent` |

`--token` on the command line exists solely to exit 2 with
`token_in_argv_forbidden`, because argv is world-readable via `ps`.

---

## 6. Safety

Planipus mutates real calendars belonging to real people. These are not
ergonomics.

1. **Preview and activate are different commands, different routes, different
   scopes — and the fused command does not exist for agents.** `bridge activate`
   accepts only a `preview_token` and cannot construct a policy, so activating
   something never previewed is structurally impossible. The pleasant wizard
   `bridge create` is refused under `--agent` with exit 2 `interactive_only`. A
   registry test asserts no CLI command issues more than one mutating HTTP
   request.
2. **Confirmation for agents is a server-verified effect digest, not a local
   secret.** `preview` returns `data.confirm` = first 12 hex chars of SHA-256 over
   `planipus.confirm.v1\n<op_id>\n<preview_token>\n<creates>\n<updates>\n<deletes>\n<attendee_invites>\n`.
   `activate` sends it; the **server** recomputes from the persisted preview row
   and returns 409 `confirm_mismatch`. Optional for browser sessions, so the web
   UI needs zero changes. Honest framing: this is *proof-of-reading*, not
   authentication — anyone who can read the preview can compute it, which is
   exactly the population we intend to allow.
3. **Scope is the real fence; flags are convenience.**
4. **Effect ceilings, defaulted per profile.** Agent-profile defaults are
   `max_attendee_invites 0` and `max_deletes 0`, so an agent asked to "clean up my
   bridges" cannot delete forty copies because it misread which bridge it was on.
   It gets a refusal naming the number it would have caused.
5. **Attendee-visible operations require a flag with no environment-variable
   equivalent.** `--i-understand-attendees-will-be-notified` gates every operation
   that reaches another human's inbox. Because it cannot be set once in a
   container spec and forgotten, it must appear on the specific command line. The
   flag name is deliberately long and unguessable-by-vibes: a model must have read
   `explain` to produce it. **These are the operations no undo can reverse.**
6. **202 is never reported as completion.** `--wait` resolves to `applied` or to a
   distinct `timeout_unknown`; it never asserts completion it did not observe.
7. **`--dry-run` is distinct from `preview` and never touches the network.**
   `preview` is a real server call that for conflict rules contacts Google
   freeBusy. Conflating them would be a serious footgun.
8. **No batch destruction.** `suggestion accept` is per-id with no `--all`. An
   operator who wants a loop writes a visible loop.
9. **Secrets never enter an agent's context.** `token create --agent` refuses to
   print plaintext and requires `--out-file` (0600) or `--token-fd`. A live
   apply-scoped credential landing in an LLM transcript is a durable compromise.
10. **Reversibility is stated in the confirmation** and emitted as warning codes:
    `copies_remain_after_pause`, `declines_are_not_reversible`,
    `bridge_copies_remain_after_retire`.

---

## 7. Drift gate

`npm run surface` — one CI job, six extractors plus three test families, wired
into `scripts/node-gate.mjs` so it runs inside the existing `npm run verify`. It
follows the `provenance-gate.mjs` / `docs-gate.mjs` pattern.

Extractors: (1) `app.ts` routes + auth presets via the TypeScript compiler API;
(2) `web/src/api.ts` call sites including the fourteen template-literal forms;
(3) the CLI command tree, exported as a pure side-effect-free data structure;
(4) generated MCP tools; (5) docs fences; (6) exemption expiry.

Test families: boundary tests extending `mcp/tests/boundary.test.ts`; the golden
envelope corpus; and **schema-parity property tests, explicitly deferred and
explicitly gated.** The MCP Zod schemas, the CLI arg schemas and
`parsePolicyDraft` currently disagree in five documented ways — `.strict()`
rejecting unknown keys the server ignores, `.trim()` versus NFC normalisation,
UTF-16 versus code-point length counting, duplicated default constants that match
only by luck, and MCP-only bounds with no server counterpart. Reconciling three
validators necessarily changes accept/reject behaviour on the directed-sync path,
so **the 91-case corpus must pass unchanged before and after, with no case edits.
Any reconciliation requiring a case edit is not a reconciliation — it is a
behaviour change and needs its own decision record.**

Why this is structural rather than procedural: a developer adding a route cannot
merge without touching the registry; touching the registry surfaces three binding
columns; a null CLI column fails the parity assertion. The only escape is an
exemption row with a reason, an owner and an expiry — reviewable in the diff and
self-destructing when the date passes.

**Operational footgun to honour:** `scripts/docs-gate.mjs` already fails if any
`| XXX-000 |` row in `REQUIREMENTS.md` lacks a matching row in `TRACEABILITY.md`.
Every new CLI-/AGT- requirement must land in both files in the same commit.

---

## 8. Editions

**Owner decision, 2026-07-30: each edition owns a complete triad.** Planipus
Server has a Server API, Server CLI and Server MCP. Planipus for Mac gets its own
API, CLI and MCP — off by default, authentication required.

This revises the analysis that produced this document, which recommended
excluding the Mac from parity on the grounds that it exposes no HTTP listener, no
XPC service, no URL scheme, no `CFBundleURLTypes` handler and no AppleScript
dictionary — so there is nothing for a CLI to talk to. That observation remains
factually correct and is precisely the gap the Mac control-plane ADR closes.

**What does not change** is edition autonomy. The Mac's surfaces talk only to the
Mac; the Server's talk only to the Server. Neither pairs with, calls, falls back
to, or implies the continuity of the other. `UX-SPEC.md:23-28` and `:416` are
preserved: the editions share user concepts and reason codes through conformance
fixtures, *not* a shared API.

The registry therefore carries `editions: ["server"]` or `["mac"]` per operation,
with separate parity assertions per edition, and `doctor`/`explain` emit the
edition they are bound to. Until the Mac control plane ships, `planipus mac …`
returns `edition_unmanaged` at exit 12 — an explicit machine-readable refusal,
because an agent concluding the Mac is merely offline and telling a user their
bridges are fine is the worse failure.

Mechanism, threat model and enablement for the Mac triad are specified in
[ADR-006](adr/0006-mac-local-control-plane.md), which decides a container
Unix-domain socket carrying **this document's envelope** — the Mac needs the
registry, not HTTP. ADR-006 additionally resolves open decisions 1, 2 and 3 in §9
below, and extends §6 (Safety): route *creation* is refused on the Mac at every
scope, the confirm digest is recomputed at ratification rather than at the API
call, and effect ceilings are superseded by the disclosure lattice.

Consequences for this document, pending the ADR-006 implementation phases:

- the registry gains an `editions` field, and `PARITY_DEBT` is asserted
  independently for `["server"]` and `["mac"]`;
- §5's authentication table gains a Mac row: credentials are never displayed,
  copied, or written to a file — clients obtain them through a peer-verified
  enrolment handshake the owner approves in the app;
- §4's envelope is unchanged and is shared verbatim across both editions.

---

## 9. Delivery

| Phase | Goal | Ships standalone |
|---|---|---|
| **0** | Surface registry + drift gate. No CLI, no server change | Yes — freezes three surfaces before adding a fourth |
| **1** | Shared `packages/api-client`, read-only CLI, agent envelope v1. No server change | Yes — a useful 2am tool on already-bearer-reachable routes |
| **2** | Propose and apply on the already-reachable surface (bridges, private replies) + the `confirm` digest | Yes |
| **3** | **API promotion PR — owner decision required.** Twelve routes move to `requireActor`; actor provenance threaded into audit facts | `SESSION_ONLY_WEB_OPS` 15 → 3; `\|W \ C\|` = 0 for the first time |
| **4** | Credential lifecycle: operator socket, loopback login, token commands | Ends the bootstrap deadlock without weakening the browser-only rule |
| **5** | Generate MCP + OpenAPI; schema parity reconciliation; `PARITY_DEBT` = 0 | Gated on the 91-case corpus passing unchanged |

Requirements `CLI-001`–`CLI-005`, `AGT-001`–`AGT-008`, `SEC-101`–`SEC-105`,
`OPS-101`–`OPS-105` carry the machine-checkable acceptance tests and must be
added to `REQUIREMENTS.md` and `TRACEABILITY.md` together.

### Decisions the owner still owns

1. **Phase 3 posture** — promote all twelve session-only routes, or narrow to the
   eight non-attendee-visible ones and keep `meet activate`/`meet remove`/
   `suggestion accept` browser-only forever? The narrow option keeps every
   operation that emails a human behind a browser, at the cost that `|W \ C|`
   never reaches 0.
2. **Operator socket, or accept the bootstrap deadlock?** Recommended: ship it
   with exactly one route.
3. **Default documented credential scope** for agent and CI recipes. Recommended:
   read+propose, which makes "an agent cannot activate" server-enforced.
4. **Confirm-digest scope** — the four effect counts, or widen it to cover
   `excluded_by_reason` and the disclosure list so an agent must have read the
   privacy consequences too? Wider is safer and more tedious to produce by hand.
5. ~~**Registry location**~~ — **decided 2026-07-30: `registry/v1/` at the repo
   root.** `conformance/` keeps meaning exactly one thing: the cross-edition
   behaviour corpus both evaluators execute against a canonical SHA-256 vector.
   The surface registry is a build-time contract nothing executes as fixtures,
   and it spans two editions where the conformance corpus spans one behaviour
   contract. `PARITY.lock` sits beside it.
6. **Phase ordering** — 4 before 3? Phase 4 makes the CLI installable without a
   browser but does not increase coverage; Phase 3 unlocks two entire product
   screens but leaves credential setup a browser act.
