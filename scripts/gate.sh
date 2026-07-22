#!/usr/bin/env bash
set -euo pipefail

npm run provenance
npm run docs
npm run typecheck
npm run test
npm run build

pushd macos >/dev/null
swift build -c release
swift test
popd >/dev/null

helm lint deploy/helm/planipus
helm template planipus deploy/helm/planipus >/dev/null
if helm template planipus deploy/helm/planipus \
  --set existingSecret=shared-database-secret \
  --set postgresql.existingAdminSecret=shared-database-secret >/dev/null 2>&1; then
  echo "Helm safety gate failed: solo profile accepted one Secret for application and PostgreSQL administrator" >&2
  exit 1
fi
helm lint deploy/helm/planipus -f deploy/helm/planipus/values-standard.yaml
helm template planipus deploy/helm/planipus -f deploy/helm/planipus/values-standard.yaml >/dev/null
