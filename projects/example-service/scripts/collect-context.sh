#!/usr/bin/env bash
# Deterministic context gathering: lists and prints the sample repo files prepared by
# prepare-workspace.sh, so the coder step's prompt input has concrete context to work from.
set -euo pipefail

repo="$PWD/repo"

if [ ! -d "$repo" ]; then
  echo "no sample repo found at $repo (prepare-workspace.sh must run first)" >&2
  exit 1
fi

echo "== repo file listing =="
find "$repo" -type f | sort

echo
echo "== src/index.js =="
cat "$repo/src/index.js"

echo
echo "== tests/health.test.js =="
cat "$repo/tests/health.test.js"
