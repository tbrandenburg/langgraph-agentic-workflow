#!/usr/bin/env bash
# Deterministic gate: lint (syntax check), tests, and a simple secret scan against the sample
# repo copy in the workspace. Exits non-zero on any real failure; exits 0 on success. Subsequent
# agent steps (review) are skipped by the workflow's `onFailure: "publish"` routing if this fails.
set -euo pipefail

repo="$PWD/repo"

if [ ! -d "$repo" ]; then
  echo "no sample repo found at $repo (prepare-workspace.sh must run first)" >&2
  exit 1
fi

echo "== lint (node -c syntax check) =="
node --check "$repo/src/index.js"

echo "== tests =="
node "$repo/tests/health.test.js"

echo "== secret scan (grep-based, PoC-only) =="
secret_pattern='(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|api[_-]?key\s*=\s*["'"'"'][A-Za-z0-9/+=_-]{16,})'
if grep -R -E -n -i --include='*.js' --include='*.json' "$secret_pattern" "$repo"; then
  echo "secret scan: potential secret found" >&2
  exit 1
fi
echo "secret scan: clean"

echo "validate: PASS"
