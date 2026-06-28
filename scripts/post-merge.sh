#!/bin/bash
set -e

pnpm install --frozen-lockfile
pnpm --filter db push

# Ensure git always uses the tracked hooks directory
git config core.hooksPath scripts/git-hooks

# Push to GitHub after every merge
if [ -z "$GITHUB_PERSONAL_ACCESS_TOKEN" ]; then
  echo "[github-sync] ERROR: GITHUB_PERSONAL_ACCESS_TOKEN is not set." >&2
  exit 1
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "[github-sync] Pushing branch '${BRANCH}' to GitHub..."
git push "https://${GITHUB_PERSONAL_ACCESS_TOKEN}@github.com/Austinissacc/London-Timebot.git" \
  "HEAD:refs/heads/${BRANCH}" 2>&1 | sed "s/${GITHUB_PERSONAL_ACCESS_TOKEN}/****/g"
echo "[github-sync] Push succeeded."
