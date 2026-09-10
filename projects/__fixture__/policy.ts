import type { ProjectPolicy } from "@wf/workflow-core";

export const policy: ProjectPolicy = {
  prompts: ["planner"],
  scripts: ["echo"],
  workspacePaths: [],
  maxAgentTurns: 1,
  maxCommandSeconds: 30,
  allowRepositoryWrite: false,
};
