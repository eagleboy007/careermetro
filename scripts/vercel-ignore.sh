#!/bin/bash
# Vercel's "Ignored Build Step" (vercel.json ignoreCommand): exit 0 skips the build, anything else builds.
# Skips builds whose changes since the branch's last deployment touch only docs, Markdown, eval fixtures or
# workflows, to stay inside Vercel's daily deployment cap. Builds when unsure.
set -u
if [ "${VERCEL_GIT_COMMIT_REF:-}" = "staging" ] && [ "${VERCEL_GIT_PREVIOUS_SHA:-}" = "${VERCEL_GIT_COMMIT_SHA:-}" ]; then
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
