#!/usr/bin/env bash
# Local reproduction of the manual.yml daily pipeline.
# Runs scripts in CI order; mutates ../../README.md in place (dirty working tree).
#
# Auth: update_recent_repos / update_top_projects need a GitHub token; resolved as
#   GH_PAT -> GITHUB_TOKEN -> gh auth token. generate_ai_summary skips without GEMINI_API_KEY.
set -euo pipefail

cd "$(dirname "$0")/../.."

echo "==> node --check all scripts"
for f in .github/scripts/*.js; do
  node --check "$f"
done

echo "==> Update employment duration"
node .github/scripts/update_duration.js

echo "==> Update blog posts"
node .github/scripts/update_blog_posts.js

echo "==> Update recent repositories"
env GH_PAT="${GH_PAT:-${GITHUB_TOKEN:-$(gh auth token 2>/dev/null || true)}}" \
  node .github/scripts/update_recent_repos.js

echo "==> Update top projects"
env GH_PAT="${GH_PAT:-${GITHUB_TOKEN:-$(gh auth token 2>/dev/null || true)}}" \
  node .github/scripts/update_top_projects.js

echo "==> Generate AI summary (skips without GEMINI_API_KEY)"
node .github/scripts/generate_ai_summary.js

echo "All scripts finished."