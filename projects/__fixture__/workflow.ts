import { bashStep, defineWorkflow, publishStep } from "@wf/workflow-core";

export default defineWorkflow({
  id: "fixture-smoke",
  version: 1,
  steps: [bashStep("echo", "echo", { inputs: ["task"] }), publishStep("publish")],
});
