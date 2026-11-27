import { setFailed, setOutput } from "@actions/core";
import { branchName, branchPullZoneName, commitSha, pullZoneUrl, releaseName } from "../../shared/github/names.ts";

// The deploy names its resources the same way, so a build can know its address before it exists.
try {
  setOutput("commit_url", pullZoneUrl(releaseName(commitSha())).href);
  setOutput("branch_url", pullZoneUrl(branchPullZoneName(branchName())).href);
} catch (error) {
  setFailed(error instanceof Error ? error.message : String(error));
}
