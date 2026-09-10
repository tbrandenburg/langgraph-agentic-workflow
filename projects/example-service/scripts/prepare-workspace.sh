#!/usr/bin/env bash
# Core `bash` node runs scripts as `bash -euo pipefail <script>` with cwd set to the ephemeral
# run workspace (see packages/agent-runtime/src/run-script.ts). This script synthesizes a tiny
# throwaway sample target repo *inside that workspace* (never touching the real repository), so
# later steps (collect-context, apply-patch, validate) have something concrete to operate on.
set -euo pipefail

repo="$PWD/repo"
mkdir -p "$repo/src" "$repo/tests"

cat > "$repo/package.json" <<'EOF'
{
  "name": "sample-target-service",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "test": "node tests/health.test.js",
    "lint": "node -c src/index.js"
  }
}
EOF

cat > "$repo/src/index.js" <<'EOF'
// Minimal sample service. The example workflow's coder step is expected to add a health-check
// endpoint here.
export function createApp() {
  return {
    routes: {
      "/": () => ({ status: 200, body: { message: "hello" } }),
    },
  };
}
EOF

cat > "$repo/tests/health.test.js" <<'EOF'
import assert from "node:assert/strict";
import { createApp } from "../src/index.js";

const app = createApp();
const response = app.routes["/"]();
assert.equal(response.status, 200);
console.log("sample repo smoke test passed");
EOF

echo "prepared sample repo at $repo"
