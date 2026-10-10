#!/usr/bin/env bash
# Builds the admin and serves the production build locally for end-to-end tests,
# pointed at the fake Access server and the local test database.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build >/dev/null
cat > dist/server/.dev.vars <<VARS
ACCESS_TEAM_DOMAIN=http://127.0.0.1:${FAKE_ACCESS_PORT:-4401}
ACCESS_AUD=${FAKE_ACCESS_AUD:-e2e-aud}
VARS
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="${E2E_WORKER_DATABASE_URL:-postgresql://admin_worker:test-worker-password@127.0.0.1:54339/admin_test}"
exec npx astro preview --ignore-lock --port "${E2E_PORT:-4329}" --host 127.0.0.1
