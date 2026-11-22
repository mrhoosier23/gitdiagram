#!/usr/bin/env bash
# Offline-only private GitDiagram build / lint / test / Wrangler dry-runs.
# No deploy, remote provision, production secret, or Cloudflare API operation.
# Usage:
#   bash scripts/private/offline-verify.sh
#   PRIVATE_SITE_ORIGIN=https://your-private-host.example.org bash scripts/private/offline-verify.sh
set -euo pipefail

cd "$(dirname "$0")/../.."

if [[ -n "${CF_ENV_FILE:-}" || -n "${CLOUDFLARE_API_TOKEN:-}" ||
      -n "${CLOUDFLARE_ACCOUNT_ID:-}" ||
      -n "${OPENAI_API_KEY:-}" || -n "${R2_ACCESS_KEY_ID:-}" ||
      -n "${R2_SECRET_ACCESS_KEY:-}" || -n "${UPSTASH_REDIS_REST_TOKEN:-}" ]]; then
  echo "Refusing to run with a live Cloudflare, API, or storage credential environment." >&2
  exit 2
fi

for file in .env .env.local .env.production .env.production.local .dev.vars .dev.vars.production; do
  if [[ -f "$file" ]]; then
    echo "Refusing to build while $file is present; do not use live or personal secrets in offline checks." >&2
    exit 2
  fi
done

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun 1.3.14 is required (see packageManager in package.json)." >&2
  exit 2
fi

origin="${PRIVATE_SITE_ORIGIN:-https://gitdiagram-private-qa.invalid}"
if [[ "$origin" == https://*.invalid ]]; then
  node scripts/private/render-configs.mjs --origin "$origin" --fixture
else
  node scripts/private/render-configs.mjs --origin "$origin"
fi
node scripts/check-private-config.mjs

echo "Running local checks without any Cloudflare credentials ..."
bun ci
bun run lint
bun run typecheck
bun run format:check
bun run knip
bun run test

# The upstream build script loads the production secret file unless CI=1 and
# CF_ENV_FILE is absent. Guard both conditions explicitly. Nothing is uploaded.
export CI=1
export PRIVATE_INSTANCE_ENABLED=1
export NEXT_PUBLIC_PRIVATE_INSTANCE=1
export AI_PROVIDER=openai
export NEXT_PUBLIC_SITE_ORIGIN="$origin"
export NEXT_PUBLIC_POSTHOG_KEY=""
export NEXT_PUBLIC_PRESENCE_URL=""
export NEXT_PUBLIC_VIDEO_EXPLAINER=0
export NEXT_PUBLIC_GITHUB_CONNECT=0
export INDEXNOW_ENABLED=0
export OPEN_NEXT_DEPLOY=true

bash scripts/cf-build.sh

# No deployment flags are accepted. --dry-run emits build artifacts locally.
for config in \
  wrangler.private.stub.jsonc \
  .wrangler-private-server-generated.jsonc \
  .wrangler-private-server-local-generated.jsonc \
  .wrangler-private-generated.jsonc; do
  bunx wrangler deploy --dry-run --config "$config"
done

echo
echo "LOCAL BUILD + WRANGLER DRY-RUN ONLY."
echo "This does not prove Cloudflare Access, isolated storage, live host routing,"
echo "internal service bindings, or diagram persistence; no deployment occurred."
