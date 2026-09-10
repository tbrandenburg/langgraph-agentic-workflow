/**
 * `GET /studio` — a self-hosted, credential-free, offline live execution-graph viewer.
 *
 * Design choice (see task handoff for full research): hand-rolled SVG+CSS instead of a CDN
 * library. Researched alternatives:
 *  - Cytoscape.js (+cytoscape-dagre): great for large/dynamic graphs, but adds a CDN dependency
 *    and a generic force/dagre layout for a graph this is overkill for a *fixed*, 5-node,
 *    always-identical topology — we'd be fighting its auto-layout to reproduce a diagram we can
 *    just draw once by hand.
 *  - Mermaid.js: DRY win (same syntax `docs/assets` already renders), but Mermaid's rendered SVG
 *    node/edge DOM structure is generated/internal and not designed for per-node dynamic
 *    re-styling (no stable per-node ids/classes to hook live "active/completed/failed" states
 *    onto without fragile DOM-scraping).
 *  - vis-network: similar tradeoffs to Cytoscape for a graph this small and static.
 *  - Hand-rolled SVG+CSS (chosen): the topology is a small, fixed, documented constant
 *    (`packages/workflow-core/src/graph.ts`), so a hand-authored SVG with well-designed CSS
 *    (gradients, glow/pulse keyframes, checkmark icons) gives full control over live-state
 *    styling with zero new dependencies and zero build step — the best fit for "small internal
 *    dev tool that must look marvellous."
 *
 * Kept as a template-string-returning module (not JSX/a templating engine) to avoid any new
 * dependency; `server.ts` just serves this string with `text/html`.
 */
