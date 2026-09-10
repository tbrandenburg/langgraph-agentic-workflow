import type { ProjectPolicy } from "@wf/workflow-core";

export const policy: ProjectPolicy = {
  prompts: ["planner", "coder", "reviewer"],
  scripts: ["prepare-workspace", "collect-context", "apply-patch", "validate", "package-artifacts"],
  workspacePaths: ["src", "tests", "package.json"],
  maxAgentTurns: 3,
  maxCommandSeconds: 900,
  allowRepositoryWrite: false,
};
