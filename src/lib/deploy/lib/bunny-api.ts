const API_URL = "https://api.bunny.net";

export class BunnyApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(method: string, path: string, status: number, body: unknown) {
    super(`${method} ${path} answered ${status}: ${describe(body)}`);
    this.name = "BunnyApiError";
    this.status = status;
    this.body = body;
  }
}

export type BunnyApi = <T = unknown>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
) => Promise<T>;

/**
 * Calls bunny.net's API with the account's API key. Every deploy creates and
 * deletes zones, scripts and pull zones, which only that key can.
 */
export function createBunnyApi(
  apiKey = process.env.BUNNYNET_API_KEY,
): BunnyApi {
  if (!apiKey) {
    throw new Error(
      "Set BUNNYNET_API_KEY to the API key of the bunny.net account.",
    );
  }

  return async (method, path, body) => {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        AccessKey: apiKey,
        Accept: "application/json",
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

    const text = await response.text();
    const parsed = text ? parseJson(text) : undefined;

    if (!response.ok) {
      throw new BunnyApiError(method, path, response.status, parsed);
    }

    return parsed as never;
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// bunny.net answers errors as `{ ErrorKey, Message }`.
function describe(body: unknown): string {
  if (body && typeof body === "object" && "Message" in body) {
    const { ErrorKey, Message } = body as { ErrorKey?: string; Message: string };
    return ErrorKey ? `${ErrorKey}, ${Message}` : Message;
  }
  return typeof body === "string" && body ? body : "no message";
}
