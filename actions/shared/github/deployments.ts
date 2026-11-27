import { getInput } from "@actions/core";
import { context, getOctokit } from "@actions/github";

export type Deployment = { id: number; sha: string; branch: string | undefined };

const octokit = () => getOctokit(getInput("github_token", { required: true }));

/**
 * The repository's deployments, newest first, optionally of one environment.
 * Each records the commit as `sha` and its branch in `payload.branch`.
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
    }),
  );
};

/** A branch's deployments in an environment, grouped by commit, newest commit first. */
export const deployedReleases = async ({ environment, branch }: { environment: string; branch: string }) => {
  const deployments = await listDeployments({ environment });

  const bySha = new Map<string, Deployment[]>();
  for (const deployment of deployments) {
    if (deployment.branch !== branch) {
      continue;
    }
    bySha.set(deployment.sha, [...(bySha.get(deployment.sha) ?? []), deployment]);
  }

  return [...bySha].map(([sha, ofSha]) => ({ sha, deployments: ofSha }));
};

/**
 * Records a deploy in the repository's Deployments, and marks the branch's
 * earlier deployments in the environment inactive: only this one runs on the
 * branch's URL now.
 */
export const createDeployment = async ({
  environment,
  sha,
  branch,
  url,
  production,
  description,
}: {
  environment: string;
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
    payload: { branch },
    ...(description && { description }),
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
