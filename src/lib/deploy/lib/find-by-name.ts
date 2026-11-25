import type { BunnyApi } from "./bunny-api.ts";

type Named = { Id: number; Name: string };

/**
 * Finds a storage zone, script or pull zone by its exact name. Search matches
 * parts of names, and some lists answer a page with `Items` while others answer
 * an array, so both are handled here.
 */
export async function findByName<T extends Named>(
  api: BunnyApi,
  path: "/storagezone" | "/compute/script" | "/pullzone",
  name: string,
): Promise<T | undefined> {
  for (let page = 1; ; page++) {
    const result = await api<T[] | { Items: T[]; HasMoreItems: boolean }>(
      "GET",
      `${path}?search=${encodeURIComponent(name)}&page=${page}&perPage=1000`,
    );
    const items = Array.isArray(result) ? result : result.Items;
    const found = items.find((item) => item.Name === name);

    if (found) return found;
    if (Array.isArray(result) || !result.HasMoreItems) return undefined;
  }
}
