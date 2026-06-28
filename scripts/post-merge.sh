#!/bin/bash
set -euo pipefail

pnpm install --frozen-lockfile
pnpm --filter db push

# Ensure git always uses the tracked hooks directory so post-commit fires.
git config core.hooksPath scripts/git-hooks

# Push to GitHub after every merge using the same credential-helper approach
# as the post-commit hook to avoid embedding the PAT in the remote URL.
if [ -z "${GITHUB_PERSONAL_ACCESS_TOKEN:-}" ]; then
  echo "[github-sync] ERROR: GITHUB_PERSONAL_ACCESS_TOKEN is not set." >&2
  exit 1
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
REPO_URL="https://github.com/Austinissacc/London-Timebot.git"
HELPER="$(pwd)/scripts/git-hooks/github-credential-helper"

echo "[github-sync] Pushing branch '${BRANCH}' to GitHub..."

PUSH_OUTPUT=$(
  git -c "credential.helper=${HELPER}" \
    push "${REPO_URL}" "HEAD:refs/heads/${BRANCH}" 2>&1
) || {
  printf "%s\n" "${PUSH_OUTPUT}" >&2
  echo "[github-sync] ERROR: Push to GitHub failed." >&2
  exit 1
}

printf "%s\n" "${PUSH_OUTPUT}"
echo "[github-sync] Push succeeded."
