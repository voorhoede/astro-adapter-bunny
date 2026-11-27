// POST /compute/script
export type Script = {
  Name: string;
  /** 2 Middleware. A script keeps the type it was created with. */
  ScriptType: 2;
  CreateLinkedPullZone: false;
};

// POST /compute/script/{id}/code
export type ScriptCode = { Code: string };

// PUT /compute/script/{id}/variables
export type ScriptVariable = { Name: string; DefaultValue: string };

// PUT /compute/script/{id}/secrets
export type ScriptSecret = { Name: string; Secret: string };

// What GET and POST /compute/script answer.
export type ScriptResponse = {
  Id: number;
  Name: string;
  ScriptType: 0 | 1 | 2;
};
