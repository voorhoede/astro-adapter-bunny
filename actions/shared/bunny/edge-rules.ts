import { posix } from "node:path";
import { request } from "./request.ts";
import type { EdgeRule } from "./types/edgerule.ts";
import type { PullZoneResponse } from "./types/pullzone.ts";

/** Every rule an action makes starts with this, so it replaces only its own rules. */
export const RULE_PREFIX = "astro-adapter-bunny: ";

const rulesPath = (pullZoneId: number) => posix.join("pullzone", String(pullZoneId), "edgerules");

/**
 * Makes the actions' rules on a pull zone match `rules`. A rule with the same
 * description is updated in place, so a header never goes missing in between;
 * then the actions' rules the build no longer has are deleted. A rule without
 * the prefix belongs to the site owner, and a read-only rule cannot change.
 */
export const applyEdgeRules = async ({ pullZoneId, rules }: { pullZoneId: number; rules: EdgeRule[] }) => {
  const pullZone = await request<PullZoneResponse>("GET", posix.join("pullzone", String(pullZoneId)));
  const ours = pullZone.EdgeRules.filter(
    (rule) => rule.Description.startsWith(RULE_PREFIX) && !rule.ReadOnly,
  );

  for (const rule of rules) {
    const existing = ours.find((current) => current.Description === rule.Description);
    let body = rule;
    if (existing) {
      body = { ...rule, Guid: existing.Guid };
    }
    await request("POST", posix.join(rulesPath(pullZoneId), "addOrUpdate"), { body });
  }

  const wanted = new Set(rules.map((rule) => rule.Description));
  for (const rule of ours) {
    if (!wanted.has(rule.Description)) {
      await request("DELETE", posix.join(rulesPath(pullZoneId), rule.Guid));
    }
  }
};

/**
 * The actions' rules on a pull zone, without the fields bunny.net adds, so a
 * rollback can give a pull zone the rules of a release's own build.
 */
export const readEdgeRules = async ({ pullZoneId }: { pullZoneId: number }) => {
  const pullZone = await request<PullZoneResponse>("GET", posix.join("pullzone", String(pullZoneId)));

  const rules: EdgeRule[] = [];
  for (const rule of pullZone.EdgeRules) {
    if (!rule.Description.startsWith(RULE_PREFIX)) {
      continue;
    }
    rules.push({
      Description: rule.Description,
      Enabled: rule.Enabled,
      OrderIndex: rule.OrderIndex,
      ActionType: rule.ActionType,
      ActionParameter1: rule.ActionParameter1,
      ActionParameter2: rule.ActionParameter2,
      TriggerMatchingType: rule.TriggerMatchingType,
      Triggers: rule.Triggers.map((trigger) => ({
        Type: trigger.Type,
        Parameter1: trigger.Parameter1,
        PatternMatches: trigger.PatternMatches,
        PatternMatchingType: trigger.PatternMatchingType,
      })),
    });
  }
  return rules;
};
