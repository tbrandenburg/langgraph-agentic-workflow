# Implementation Plan

Derived from [INITIAL.md](INITIAL.md). Target: local PoC, TypeScript, pnpm workspaces, LangGraph JS.

## Guiding constraints

- **Core contains zero project content.** No prompt text, no shell commands, no domain logic in `packages/`.
- **Dry-run first.** We are rate limited. Every agent invocation MUST be runnable without an LLM call
  (`AGENT_DRY_RUN=1`). Live model calls are opt-in, used only in M6.
- **Evidence-first.** Each milestone ends with a manual E2E gate that produces command output. No milestone
  is "done" without pasted evidence.
- **Small files.** 200 LOC soft limit per module.

## Toolchain

| Concern | Choice |
| --- | --- |
| Runtime | Node 24, TypeScript (strict, no `any`) |
| Monorepo | pnpm workspaces + `tsc -b` project references |
| Graph | `@langchain/langgraph` (JS) |
| Checkpointer | `@langchain/langgraph-checkpoint-postgres` |
| API | Fastify + zod |
| Process spawning | `execa` (group-kill via `killDescendants`, `AbortSignal` cancellation) |
| Tests | vitest |
| Observability | LangSmith tracing + LangGraph Studio (see M6) |

`make clean` must delete `dist/` **and** all `*.tsbuildinfo` (stale build-info silently no-ops `tsc -b`).

---

## Milestone 0 — Repo skeleton

**Build**

- `pnpm-workspace.yaml` (`apps/*`, `packages/*`, `projects/*`), root `tsconfig.base.json`, `Makefile`
  (`install|run|stop|test|lint|build|clean|dev|e2e`), ESLint + Prettier, vitest config, `.env.example`.
- Empty packages with correct `package.json` names: `@wf/workflow-core`, `@wf/agent-runtime`,
  `@wf/agent-contracts`, `@app/run-api`, `@app/agent-service`.

**Manual E2E gate M0**

```bash
make install && make build && make lint && make clean && make build
```

Evidence: two consecutive `make build` runs after `clean` both emit `dist/` output (proves tsbuildinfo cleanup).

---

## Milestone 1 — Contracts (`packages/agent-contracts`)

**Build**

- `agent-result.ts`: `AgentResult` zod schema — `{ ok, role, stepId, summary, artifacts[], usage?, error? }`.
- `command-result.ts`: `CommandResult` — `{ ok, exitCode, durationMs, stdoutArtifact, stderrArtifact, truncated }`.
- `artifact.ts`: `ArtifactRef` — `{ id, stepId, kind, path, bytes, sha256 }`.
- No runtime deps beyond `zod`. Every schema exported both as zod object and inferred type.

**Manual E2E gate M1**

Unit tests only (no meaningful E2E surface yet): `pnpm -F @wf/agent-contracts test`.
Evidence: parse of a valid + an invalid fixture, invalid one rejected with a typed error.

---

## Milestone 2 — Core runtime (`packages/workflow-core`)

**Build**

1. `types.ts` — `WorkflowStep = AgentStep | BashStep | PublishStep`, `WorkflowDefinition`,
   `ProjectPolicy`, `defineWorkflow/agentStep/bashStep/publishStep` builders.
2. `state.ts` — `RunState` annotation: `run`, `workflow`, `task`, `currentStep`, `stepIndex`,
   `results` (append-only reducer keyed by `stepId`), `status`. **Compact data only** — everything large
   is an `ArtifactRef`.
3. `artifacts.ts` — filesystem artifact store under `.runs/<runId>/<stepId>/`, sha256 + byte count,
   write-once, redaction hook applied on write.
