import { getInput } from "@actions/core";

const HOST = new URL("https://api.bunny.net/");

type Method = "GET" | "POST" | "PUT" | "DELETE";

export class BunnyError extends Error {
  readonly status: number;
  readonly key: string | undefined;

  constructor(status: number, key: string | undefined, message: string) {
    super(message);
    this.name = "BunnyError";
    this.status = status;
    this.key = key;
  }
}

/**
 * Calls bunny.net's API with the action's `bunny_api_key`. Paths have no
 * leading slash, such as `pullzone/123`.
 */
export const request = async <T = undefined>(
  method: Method,
  path: string,
  { body, search }: { body?: unknown; search?: Record<string, string> } = {},
): Promise<T> => {
  const url = new URL(path, HOST);
  for (const [name, value] of Object.entries(search ?? {})) {
    url.searchParams.set(name, value);
  }

  const send = () =>
    fetch(url, {
      method,
      headers: {
        AccessKey: getInput("bunny_api_key", { required: true }),
        Accept: "application/json",
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

  // bunny.net answers 429 when calls come quickly; wait and try again a few times.
  let response = await send();
  for (let attempt = 1; response.status === 429 && attempt <= 5; attempt++) {
    const seconds = Number(response.headers.get("retry-after")) || attempt;
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    response = await send();
  }

  // A DELETE, or adding an edge rule, answers without a body.
  const text = await response.text();
  const data = text ? parseJson(text) : undefined;

  if (!response.ok) {
    const error = data as { ErrorKey?: string; Message?: string } | undefined;
    throw new BunnyError(
      response.status,
      error?.ErrorKey,
      `${method} ${path} answered ${response.status}: ${error?.Message ?? text}`,
    );
  }

  return data as T;
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/**
 * Lists every item of a bunny.net list. Some lists answer a plain array, others
 * a page with `Items` and `HasMoreItems`, depending on the endpoint and query.
 */
export const requestList = async <T>(path: string, search: Record<string, string>): Promise<T[]> => {
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const result = await request<T[] | { Items: T[]; HasMoreItems: boolean }>("GET", path, {
      search: { ...search, page: String(page), perPage: "1000" },
    });
    if (Array.isArray(result)) {
      return result;
    }
    items.push(...result.Items);
    if (!result.HasMoreItems) {
      return items;
    }
  }
};
