#!/usr/bin/env bash
# Final bash step before review/publish: packages the validated sample repo copy from the
# workspace into a single tarball artifact, listing its contents for inspection.
set -euo pipefail

repo="$PWD/repo"
out="$PWD/package.tar.gz"

if [ ! -d "$repo" ]; then
  echo "no sample repo found at $repo (prepare-workspace.sh must run first)" >&2
  exit 1
fi

tar -czf "$out" -C "$PWD" repo

echo "== package contents =="
tar -tzf "$out"

echo "packaged $repo into $out"
