import { posix } from "node:path";
import { request, requestList } from "./request.ts";
import type { StorageZone, StorageZoneResponse, StorageZoneUpdate } from "./types/storagezone.ts";

export const getStorageZone = async ({ name }: { name: string }) => {
  const zones = await listStorageZones({ search: name });
  return zones.find((zone) => zone.Name === name);
};

export const listStorageZones = ({ search }: { search: string }) =>
  requestList<StorageZoneResponse>("storagezone", { search });

export const createStorageZone = (zone: StorageZone) =>
  request<StorageZoneResponse>("POST", "storagezone", { body: zone });

export const updateStorageZone = ({ id, ...settings }: StorageZoneUpdate & { id: number }) =>
  request("POST", posix.join("storagezone", String(id)), { body: settings });

export const deleteStorageZone = ({ id }: { id: number }) =>
  request("DELETE", posix.join("storagezone", String(id)));

/**
 * Writes one file to a zone, trying again while a new zone still refuses
 * uploads. Uploads go to the zone's storage host with its password, not to
 * api.bunny.net with the API key.
 */
export const uploadFile = async ({
  storageZone,
  path,
  body,
}: {
  storageZone: StorageZoneResponse;
  path: string;
  body: Uint8Array;
}) => {
  const url = new URL(`https://${storageZone.StorageHostname}`);
  // The URL encodes spaces, # and ? in the path; a % in a file name it leaves as it is.
  url.pathname = posix.join(storageZone.Name, path);

  // A new zone refused uploads for 1 to 5 s after it was made.
  for (let attempt = 1; attempt <= 8; attempt++) {
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        AccessKey: storageZone.Password,
        "Content-Type": "application/octet-stream",
      },
      body,
    });

    if (response.ok) {
      return;
    }

    if (attempt === 8) {
      throw new Error(`Uploading ${path} answered ${response.status}: ${await response.text()}`);
    }

    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
  }
};

/** Reads one file of a zone, or undefined when the zone has none at that path. */
export const getFile = async ({ storageZone, path }: { storageZone: StorageZoneResponse; path: string }) => {
  const url = new URL(`https://${storageZone.StorageHostname}`);
  url.pathname = posix.join(storageZone.Name, path);

  const response = await fetch(url, { headers: { AccessKey: storageZone.Password } });
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`Reading ${path} answered ${response.status}.`);
  }
  return response.text();
};
