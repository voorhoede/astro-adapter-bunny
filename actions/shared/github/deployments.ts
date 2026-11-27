import { getBooleanInput, getInput } from "@actions/core";
import { context, getOctokit } from "@actions/github";

export type Deployment = { id: number; sha: string; branch: string | undefined; release: string | undefined };

const octokit = () => getOctokit(getInput("github_token", { required: true }));

/**
 * The repository's deployments, newest first, optionally of one environment.
 * Each records the commit as `sha`, and its branch and release in `payload`.
 */
export const listDeployments = async ({ environment }: { environment?: string } = {}) => {
  const client = octokit();
  const deployments = await client.paginate(client.rest.repos.listDeployments, {
    ...context.repo,
    ...(environment && { environment }),
    per_page: 100,
  });

  return deployments.map(
    (deployment): Deployment => ({
      id: deployment.id,
      sha: deployment.sha,
      branch: (deployment.payload as { branch?: string }).branch,
      release: (deployment.payload as { release?: string }).release,
    }),
  );
};

/**
 * A branch's releases in an environment, newest first, each with its commit
 * and the deployments that refer to it. A release deployed twice, such as
 * after a rollback to it, counts once.
 */
export const deployedReleases = async ({ environment, branch }: { environment: string; branch: string }) => {
  const deployments = await listDeployments({ environment });

  const byRelease = new Map<string, { release: string; sha: string; deployments: Deployment[] }>();
  for (const deployment of deployments) {
    if (deployment.branch !== branch || !deployment.release) {
      continue;
    }
    const entry = byRelease.get(deployment.release) ?? { release: deployment.release, sha: deployment.sha, deployments: [] };
    entry.deployments.push(deployment);
    byRelease.set(deployment.release, entry);
  }

  return [...byRelease.values()];
};

/**
 * Records a release in the repository's Deployments, and marks the branch's
 * earlier deployments in the environment inactive: only this one runs on the
 * branch's URL now.
 */
export const createDeployment = async ({
  environment,
  release,
  sha,
  branch,
  url,
  production,
  description,
}: {
  environment: string;
  release: string;
  sha: string;
  branch: string;
  url: URL;
  production: boolean;
  description?: string;
}) => {
  const client = octokit();

  const { data: deployment } = await client.rest.repos.createDeployment({
    ...context.repo,
    // The commit as ref, so the deployment has the commit that is deployed, not the newest on the branch.
    ref: sha,
    environment,
    production_environment: production,
    // Without these GitHub merges the default branch into the ref first, and waits for the commit's checks.
    auto_merge: false,
    required_contexts: [],
    payload: { branch, release },
    // The release, since one commit can have several; shown on the Deployments page.
    description: description ? `${description}: ${release}` : release,
  });

  if (!("id" in deployment)) {
    throw new Error(`GitHub did not create a deployment for ${sha}.`);
  }

  await client.rest.repos.createDeploymentStatus({
    ...context.repo,
    deployment_id: deployment.id,
    state: "success",
    environment_url: url.href,
  });

  // GitHub marks earlier deployments inactive by itself, except in a production environment, so this does it for both.
  const { data: earlier } = await client.rest.repos.listDeployments({
    ...context.repo,
    environment,
    per_page: 20,
  });
  for (const other of earlier) {
    if (other.id === deployment.id) {
      continue;
    }
    if ((other.payload as { branch?: string }).branch !== branch) {
      continue;
    }
    await markInactive({ id: other.id });
  }

  return deployment.id;
};

export const markInactive = async ({ id }: { id: number }) => {
  await octokit().rest.repos.createDeploymentStatus({
    ...context.repo,
    deployment_id: id,
    state: "inactive",
  });
};

/** GitHub only deletes an inactive deployment, so this marks it inactive first. */
export const deleteDeployment = async ({ id }: { id: number }) => {
  await markInactive({ id });
  await octokit().rest.repos.deleteDeployment({ ...context.repo, deployment_id: id });
};

/** Whether the branch is the repository's default branch, which deploys go live from. */
export const isProductionBranch = (branch: string) => branch === context.payload.repository?.default_branch;

/**
 * Whether a deployment goes in GitHub as production: the `production` input
 * when it is set, else whether the branch is the default branch. A second
 * build of the default branch, such as a preview, sets it to false.
 */
export const isProductionDeployment = (branch: string) => {
  if (getInput("production") === "") {
    return isProductionBranch(branch);
  }
  return getBooleanInput("production");
};
