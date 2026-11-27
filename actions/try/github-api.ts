import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

type Status = "success" | "inactive" | "error" | "failure" | "pending" | "in_progress" | "queued";

type Deployment = {
  id: number;
  sha: string;
  ref: string;
  environment: string;
  production_environment: boolean;
  description: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  statuses: { state: Status; environment_url?: string }[];
};

/**
 * The part of GitHub's REST API the actions use, kept in a JSON file so one
 * run sees the deployments of the runs before it. It refuses what GitHub
 * refuses: deleting a deployment that is not inactive.
 */
export const startGitHubApi = async ({ stateFile }: { stateFile: string }) => {
  const load = (): Deployment[] => (existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : []);
  const save = (deployments: Deployment[]) => writeFileSync(stateFile, `${JSON.stringify(deployments, null, 2)}\n`);

  const view = ({ statuses, ...deployment }: Deployment) => ({ ...deployment, state: statuses.at(-1)?.state });

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    const body = await readBody(request);
    const send = (status: number, data?: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(data === undefined ? "" : JSON.stringify(data));
    };

    // /repos/{owner}/{repo}/...
    const [, , , resource, id, sub] = parts;
    const deployments = load();

    if (resource === "deployments" && !id && request.method === "GET") {
      const environment = url.searchParams.get("environment");
      const ref = url.searchParams.get("ref");
      const perPage = Number(url.searchParams.get("per_page") ?? 30);
      const page = Number(url.searchParams.get("page") ?? 1);
      const matching = deployments
        .filter((deployment) => !environment || deployment.environment === environment)
        .filter((deployment) => !ref || deployment.ref === ref || deployment.sha === ref)
        .sort((a, b) => b.id - a.id);
      return send(200, matching.slice((page - 1) * perPage, page * perPage).map(view));
    }

    if (resource === "deployments" && !id && request.method === "POST") {
      const deployment: Deployment = {
        id: Math.max(1000, ...deployments.map((other) => other.id)) + 1,
        sha: body.ref,
        ref: body.ref,
        environment: body.environment ?? "production",
        production_environment: body.production_environment ?? false,
        description: body.description ?? null,
        payload: body.payload ?? {},
        created_at: new Date().toISOString(),
        statuses: [],
      };
      save([...deployments, deployment]);
      return send(201, view(deployment));
    }

    const deployment = deployments.find((other) => other.id === Number(id));

    if (resource === "deployments" && sub === "statuses" && request.method === "POST") {
      if (!deployment) {
        return send(404, { message: "Not Found" });
      }
      deployment.statuses.push({ state: body.state, environment_url: body.environment_url });
      save(deployments);
      return send(201, { state: body.state });
    }

    if (resource === "deployments" && id && !sub && request.method === "DELETE") {
      if (!deployment) {
        return send(404, { message: "Not Found" });
      }
      if (deployment.statuses.at(-1)?.state !== "inactive") {
        return send(422, { message: "We cannot delete an active deployment unless it is the only deployment in a given environment." });
      }
      save(deployments.filter((other) => other !== deployment));
      return send(204);
    }

    // A commit by its full or short sha, from the deployments this API knows.
    if (resource === "commits" && id && request.method === "GET") {
      const known = deployments.find((other) => other.sha.startsWith(id));
      if (!known) {
        return send(422, { message: `No commit found for SHA: ${id}` });
      }
      return send(200, { sha: known.sha });
    }

    send(404, { message: `Not part of the test API: ${request.method} ${url.pathname}` });
  };

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      response.writeHead(500);
      response.end(String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    deployments: () => load().map(view),
  };
};

const readBody = async (request: IncomingMessage) => {
  let text = "";
  for await (const chunk of request) {
    text += chunk;
  }
  return text ? JSON.parse(text) : {};
};
