# Naming brief and collision log

Status: **committed product name — Planipus**  
Selected: 2026-07-20  
Pronunciation: `PLAN-ih-pus`  
Lowercase technical name: `planipus`

## Why this name

The requested direction was calm personal software with a playful self-hosted
spin. **Planipus** is intentionally friendly rather than corporate: “plan” plus
a platypus-shaped sound, with enough distinctiveness for search, a CLI, a
container, and a small mascot. It does not promise perfect optimization or put
“AI” in the identity.

Primary line: **A calm bridge between the calendars you live in.**  
Self-hosted line: **Your calendars. Your rules. Your server.**

The visual idea is a small platypus named **Pip** arranging smooth calendar
tiles or carrying one in its bill. The product itself should remain quiet and
grown-up: warm neutrals, pond green/blue, soft motion, restrained moments of
mascot personality. Avoid childish copy, productivity hustle language, robot
sparkles, neon gradients, or a constant cartoon presence.

Examples:

```text
planipus doctor
planipus backup
planipus policy preview
ghcr.io/<owner>/planipus
helm install planipus ...
```

## Preliminary collision screen

Broad exact-name searches on 2026-07-20 found no current software, calendar,
scheduler, package, repository, or obvious exact trademark result for
“Planipus.” Results were biological or historical uses of the word, including
the crab species name *Matuta planipus*.

This is a useful distinctiveness signal, not legal trademark clearance, package
reservation, social-handle ownership, or proof that a preferred domain can be
registered. Nothing external has been registered or claimed.

Repeat immediately before public launch:

- exact and phonetic search for Planipus/Planipuss/Plannipus in calendar,
  scheduling, productivity, booking, and software categories;
- GitHub repositories/organizations, npm, PyPI, crates.io, Homebrew, OCI
  registries, and major app stores;
- relevant Canadian, US, EU, UK, and WIPO trademark databases/classes with
  professional review if the project becomes commercial;
- likely project domains and community handles; and
- mascot/wordmark clearance independent of the word mark.

## Required qualities retained

- easy to say after hearing it once and recoverable from a spelling hint;
- distinctive in search and comfortable as a lowercase binary/prefix;
- humane for personal use while still credible in self-host documentation;
- not derivative of Reclaim, Clockwise, Motion, or Cal.com;
- model-optional and not “AI”-branded;
- no claim of perfection, zero conflict, or autonomous control;
- one word and not another manufactured `Time/Day/Week + Fold/Forge/Loom`
  enterprise compound.

## Rejected and screened names

| Name | Result |
|---|---|
| Hourfold | User rejected as terrible; constructed/timesheet-like |
| Dayloom | Multiple current calendar/planner/habit/journal products |
| Daymesh | Current calendar-feed aggregation product |
| Weeksmith | Current privacy-first schedule app and other planner use |
| Morrow | Current calendar-connected professional AI product |
| Daywright | Existing open-source project-management app and company |
| Ordo | Many current calendar/planner/productivity products |
| Helio | Current AI work/calendar products and extensive software use |
| Aster | Current privacy/productivity and clinical scheduling products |
| Tuck | Numerous active applications and difficult searchability |
| Mallow | Existing finance/habit application and broad brand use |
| Puddle | Pleasant tone but generic and crowded across software/products |

These are dated web screens, not legal opinions.

## Rebrand checklist

- local repository and project pointer directories;
- source repository/org/package registration only after user authorizes external setup;
- npm workspace/package names and source constants;
- UI titles, wordmark, favicon, PWA manifest, localization, and email sender;
- `PLANIPUS_` environment prefix only for new project settings; keep standard
  names such as `DATABASE_URL`, `REDIS_URL`, and `OTEL_*` where interoperability
  matters;
- config/data paths, cookie/CSRF names, metrics namespace, and log service name;
- image, chart, Kubernetes objects/labels/service account/PVC, and examples;
- API product header/OpenAPI title, CLI completion/man page, OAuth display and
  callback documentation, webhook user agent;
- backup/export namespace and format version;
- third-party notices and compatible-component attribution;
- Planipus-owned setting aliases only, removed through a documented migration
  after a Planipus release.

The rejected Hourfold name never shipped, so it needs no runtime compatibility
alias. Planipus settings require a migration/deprecation plan only after a
Planipus release establishes them.
