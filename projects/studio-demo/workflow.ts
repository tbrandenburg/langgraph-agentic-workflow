import { agentStep, bashStep, defineWorkflow, publishStep } from "@wf/workflow-core";

export default defineWorkflow({
  id: "studio-demo",
  version: 1,

  steps: [
    bashStep("prepare", "prepare"),

    agentStep("plan", "planner", {
      inputs: ["task", "prepare"],
    }),

    bashStep("finish", "finish", {
      inputs: ["plan"],
    }),

    publishStep("publish"),
  ],
});
