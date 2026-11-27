import { getInput, info, setFailed } from "@actions/core";
import { createDeployment, isProductionBranch } from "../../shared/github/deployments.ts";
import { branchName, commitSha } from "../../shared/github/names.ts";

try {
  const branch = branchName();
  const sha = commitSha();

  const id = await createDeployment({
    environment: getInput("environment", { required: true }),
    sha,
    branch,
    url: new URL(getInput("url", { required: true })),
    production: isProductionBranch(branch),
  });

  info(`Deployment ${id} for ${sha.slice(0, 7)} on ${branch}`);
} catch (error) {
  setFailed(error instanceof Error ? error.message : String(error));
}
