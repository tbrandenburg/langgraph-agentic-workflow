import { agentStep, bashStep, defineWorkflow, publishStep } from "@wf/workflow-core";

export default defineWorkflow({
  id: "example-service-code-review",
  version: 1,

  steps: [
    bashStep("prepare", "prepare-workspace"),

    agentStep("plan", "planner", {
      inputs: ["task", "prepare"],
    }),

    bashStep("collect-context", "collect-context", {
      inputs: ["plan"],
    }),

    agentStep("implement", "coder", {
      inputs: ["task", "plan", "collect-context"],
    }),

    bashStep("apply-patch", "apply-patch", {
      inputs: ["implement"],
      onFailure: "publish",
    }),

    bashStep("validate", "validate", {
      inputs: ["apply-patch"],
      onFailure: "publish",
    }),

    agentStep("review", "reviewer", {
      inputs: ["plan", "implement", "validate"],
    }),

    bashStep("package", "package-artifacts", {
      inputs: ["review"],
    }),

    publishStep("publish"),
  ],
});
