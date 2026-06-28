#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

# Push to GitHub after every merge
if [ -n "$GITHUB_PERSONAL_ACCESS_TOKEN" ]; then
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  echo "[github-sync] Pushing branch '${BRANCH}' to GitHub..."
  git push "https://${GITHUB_PERSONAL_ACCESS_TOKEN}@github.com/Austinissacc/London-Timebot.git" \
    "HEAD:refs/heads/${BRANCH}" 2>&1 | sed "s/${GITHUB_PERSONAL_ACCESS_TOKEN}/****/g" || \
    echo "[github-sync] Push failed — continuing anyway."
else
  echo "[github-sync] GITHUB_PERSONAL_ACCESS_TOKEN not set — skipping push."
fi
