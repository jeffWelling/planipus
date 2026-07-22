# Planipus Helm chart

This chart runs the autonomous Planipus Server as one StatefulSet replica. The
API, scheduler, and worker use the same immutable application image with
different Cloud Native Buildpacks process types. PostgreSQL is the only durable
service and runs as a sidecar in the solo profile.

The default image registries are intentionally invalid. Set reviewed, pinned
repositories and preferably digests for both the Planipus and PostgreSQL images.
Route all images through a registry trusted by the operator.
The chart also defaults to the deterministic `fake` calendar provider so an
incomplete installation cannot contact Google. Set `config.providerMode=google`
only after the OAuth credentials and public URL are ready.

Create the application Secret named by `existingSecret` before installation. It
must contain:

- `DATABASE_URL` targeting `127.0.0.1:5432` in solo mode or the external
  PostgreSQL service in standard mode;
- `POSTGRES_PASSWORD` for the non-superuser application role in solo mode;
- `PLANIPUS_BOOTSTRAP_TOKEN` with at least 32 characters;
- `PLANIPUS_MASTER_KEY` containing exactly 32 random bytes encoded as base64;
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` when `config.providerMode` is
  `google`.

The shape of a solo Secret is shown below. The values are deliberately unusable;
create the real Secret through your secret manager or encrypted GitOps flow.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: planipus-secrets
type: Opaque
stringData:
  DATABASE_URL: postgresql://planipus:CHANGE_ME@127.0.0.1:5432/planipus
  POSTGRES_PASSWORD: CHANGE_ME
  PLANIPUS_BOOTSTRAP_TOKEN: CHANGE_ME_TO_AT_LEAST_32_RANDOM_CHARACTERS
  PLANIPUS_MASTER_KEY: CHANGE_ME_TO_32_RANDOM_BYTES_ENCODED_AS_BASE64
  # Required only with config.providerMode=google:
  # GOOGLE_CLIENT_ID: CHANGE_ME
  # GOOGLE_CLIENT_SECRET: CHANGE_ME
```

Solo mode also requires a separate Secret named by
`postgresql.existingAdminSecret`; only the PostgreSQL container receives it:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: planipus-postgres-admin
type: Opaque
stringData:
  POSTGRES_PASSWORD: CHANGE_ME_ADMIN
```

The solo `DATABASE_URL` and `POSTGRES_PASSWORD` must describe the same
non-superuser application password; percent-encode reserved characters in the
URL. The separate admin Secret is used only by PostgreSQL for initial database
creation. PostgreSQL listens only on pod loopback, and the application role owns
its database/schema without receiving superuser or role-creation powers. The
chart rejects equal admin and application role names. The standard profile does
not need either PostgreSQL password Secret. The chart also rejects reusing the
application Secret as the admin Secret; use distinct Secret names **and distinct
random passwords** so an application compromise cannot authenticate as the
PostgreSQL administrator. Do not store real values in a values file.

The official PostgreSQL initialization scripts run only when `PGDATA` is empty.
Changing either Kubernetes Secret and restarting does **not** rotate an existing
database role password. For an existing PVC, first run a reviewed `ALTER ROLE`
rotation while both old and new credentials are available, verify the new
application login, then update/restart the workload. A future chart upgrade
must not assume the init script reruns.
Because the Secret is supplied outside this chart, changing it does not alter
the Pod template; explicitly restart the StatefulSet after an approved Secret
rotation. Do not replace the master key until a key-rewrap procedure has been
completed for existing encrypted credentials.

Each application process runs the idempotent, advisory-lock-protected database
migrations before it starts. This also lets the solo processes wait for the
PostgreSQL sidecar to become ready. The default retry window is controlled by
`config.migrationAttempts`.

Use the standard profile with an external PostgreSQL service:

```console
helm upgrade --install planipus . -f values-standard.yaml
```

With the standard profile, add a narrowly scoped entry to
`networkPolicy.additionalEgress` for the external database address and TCP port
5432. The default policy intentionally allows public HTTPS for Google APIs but
blocks private address ranges; an in-cluster or private PostgreSQL endpoint will
therefore be unreachable until that rule is supplied. No PostgreSQL container,
temporary database volume, or persistent volume claim is rendered when
`postgresql.enabled=false`.

For example, select only PostgreSQL pods in a dedicated namespace (replace both
labels with those used by your database operator):

```yaml
networkPolicy:
  additionalEgress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: databases
          podSelector:
            matchLabels:
              app.kubernetes.io/name: postgresql
      ports:
        - port: 5432
          protocol: TCP
```

The current Server uses incremental polling and safety reconciliation; it does
not require an inbound Google watch callback.

Before public release, render and server-side dry-run the chart, pin image
digests, verify restricted Pod Security admission, and perform backup/restore
reconciliation without duplicate provider writes.
