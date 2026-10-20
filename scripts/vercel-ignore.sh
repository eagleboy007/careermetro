#!/bin/bash
# Vercel's "Ignored Build Step" (vercel.json ignoreCommand): exit 0 skips the build, anything else builds.
# To stay inside Vercel's daily deployment cap, only production (main) and staging build: work is checked locally
# before it is pushed, and staging shows it online after the merge (docs/staging.md). Of those, builds whose changes
# since the branch's last deployment touch only docs, Markdown, eval fixtures, e2e or smoke scripts or workflows
# are skipped too. vercel.json's git.deploymentEnabled stops the usual working branches from creating a deployment at all.
set -u
if [ "${VERCEL_ENV:-}" = "preview" ] && [ "${VERCEL_GIT_COMMIT_REF:-}" != "staging" ]; then
  # A pull request or other branch: no preview build.
  exit 0
elif [ -z "${VERCEL_GIT_PREVIOUS_SHA:-}" ] || [ "${VERCEL_GIT_PREVIOUS_SHA:-}" = "${VERCEL_GIT_COMMIT_SHA:-}" ]; then
  # Production or staging with nothing to compare with: its first build (docs/staging.md), or a commit it already has,
  # such as a dashboard Redeploy after setting keys (T80). Build.
  exit 1
fi
base="$VERCEL_GIT_PREVIOUS_SHA"
git diff --quiet "$base" HEAD -- . ':(exclude)docs' ':(exclude,glob)*.md' ':(exclude)fixtures/evals' ':(exclude)e2e' ':(exclude)scripts/smoke' ':(exclude).github'