4. `persistence.ts` — Postgres checkpointer, `thread_id = agent-run/<runId>` (1:1 run-to-thread, never
   reused across unrelated runs so a finished run's history can be purged atomically). Falls back to
   `MemorySaver` when `DATABASE_URL` is unset (keeps local dev cheap). `PostgresSaver` has **no built-in
   TTL/pruning** (confirmed: checkpoints accumulate unbounded per thread unless deleted) — a periodic
   retention sweeper calls `checkpointer.deleteThread(threadId)` for archived/finalized runs older than a
   configurable window.
5. `nodes/initialize.ts` — run id (uuidv7), ephemeral workspace `mktemp -d`, artifact prefix, status `running`.
6. `nodes/advance.ts` — picks `steps[stepIndex]`; if previous result failed and step declared
   `onFailure: "publish"`, jump to publish. `routeStep()` returns `agent|bash|publish`.
7. `nodes/agent.ts` — resolves prompt via project registry, validates against policy, calls `runAgent`.
8. `nodes/bash.ts` — resolves registered script, validates against policy, calls `runScript`.
9. `nodes/publish.ts` — final status + artifact manifest (`manifest.json`).
10. `graph.ts` — exactly the graph from INITIAL.md.
11. `registry.ts` — loads `projects/<id>/{workflow,policy}.ts`, validates: every referenced prompt/script
    exists on disk AND is whitelisted in policy; every `inputs[]` refers to an earlier step id or `task`.
    **Fails at load time, not run time**, throwing a descriptive error (project id + missing path) rather
    than returning a boolean. Enforced in CI for free via a single `registry.spec.ts` vitest test that
    globs every `projects/*/` directory, calls `registry.load()` on each, and asserts no throw — no
    bespoke tooling, rides the existing `make test` job (registry drift, e.g. a renamed prompt/script,
    fails the build pre-merge).

**Policy enforcement points (must be tested):** unknown prompt, unknown script, script path escaping the
project dir, forward/self input reference, `maxCommandSeconds` timeout, `maxAgentTurns`, output truncation.

**Manual E2E gate M2**

A throwaway in-repo fixture project (`projects/__fixture__`) with one bash step (`echo`) and one publish step:

```bash
AGENT_DRY_RUN=1 pnpm tsx scripts/run-local.ts --project __fixture__ --task "smoke"
```

Evidence: run completes `status=succeeded`, `.runs/<id>/manifest.json` lists artifacts,
re-running with the same run id resumes from checkpoint rather than re-executing.

---

## Milestone 3 — Agent runtime + dry run (`packages/agent-runtime`)

**Build**

- `run-agent.ts` — spawns `opencode run --format json` as a child process via **execa** with:
  - `--model <model>`, prompt file content + JSON input on stdin, non-interactive.
  - `--format json` (confirmed flag, verified by direct invocation): stdout is pure **NDJSON**, one event
    per line, no banner text. Event `type`s observed: `step_start`, `text` (`part.text` holds streamed
    assistant text), `tool_use`, `step_finish` (`part.reason: "stop" | "tool-calls"`), `error` (top-level
    `error.name`/`error.data.message`/`error.data.ref`, no `part`). Parse line-by-line with `readline`,
    never `JSON.parse` the whole stream. Final summary = the contiguous run of `text` events immediately
    preceding the terminal `step_finish` with `reason:"stop"`. Success = exit code `0` AND no `error`-typed
    line seen; anything else → `ok:false`. Ignore trailing non-JSON-parseable lines (e.g. truncated on
    timeout) rather than crashing the parser. `opencode export <sessionID>` is **not** used in the hot
    path (extra process spawn, requires the sessionID already parsed from the stream, no output-shape
    advantage) — reserved for later manual audit/debugging only.
  - execa with `killDescendants: true` + `cancelSignal: abortController.signal` (not bare `child.kill()`):
    kills the whole process group (`process.kill(-pid, sig)` under the hood), so `opencode`'s own
    subprocesses are reaped too. `forceKillAfterDelay` left at execa's default (5000ms) for automatic
    SIGTERM → grace period → SIGKILL escalation.
  - stdout/stderr byte cap, restricted env allowlist (no repo-write tokens, no prod creds).
  - malformed/unparsable output → `ok:false` with the raw stdout kept as artifact (never throw raw).
- `run-script.ts` — `bash -euo pipefail <script>` in the ephemeral workspace, cwd-jailed, spawned via
  execa with the same `killDescendants`/`cancelSignal`/env rules as `run-agent.ts`, `run_id:step_id`
  idempotency key exported as env var. Scripts must not background their own children (`&`, `nohup`) —
  that would escape the process group and defeat group-kill; enforced by code review, `tree-kill` kept as
  a documented fallback if a script provably needs it.
- **`dry-run.ts` — the rate-limit escape hatch.** When `AGENT_DRY_RUN=1`:
  - no `opencode` process is spawned at all;
  - a deterministic stub `AgentResult` is synthesized from `{role, stepId, promptFile hash, inputs hash}`;
  - if `projects/<id>/fixtures/<role>.json` exists it is returned verbatim (lets us script realistic
    multi-step flows offline);
  - the stub is written to artifacts exactly like a real result, so downstream steps and the manifest
    are exercised identically.
  - Mode is recorded in the manifest as `"mode": "dry-run" | "live"` — traces must never be ambiguous.
- CLI entrypoint matching INITIAL.md:
  `agent-runtime run --role <r> --input in.json --output out.json --prompt <file> --model <m> [--dry-run]`.

**Manual E2E gate M3**

```bash
# offline stub
AGENT_DRY_RUN=1 pnpm -F @wf/agent-runtime exec agent-runtime run \
  --role planner --prompt projects/__fixture__/prompts/planner.md \
  --input /tmp/in.json --output /tmp/out.json --model opencode/big-pickle
# single live call, budget: 1 request
pnpm -F @wf/agent-runtime exec agent-runtime run --role planner ... # no AGENT_DRY_RUN
```

Evidence: both produce schema-valid `out.json`; dry run is byte-identical across two invocations;
timeout path verified with a `sleep 999` script returning `ok:false, exitCode=124`.

---

## Milestone 4 — Example project + registration

**Build**

- `projects/example-service/`: `workflow.ts` (exact 9-step sequence from INITIAL.md), `policy.ts`,
  `prompts/{planner,coder,reviewer}.md`, `fixtures/{planner,coder,reviewer}.json` (dry-run payloads),
  `scripts/{prepare-workspace,collect-context,apply-patch,validate,package-artifacts}.sh`.
- Scripts operate only on a **copy** of a sample target repo inside the ephemeral workspace.
  `allowRepositoryWrite: false` is enforced by the runtime env, not by script politeness.
- `apply-patch.sh` uses `git apply --check` then `git apply`; `validate.sh` runs lint + tests + a secret
  scan and is the deterministic gate.

**Manual E2E gate M4 — full happy path, offline**

```bash
AGENT_DRY_RUN=1 pnpm tsx scripts/run-local.ts \
  --project example-service --workflow example-service-code-review \
  --task "Add a health-check endpoint"
```

Evidence: all 9 steps appear in `manifest.json` in order; the *same* agent node served planner, coder
and reviewer; no file outside `.runs/` and the temp workspace was modified (`git status --porcelain` clean).

---

## Milestone 5 — API + operations

**Build**

- `apps/run-api`: `POST /runs` (zod-validated `{project, workflow, task, model}` — **no prompt/command
  passthrough**), `GET /runs/:runId`, `POST /runs/:runId/cancel`.
- `apps/agent-service`: loads registry, compiles the graph once, executes runs, honours cancellation via
  `AbortController` propagated to child processes.
- Concurrency limit (`MAX_CONCURRENT_RUNS`), artifact retention sweeper, log redaction
  (token/keys/emails) applied at artifact-write time, structured JSON logs.
- `infra/langgraph/docker-compose.yaml`: Postgres (+ optional Grafana/Prometheus scrape target).

**Manual E2E gate M5**

```bash
docker compose -f infra/langgraph/docker-compose.yaml up -d
make run
curl -s -XPOST localhost:8080/runs -d '{"project":"example-service",...}' | jq .runId
curl -s localhost:8080/runs/$RUN | jq '.status,.steps'
curl -s -XPOST localhost:8080/runs/$RUN/cancel
```

Evidence for each of the 7 INITIAL.md demo scenarios, all runnable in dry-run except (2):

| # | Scenario | How to force |
| --- | --- | --- |
| 1 | success | default fixtures |
| 2 | model failure | invalid model / unset key (1 live call) |
| 3 | malformed agent output | fixture with broken JSON |
| 4 | bash failure | fixture script `exit 3` |
| 5 | invalid patch | corrupt patch fixture → `git apply --check` fails |
| 6 | failed tests | `validate.sh` non-zero → later agent steps skipped |
| 7 | restart recovery | `kill -9` mid-run, restart, resume from checkpoint |

Cancellation must leave no orphan child processes (`pgrep -f opencode` empty).

---

## Milestone 6 — Final manual E2E with monitoring

Run **live** (rate-limit budget permitting) with full observability. This is the only milestone that
requires real model calls; run it once, deliberately.

### Setup

```bash
export LANGSMITH_TRACING=true
export LANGSMITH_API_KEY=...          # never logged, never committed
export LANGSMITH_PROJECT=langgraph-agentic-workflow-poc
```

### 6a — LangGraph Studio (local debugging)

- Add `langgraph.json` pointing at the compiled graph export.
- `langgraph dev` → open Studio.
- Verify, per run: node-by-node execution path (`initialize → advance → bash → advance → agent → …`),
  graph state at each superstep (`stepIndex`, `results` keys, `status`), intermediate outputs, and that
  no oversized blob leaked into state (artifact refs only).
- Use Studio to replay/fork from a checkpoint at the `validate` step and confirm the failure branch routes
  straight to `publish`.

### 6b — LangSmith (ongoing tracing)

- Confirm nested traces: one root trace per run, child spans per node, LLM spans under `agent`,
  child-process spans under `bash`.
- Check recorded latency, token usage and cost per agent step; errors surface with the step id.
- Tag every trace with `runId`, `projectId`, `workflowId`, and `mode=live|dry-run`.
- Compare a dry-run trace against the live trace: identical node path, differing only in LLM spans.

### 6c — Server API introspection

```bash
curl -s localhost:2024/threads/agent-run%2F$RUN_ID/state | jq '.values.status,.values.stepIndex'
curl -s localhost:2024/runs | jq '.[].status'
```

Confirms programmatic access to runs/threads/state matches what the run-api reports.

### 6d — Metrics (self-hosted path)

Scrape the service's Prometheus endpoint from the compose stack; assert counters exist for
runs started/succeeded/failed/cancelled and a histogram of step duration by `kind`. Grafana dashboard
is optional for the PoC — a screenshot of the scraped metrics is sufficient evidence.

### Final acceptance checklist (Definition of Done)

- [ ] `rg -n` over `packages/` finds no prompt text and no project command — core is clean.
- [ ] `projects/example-service/workflow.ts` alone determines step order.
- [ ] One `agent` node served planner, coder and reviewer in a single run trace.
- [ ] `validate.sh` failure demonstrably skipped the downstream agent step.
- [ ] `manifest.json` + artifacts persisted and inspectable for every run.
- [ ] Target repo and all external systems unmutated (`git status` clean, no network writes).
- [ ] Studio screenshot + LangSmith trace URL attached.
- [ ] Every gate M0–M5 has pasted command output.

---

## Risks

| Risk | Mitigation |
| --- | --- |
| LLM rate limits block progress | `AGENT_DRY_RUN=1` + per-role fixtures for M0–M5; live calls only in M3 (1) and M6 |
| `opencode` stdout not machine-parsable | `opencode run --format json` emits NDJSON with typed events (`text`, `tool_use`, `step_finish`, `error`) — parsed line-by-line, never raw-`JSON.parse`d as a whole; malformed output is a first-class `ok:false` path, never a crash |
| Checkpointer/state bloat | State holds refs only (`ArtifactRef`), never blobs; `PostgresSaver` has no built-in TTL, so a periodic sweeper runs `deleteThread(threadId)` per finalized run (1 thread per run, never shared) |
| Registry drift (prompt/script renamed) | Load-time validation of workflow ↔ policy ↔ filesystem throws descriptively; a single `registry.spec.ts` vitest test loads every `projects/*/` pair and asserts no throw, enforced for free in the existing `make test`/CI job |
| Orphaned child processes on cancel | Spawn via `execa` with `killDescendants: true` + `cancelSignal` (group-kill via `process.kill(-pid, sig)`, default 5s SIGTERM→SIGKILL escalation via `forceKillAfterDelay`), not bare `child.kill()`; asserted in M5 with `pgrep -f opencode` empty (pre/post snapshot diff) |
