#!/usr/bin/env bash
# Pushes the web app's environment to the linked Vercel project (Production). Only an allowlist goes:
# the root .env also holds deploy and matcher keys the host must never see.
#
#   cd web && vercel link        # once, with Root Directory = web
#   scripts/vercel-env.sh --dry-run   # show which keys would be pushed
#   scripts/vercel-env.sh             # push them (replaces any existing value)
#
# Values come from the repo-root .env, then web/.env.local (later wins). A CRON_SECRET missing from both is
# generated and saved to web/.env.local; the same value goes in the GitHub secret of that name.
set -euo pipefail
cd "$(dirname "$0")/.."

KEYS="NEXT_PUBLIC_CHAIN_ID NEXT_PUBLIC_RPC_URL NEXT_PUBLIC_CHOG_ADDRESS NEXT_PUBLIC_DECLUB_ESCROW_ADDRESS
NEXT_PUBLIC_DECLUB_REWARDS_ADDRESS NEXT_PUBLIC_MOCK_ERC20_ADDRESS NEXT_PUBLIC_KNOWN_COLLECTIONS
NEXT_PUBLIC_IPFS_GATEWAY NEXT_PUBLIC_PRIVY_APP_ID NEXT_PUBLIC_REWARDS_EPOCH_SECONDS NEXT_PUBLIC_REWARDS_GENESIS
NEXT_PUBLIC_DECLUB_INTENTS_ADDRESS NEXT_PUBLIC_POOL_URL
PRIVY_APP_SECRET PRIVY_WEBHOOK_SIGNING_SECRET UPSTASH_REDIS_REST_URL UPSTASH_REDIS_REST_TOKEN
BLOB_READ_WRITE_TOKEN CRON_SECRET FILL_WATCHER_START_BLOCK CLUB_ADMIN_USER_IDS"

dry=false
[ "${1:-}" = "--dry-run" ] && dry=true

value() { # last assignment of $1 across the env files, quotes stripped
  grep -hE "^$1=" ../.env .env.local 2>/dev/null | tail -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/' || true
}

if [ -z "$(value CRON_SECRET)" ]; then
  echo "CRON_SECRET=$(openssl rand -hex 32)" >> .env.local
  echo "Generated CRON_SECRET into web/.env.local (also add it as a GitHub secret)."
fi

for k in $KEYS; do
  v=$(value "$k")
  if [ -z "$v" ]; then echo "skip   $k (blank)"; continue; fi
  if $dry; then echo "would  $k"; continue; fi
  printf '%s' "$v" | vercel env add "$k" production --force >/dev/null && echo "pushed $k"
done
