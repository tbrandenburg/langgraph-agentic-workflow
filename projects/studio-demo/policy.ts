import type { ProjectPolicy } from "@wf/workflow-core";

export const policy: ProjectPolicy = {
  prompts: ["planner"],
  scripts: ["prepare", "finish"],
  workspacePaths: [],
  maxAgentTurns: 1,
  maxCommandSeconds: 30,
  allowRepositoryWrite: false,
};
