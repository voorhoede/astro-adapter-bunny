// POST /storagezone
export type StorageZone = {
  Name: string;
  /** Main region, such as DE. Cannot change after creation. */
  Region: string;
  ReplicationRegions?: string[];
  /** 0 Standard, 1 Edge (SSD). Cannot change after creation. */
  ZoneTier?: 0 | 1;
};

// POST /storagezone/{id}
export type StorageZoneUpdate = {
  /** The page storage answers for a missing path, such as `/404.html`; empty for bunny.net's own. */
  Custom404FilePath?: string;
  Rewrite404To200?: boolean;
};

// What GET and POST /storagezone answer.
export type StorageZoneResponse = {
  Id: number;
  Name: string;
  /** The AccessKey for uploads to this zone. */
  Password: string;
  /** Where uploads go: https://{StorageHostname}/{Name}/{path}. */
  StorageHostname: string;
  /** When the zone last changed, such as by an upload. */
  DateModified: string;
};
