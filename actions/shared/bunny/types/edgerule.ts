// POST /pullzone/{pullZoneId}/edgerules/addOrUpdate
export type EdgeRule = {
  /** An existing rule's Guid updates it; without one a rule is added. */
  Guid?: string;
  /** 1 Redirect, 5 Set Response Header. */
  ActionType: 1 | 5;
  /** Redirect: the target URL. Set Response Header: the header name. */
  ActionParameter1: string;
  /** Redirect: the status code. Set Response Header: the value. */
  ActionParameter2?: string;
  /** 0 Match Any, 1 Match All, 2 Match None. */
  TriggerMatchingType: 0 | 1 | 2;
  Triggers: Trigger[];
  Description: string;
  Enabled: boolean;
  /** Where two rules set the same header on one URL, the higher one wins. */
  OrderIndex?: number;
};

export type Trigger = {
  /** 0 URL, 2 Response Header. */
  Type: 0 | 2;
  /** Response Header: the header name. */
  Parameter1?: string;
  /** At most 5 per trigger. */
  PatternMatches: string[];
  /** 0 Match Any, 1 Match All, 2 Match None. */
  PatternMatchingType: 0 | 1 | 2;
};

// A rule as GET /pullzone/{id} answers it in EdgeRules.
export type EdgeRuleResponse = EdgeRule & {
  Guid: string;
  /** A read-only rule cannot be changed or deleted. */
  ReadOnly: boolean;
};