export const studioPageHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>LangGraph Studio · Local</title>
<style>
  :root {
    --bg: #0d1117;
    --panel: #161b22;
    --panel-2: #1c2129;
    --border: #30363d;
    --text: #e6edf3;
    --muted: #8b949e;
    --accent: #58a6ff;
    --accent-2: #a371f7;
    --ok: #3fb950;
    --fail: #f85149;
    --idle: #30363d;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
    background: radial-gradient(circle at 20% -10%, #1c2333 0%, var(--bg) 45%);
    color: var(--text);
    min-height: 100vh;
  }
  header {
    padding: 24px 32px 12px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
  header h1 {
    font-size: 18px;
    margin: 0;
    font-weight: 600;
    letter-spacing: 0.2px;
  }
  header .tag {
    font-size: 11px;
    color: var(--muted);
    border: 1px solid var(--border);
    padding: 2px 8px;
    border-radius: 999px;
  }
  main {
    display: grid;
    grid-template-columns: 340px 1fr;
    gap: 20px;
    padding: 24px 32px;
    max-width: 1280px;
    margin: 0 auto;
  }
  .card {
    background: linear-gradient(180deg, var(--panel) 0%, var(--panel-2) 100%);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 18px;
  }
  .card h2 {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--muted);
    margin: 0 0 14px;
  }
  label {
    display: block;
    font-size: 12px;
    color: var(--muted);
    margin: 10px 0 4px;
  }
  input {
    width: 100%;
    background: #0d1117;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 10px;
    color: var(--text);
    font-size: 13px;
  }
  input:focus { outline: 1px solid var(--accent); }
  button#runBtn {
    margin-top: 16px;
    width: 100%;
    padding: 10px;
    border: none;
    border-radius: 8px;
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    color: #0d1117;
    font-weight: 600;
    font-size: 13px;
    cursor: pointer;
    transition: transform 0.15s ease, filter 0.15s ease;
  }
  button#runBtn:hover { filter: brightness(1.08); transform: translateY(-1px); }
  button#runBtn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
  #statusBanner {
    margin-top: 14px;
    padding: 10px 12px;
    border-radius: 8px;
    font-size: 12px;
    display: none;
    border: 1px solid var(--border);
  }
  #statusBanner.show { display: block; }
  #statusBanner.running { color: var(--accent); border-color: var(--accent); }
  #statusBanner.succeeded { color: var(--ok); border-color: var(--ok); }
  #statusBanner.failed { color: var(--fail); border-color: var(--fail); }

  svg#graph { width: 100%; height: 340px; overflow: visible; }
  .node-box {
    fill: var(--panel-2);
    stroke: var(--idle);
    stroke-width: 1.5;
    transition: stroke 0.3s ease, fill 0.3s ease, filter 0.3s ease;
  }
  .node-label { fill: var(--text); font-size: 13px; font-weight: 600; text-anchor: middle; }
  .node-sub { fill: var(--muted); font-size: 10px; text-anchor: middle; }
  .edge { stroke: var(--border); stroke-width: 1.6; fill: none; }
  .edge-arrow { fill: var(--border); }

  .node.active .node-box {
    stroke: var(--accent);
    filter: drop-shadow(0 0 10px rgba(88, 166, 255, 0.65));
    animation: pulse 1.1s ease-in-out infinite;
  }
  .node.completed .node-box { stroke: var(--ok); fill: #12261a; }
  .node.failed .node-box { stroke: var(--fail); fill: #2a1414; }
  @keyframes pulse {
    0%, 100% { stroke-width: 1.5; }
    50% { stroke-width: 3; }
  }
  .check { display: none; }
  .node.completed .check { display: block; }
  .node.failed .check { display: block; }

  #stepBadge {
    margin-top: 16px;
    font-size: 12px;
    color: var(--muted);
    min-height: 18px;
  }
  #stepBadge .value { color: var(--accent); font-weight: 600; }

  .metrics-strip {
    margin-top: 18px;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
  }
  .metric {
    background: #0d1117;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px;
    text-align: center;
  }
  .metric .num { font-size: 18px; font-weight: 700; }
  .metric .lbl { font-size: 10px; color: var(--muted); text-transform: uppercase; }
  #stepsBreakdown { margin-top: 10px; font-size: 12px; color: var(--muted); }
</style>
</head>
<body>
<header>
  <h1>LangGraph Studio</h1>
  <span class="tag">local · credential-free · dry-run capable</span>
</header>
<main>
  <section class="card">
    <h2>Trigger run</h2>
    <label for="project">Project</label>
    <input id="project" value="studio-demo" />
    <label for="workflow">Workflow</label>
    <input id="workflow" value="studio-demo" />
    <label for="task">Task</label>
    <input id="task" value="Say hello from the studio viewer" />
    <label for="model">Model</label>
    <input id="model" value="dry-run" />
    <button id="runBtn">Run</button>
    <div id="statusBanner"></div>
    <div id="stepBadge"></div>
  </section>

  <section class="card">
    <h2>Execution graph</h2>
    <svg id="graph" viewBox="0 0 860 300"></svg>
    <div class="metrics-strip" id="metricsStrip"></div>
    <div id="stepsBreakdown"></div>
  </section>
</main>

<script>
(function () {
  var NODES = [
    { id: "initialize", label: "initialize", x: 40,  y: 130 },
    { id: "advance",    label: "advance",    x: 220, y: 130 },
    { id: "agent",      label: "agent",      x: 420, y: 30 },
    { id: "bash",       label: "bash",       x: 420, y: 130 },
    { id: "publish",    label: "publish",    x: 420, y: 230 },
    { id: "end",        label: "END",        x: 640, y: 130 }
  ];
  var W = 140, H = 60;

  function nodeBox(n) {
    return (
      '<g class="node" data-node="' + n.id + '" transform="translate(' + (n.x) + ',' + (n.y - H / 2) + ')">' +
      '<rect class="node-box" width="' + W + '" height="' + H + '" rx="12"></rect>' +
      '<text class="node-label" x="' + (W / 2) + '" y="26">' + n.label + '</text>' +
      '<text class="node-sub" data-sub="' + n.id + '" x="' + (W / 2) + '" y="42"></text>' +
      '<text class="check" x="' + (W - 18) + '" y="18">\u2713</text>' +
      '</g>'
    );
  }

  function edge(x1, y1, x2, y2) {
    var midX = (x1 + x2) / 2;
    return (
      '<path class="edge" d="M' + x1 + ',' + y1 + ' C' + midX + ',' + y1 + ' ' + midX + ',' + y2 + ' ' + x2 + ',' + y2 + '"></path>' +
      '<polygon class="edge-arrow" points="' + x2 + ',' + y2 + ' ' + (x2 - 8) + ',' + (y2 - 4) + ' ' + (x2 - 8) + ',' + (y2 + 4) + '"></polygon>'
    );
  }

  var svg = document.getElementById("graph");
  var byId = {};
  NODES.forEach(function (n) { byId[n.id] = n; });

  svg.innerHTML =
    '<g>' +
    edge(byId.initialize.x + W, byId.initialize.y, byId.advance.x, byId.advance.y) +
    edge(byId.advance.x + W, byId.advance.y - 10, byId.agent.x, byId.agent.y) +
    edge(byId.advance.x + W, byId.advance.y, byId.bash.x, byId.bash.y) +
    edge(byId.advance.x + W, byId.advance.y + 10, byId.publish.x, byId.publish.y) +
    edge(byId.agent.x + W, byId.agent.y, byId.end.x, byId.end.y) +
    edge(byId.bash.x + W, byId.bash.y, byId.end.x, byId.end.y) +
    edge(byId.publish.x + W, byId.publish.y, byId.end.x, byId.end.y) +
    '</g>' +
    NODES.map(nodeBox).join("");

  function setState(nodeId, state, sub) {
    var g = svg.querySelector('[data-node="' + nodeId + '"]');
    if (!g) return;
    g.classList.remove("active", "completed", "failed");
    if (state) g.classList.add(state);
    if (sub !== undefined) {
      var s = g.querySelector('[data-sub]');
      if (s) s.textContent = sub || "";
    }
  }

  function resetGraph() {
    NODES.forEach(function (n) { setState(n.id, null, ""); });
  }

  var runBtn = document.getElementById("runBtn");
  var banner = document.getElementById("statusBanner");
  var stepBadge = document.getElementById("stepBadge");
  var pollTimer = null;
  // Dry-run/fixture-backed steps can complete in single-digit milliseconds -- far faster than any
  // HTTP poll cadence -- so a naive "apply the whole trace array at once" would only ever render
  // the final state and never show a node's transient "active" pulse. We instead replay newly
  // observed events one at a time with a small stagger, so the diagram always feels alive and
  // legible regardless of how fast the underlying run actually was.
  var STAGGER_MS = 450;
  var appliedCount = 0;
  var replayQueue = [];
  var replayTimer = null;
  var onQueueDrained = null;

  function showBanner(cls, text) {
    banner.className = "show " + cls;
    banner.textContent = text;
  }

  function applyOne(ev) {
    if (ev.phase === "start") {
      setState(ev.nodeName, "active", ev.stepId ? ev.nodeName + ": " + ev.stepId : "");
      if (ev.stepId) {
        stepBadge.innerHTML = 'Current step: <span class="value">' + ev.nodeName + ": " + ev.stepId + "</span>";
      }
    } else {
      var cls = ev.ok === false ? "failed" : "completed";
      setState(ev.nodeName, cls, ev.stepId ? ev.nodeName + ": " + ev.stepId : "");
    }
  }

  // Drains the replay queue one event at a time on a single recurring timer, so events queued
  // across multiple poll cycles still play back at a steady, legible pace instead of each poll
  // restarting its own stagger countdown from zero (which would visually collapse the animation).
  function pumpReplayQueue() {
    if (replayTimer) return;
    replayTimer = setInterval(function () {
      var ev = replayQueue.shift();
      if (ev) {
        applyOne(ev);
        return;
      }
      clearInterval(replayTimer);
      replayTimer = null;
      if (onQueueDrained) {
        var cb = onQueueDrained;
        onQueueDrained = null;
        cb();
      }
    }, STAGGER_MS);
  }

  function enqueueNewEvents(events) {
    var fresh = events.slice(appliedCount);
    appliedCount = events.length;
    replayQueue = replayQueue.concat(fresh);
    pumpReplayQueue();
  }

  async function pollRun(runId) {
    try {
      var runRes = await fetch("/runs/" + runId);
      var run = await runRes.json();
      var traceRes = await fetch("/runs/" + runId + "/trace");
      var trace = await traceRes.json();
      if (Array.isArray(trace)) enqueueNewEvents(trace);

      if (run.status === "succeeded" || run.status === "failed" || run.status === "cancelled") {
        clearInterval(pollTimer);
        runBtn.disabled = false;
        onQueueDrained = function () {
          showBanner(run.status === "succeeded" ? "succeeded" : "failed", "Run " + run.status + " (" + runId + ")");
          refreshMetrics();
        };
        if (!replayTimer && replayQueue.length === 0) {
          var cb = onQueueDrained;
          onQueueDrained = null;
          cb();
        }
        return;
      }
      showBanner("running", "Run in progress (" + runId + ")");
    } catch (err) {
      clearInterval(pollTimer);
      runBtn.disabled = false;
      showBanner("failed", "Polling error: " + err);
    }
  }

  runBtn.addEventListener("click", async function () {
    resetGraph();
    stepBadge.textContent = "";
    appliedCount = 0;
    replayQueue = [];
    onQueueDrained = null;
    if (replayTimer) {
      clearInterval(replayTimer);
      replayTimer = null;
    }
    runBtn.disabled = true;
    showBanner("running", "Starting run...");
    try {
      var body = {
        project: document.getElementById("project").value,
        workflow: document.getElementById("workflow").value,
        task: document.getElementById("task").value,
        model: document.getElementById("model").value
      };
      var res = await fetch("/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        var errBody = await res.json();
        showBanner("failed", "Failed to start: " + (errBody.message || errBody.error));
        runBtn.disabled = false;
        return;
      }
      var data = await res.json();
      pollTimer = setInterval(function () { pollRun(data.runId); }, 400);
      pollRun(data.runId);
    } catch (err) {
      showBanner("failed", "Error: " + err);
      runBtn.disabled = false;
    }
  });

  async function refreshMetrics() {
    try {
      var res = await fetch("/metrics");
      var m = await res.json();
      var strip = document.getElementById("metricsStrip");
      strip.innerHTML =
        metricCard(m.runs_started_total, "Started") +
        metricCard(m.runs_succeeded_total, "Succeeded") +
        metricCard(m.runs_failed_total, "Failed") +
        metricCard(m.runs_cancelled_total, "Cancelled");
      var breakdown = document.getElementById("stepsBreakdown");
      breakdown.textContent = (m.steps || [])
        .map(function (s) { return s.kind + ": " + s.count + " steps, avg " + Math.round(s.avgDurationMs || 0) + "ms"; })
        .join(" · ");
    } catch (err) {
      // metrics are best-effort; ignore failures silently in the UI (non-critical panel)
    }
  }

  function metricCard(num, label) {
    return '<div class="metric"><div class="num">' + (num || 0) + '</div><div class="lbl">' + label + '</div></div>';
  }

  resetGraph();
  refreshMetrics();
})();
</script>
</body>
</html>`;
