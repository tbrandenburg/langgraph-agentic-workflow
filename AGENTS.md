# AGENTS.md — LangGraph Agentic Workflow

Project-specific guidance for AI agents (and humans) working in this repository. This
supplements, and does not replace, the global `~/.config/opencode/AGENTS.md` constitution
(KISS, DRY, evidence-first, no silent failures, etc. — all still apply here).

## Purpose

A local, API-triggered [LangGraph](https://github.com/langchain-ai/langgraphjs) agent system
that cleanly separates:

- **Core orchestration** (`packages/workflow-core`, `packages/agent-runtime`,
  `packages/agent-contracts`) — reusable, project-agnostic LangGraph nodes and process
  runners. **Must never contain prompt text, shell commands, or domain logic.**
- **Project content** (`projects/<id>/`) — per-project workflow definitions, prompts, bash
  scripts, and policy, expressed as plain TypeScript + Markdown + shell files.

One `agent` node executes every prompt-driven workflow step; one `bash` node executes every
project script. Adding a new project (new prompts/scripts/workflow order) never requires
changing core code. See `docs/INITIAL.md` for the full design spec and
`docs/IMPLEMENTATION_PLAN.md` for the milestone-by-milestone build history and evidence.

## Repository layout

```
apps/            run-api (Fastify HTTP surface), agent-service (registry + graph + execution)
packages/        workflow-core, agent-runtime, agent-contracts — the reusable core
projects/        per-project workflow/policy/prompts/scripts (example-service, studio-demo, __fixture__)
infra/langgraph/ docker-compose Postgres + langgraph dev / LangGraph Studio entry point
docs/            INITIAL.md (spec), IMPLEMENTATION_PLAN.md (milestones + evidence), assets/
scripts/         run-local.ts — CLI entrypoint for exercising a project's workflow directly
```

## Make targets

| Target         | What it does                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `make install` | `pnpm install` across the whole workspace                                                                                      |
| `make build`   | `tsc -b` (project references) for every package/app                                                                            |
| `make lint`    | `eslint` + `prettier --check`                                                                                                  |
| `make test`    | `vitest run` across every package/app (dry-run only, no network, no LLM calls)                                                 |
| `make clean`   | Deletes every `dist/` **and** every stray `*.tsbuildinfo` (a stale `tsbuildinfo` silently no-ops `tsc -b` — always clean both) |
| `make run`     | Starts `apps/run-api`'s Fastify server on `:8080` (detached process-group leader, pidfile `.run-api.pid`, logs `.run-api.log`) |
| `make stop`    | Stops it cleanly (`SIGTERM` → `SIGKILL` on the whole process group — zero orphaned children)                                   |
| `make dev`     | Runs `apps/run-api` in the foreground (for interactive debugging)                                                              |

Run `AGENT_DRY_RUN=1 make run` for a safe, instant, no-LLM-call server (recommended default for
local development). Omit it (or set `AGENT_DRY_RUN=0`) to spawn real `opencode` processes and
real bash scripts — costs real tokens/rate-limit budget.

## Adding a new project

1. Create `projects/<id>/workflow.ts` using `defineWorkflow`/`agentStep`/`bashStep`/`publishStep`
   from `@wf/workflow-core` (see `projects/studio-demo/` for a minimal 4-step example, or
   `projects/example-service/` for a realistic 9-step one).
2. Create `projects/<id>/policy.ts` — whitelist every prompt/script the workflow references,
   set `maxAgentTurns`/`maxCommandSeconds`/`allowRepositoryWrite`.
3. Add `projects/<id>/prompts/<role>.md` for every referenced prompt, and
   `projects/<id>/scripts/<name>.sh` for every referenced script (`#!/usr/bin/env bash` +
   `set -euo pipefail`, never background children with `&`/`nohup` — that escapes the
   process group and defeats cancellation's group-kill).
4. Add `projects/<id>/fixtures/<role>.json` (a valid `AgentResult`, keyed by **prompt name**,
   not step id) for every agent step, so dry-run mode is deterministic and instant.
5. `make build && make test` — the registry validates every prompt/script reference and every
   step's `inputs[]` at load time (fails loudly with a descriptive error, never silently), and
   `registry.spec.ts` globs every `projects/*/` directory automatically — no extra wiring needed.

## Testing conventions

- Every package/app that has its own tests needs a package-local `vitest.config.ts` (include:
  `src/**/*.spec.ts`) plus a local `vitest` devDependency and a `test` script in its
  `package.json` — the root vitest config alone does not make `pnpm -F <pkg> test` work
  standalone (see any existing package for the pattern).
- Prefer real integration tests over mocks where feasible (e.g. spawning a real fake shell
  script for `run-script.ts` tests) — see `packages/agent-runtime/src/run-agent.spec.ts`'s
  regression test, which inspects a fake binary's real argv/stdin rather than only asserting on
  its canned stdout (a prior version of this test gave false confidence for exactly this
  reason — a real bug in how the CLI's message was passed went undetected for a full
  milestone).
- Throwaway integration tests that write to `.runs/<runId>/...` must use a unique (random)
  `runId` per test run and clean up **every** root the code under test can write to, not just
  a custom one the test configured — `ArtifactStore`'s default `.runs/` root is separate from
  any custom trace directory a test might also set up.

## `/studio` — built-in live execution-graph viewer

`apps/run-api/src/studio-page.ts` serves a single, self-contained, credential-free HTML page at
`GET /studio` while `make run` is up:

```bash
AGENT_DRY_RUN=1 make run
# open http://localhost:8080/studio in a browser
```

It renders the fixed 5-node core topology (`initialize → advance → {agent|bash|publish} →
advance (loop) → publish → END`) as a hand-styled dark-theme SVG diagram, lets you trigger a run
from the page itself (pre-filled to the fast, dry-run-fixture-backed `studio-demo` project), and
polls `GET /runs/:id` + `GET /runs/:id/trace` to animate each node through
idle → active (pulsing) → completed (✓) / failed in real time, alongside a live `GET /metrics`
strip. No LangSmith account, no login, no external network call of any kind.

This exists specifically because LangGraph Studio's hosted UI requires a LangSmith account login
gated behind hCaptcha, with no supported credential-free bypass (confirmed by direct testing — see
`docs/IMPLEMENTATION_PLAN.md`'s history for the investigation). Use `/studio` as the default local
dev tool; only reach for `langgraph dev`/hosted Studio below if you specifically need its own
tooling (checkpoint replay/fork) and already have a LangSmith account.

When extending `/studio`: keep it a single dependency-free static page (no bundler, no new
`package.json` dependency, CDN `<script>` tags only if truly needed) — the hand-rolled SVG+CSS
approach was a deliberate choice over Cytoscape.js/vis-network/Mermaid.js, since the graph
topology is small and fixed, and hand-styling gives full control over live per-node state
highlighting without fighting a generic layout engine or fragile DOM-scraping of a library's
rendered output.

## LangGraph Studio / `langgraph dev`

`infra/langgraph/studio-graph.ts` hosts `projects/studio-demo/` behind `langgraph dev`. Use the
**JS-native** `@langchain/langgraph-cli` (via `npx`) — the **Python** `langgraph-cli` package's
in-memory dev server explicitly refuses JS/TS graphs.

```bash
AGENT_DRY_RUN=1 npx --yes @langchain/langgraph-cli dev --no-browser --port 2024 \
  --config infra/langgraph/langgraph.json
```

The interactive graph UI (`https://smith.langchain.com/studio?baseUrl=http://localhost:2024`)
requires a LangSmith account login — if unavailable, the same execution graph can always be
regenerated locally and offline (no credentials needed) via LangGraph JS's own Mermaid export:
`(await graph.getGraphAsync({ xray: true })).drawMermaidPng()` (see `docs/assets/` for a
pre-rendered copy).

## Process safety

- Always spawn child processes (`opencode`, bash scripts) via `execa` with
  `killDescendants: true` + `cancelSignal`, never bare `child.kill()` — this kills the whole
  process group, so nested subprocesses are reaped too.
- **Never** use a broad `pkill -f <pattern>`/`killall` command in this repo's dev environment.
  If you are an AI coding agent working on this repo, you are very likely running inside your
  own `opencode run ...` process — a broad pattern match can and has killed the coordinating
  session itself. Always capture and kill an **exact PID** you started yourself.

## Observability (no LangSmith/cloud dependency required)

- `.runs/<runId>/trace.jsonl` — structured per-node JSONL trace (start/end, duration, mode).
- `GET /runs/:id/trace` — the same trace over HTTP.
- `GET /metrics` — run counters + per-kind step-duration breakdown (JSON, not Prometheus text
  format — a documented PoC simplification).
- `.runs/<runId>/publish/manifest.json` — full artifact manifest per run.
