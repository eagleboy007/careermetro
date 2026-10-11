#!/bin/bash
# Vercel's "Ignored Build Step" (vercel.json ignoreCommand): exit 0 skips the build, anything else builds.
# To stay inside Vercel's daily deployment cap, only production (main) and staging build: work is checked locally
# before it is pushed, and staging shows it online after the merge (docs/staging.md). Of those, builds whose changes
# since the branch's last deployment touch only docs, Markdown, eval fixtures or workflows are skipped too.
set -u
if [ "${VERCEL_ENV:-}" = "preview" ] && [ "${VERCEL_GIT_COMMIT_REF:-}" != "staging" ]; then
  # A pull request or other branch: no preview build.
  exit 0
elif [ "${VERCEL_GIT_COMMIT_REF:-}" = "staging" ] && [ "${VERCEL_GIT_PREVIOUS_SHA:-}" = "${VERCEL_GIT_COMMIT_SHA:-}" ]; then
  # Staging asked to build a commit it already has (or its first build, with no previous one): build.
  exit 1
elif [ -n "${VERCEL_GIT_PREVIOUS_SHA:-}" ]; then
  base="$VERCEL_GIT_PREVIOUS_SHA"
elif [ "${VERCEL_GIT_COMMIT_REF:-}" = "staging" ]; then
  # The staging branch's first build (docs/staging.md): there is nothing to compare with, so build.
  exit 1
else
  base="HEAD^"
fi
git diff --quiet "$base" HEAD -- . ':(exclude)docs' ':(exclude,glob)*.md' ':(exclude)fixtures/evals' ':(exclude).github'
