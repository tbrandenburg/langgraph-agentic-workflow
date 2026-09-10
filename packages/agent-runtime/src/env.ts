/**
 * Restricted environment allowlist for spawned child processes (`opencode`, `bash`).
 *
 * We never blindly forward all of `process.env` to a child process: that would leak repo-write
 * tokens, prod credentials, and anything else the host process happens to hold. Only a minimal
 * safe subset is passed through by default.
 *
 * Operators that need to pass provider API keys through to a *live* `opencode` invocation (M6)
 * can extend the allowlist via `AGENT_RUNTIME_ENV_ALLOWLIST` (comma-separated env var names) — a
 * deliberate opt-in escape hatch, not a default.
 */
const DEFAULT_ALLOWLIST = ["PATH", "HOME", "NODE_ENV", "LANG", "LC_ALL", "TMPDIR", "SHELL"];

export function restrictedEnv(extra: Record<string, string> = {}): Record<string, string> {
  const allowlist = [...DEFAULT_ALLOWLIST, ...extraAllowedKeys()];
  const env: Record<string, string> = {};
  for (const key of allowlist) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return { ...env, ...extra };
}

function extraAllowedKeys(): string[] {
  const raw = process.env.AGENT_RUNTIME_ENV_ALLOWLIST;
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
}
