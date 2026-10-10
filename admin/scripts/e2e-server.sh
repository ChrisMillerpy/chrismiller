#!/usr/bin/env bash
# Builds the admin and serves the production build for end-to-end tests: a fresh local D1 of its
# own (the dev database is left alone) and the fake Access server in front. The reset is here, not
# in a Playwright global setup, because Playwright starts this server before global setup runs.
set -euo pipefail
cd "$(dirname "$0")/.."
STATE=.wrangler/e2e
npm run build >/dev/null
rm -f dist/server/.dev.vars # the build copies the developer's .dev.vars; the tests set their own vars
rm -rf "$STATE"
npx wrangler d1 migrations apply withchris-admin --local --persist-to "$STATE" >/dev/null
exec npx wrangler dev --persist-to "$STATE" --ip 127.0.0.1 --port "${E2E_PORT:-4329}" \
  --var "ACCESS_TEAM_DOMAIN:http://127.0.0.1:${FAKE_ACCESS_PORT:-4401}" --var "ACCESS_AUD:${FAKE_ACCESS_AUD:-e2e-aud}" \
  --var ALLOWED_EMAILS:chris@example.com
