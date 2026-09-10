#!/usr/bin/env bash
# Applies a patch produced by the coder agent step to the sample repo copy inside the ephemeral
# workspace, using `git apply --check` before `git apply` (per the plan). Only ever touches the
# workspace-local `repo/` copy, never the real repository (`allowRepositoryWrite: false`).
#
# NOTE (documented dry-run/M3 limitation): `run-script.ts` (packages/agent-runtime) does not yet
# forward a step's `inputs` (e.g. the coder's patch content) into this script's environment or
# stdin -- see nodes/bash.ts's `RunScriptInput.input` field, which is computed but currently
# unused by run-script.ts's `execa` invocation. Until that plumbing exists, this script looks for
# an optional `PATCH_FILE` env var pointing at a real patch on disk and, if absent, no-ops rather
# than failing, so the workflow's happy path (including full dry-run) still completes.
set -euo pipefail

repo="$PWD/repo"
patch_file="${PATCH_FILE:-$PWD/patch.diff}"

if [ ! -d "$repo" ]; then
  echo "no sample repo found at $repo (prepare-workspace.sh must run first)" >&2
  exit 1
fi

if [ ! -s "$patch_file" ]; then
  echo "no patch file at $patch_file; nothing to apply (dry-run/no-op path)"
  exit 0
fi

(
  cd "$repo"
  git apply --check "$patch_file"
  git apply "$patch_file"
)

echo "applied patch $patch_file to $repo"
