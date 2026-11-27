import { warning } from "@actions/core";
import { existsSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { RULE_PREFIX } from "../../shared/bunny/edge-rules.ts";
import type { EdgeRule, Trigger } from "../../shared/bunny/types/edgerule.ts";
import type { BuildManifest } from "./manifest.ts";

/**
 * The edge rules a build needs, as docs/deploy.md describes them: header
 * rules from `_headers` for every site, and for a static site also asset
 * caching, the trailing slash and the redirects from `_redirects`. A site with
 * a script answers those itself, and answers a POST with 308 where a rule
 * answers 301.
 */
export const buildEdgeRules = ({ manifest, files }: { manifest: BuildManifest; files: string[] }) => {
  const { redirects, headers, base, assetsDir, trailingSlash } = manifest.astroAdapterBunny;
  const rules: EdgeRule[] = [...headerRules(read(headers))];

  if (!manifest.script) {
    rules.push(assetCacheRule(posix.join(base, assetsDir)));
    // Only 'always': a rule for 'never' redirected a URL with a query string to itself, a loop.
    if (trailingSlash === "always") {
      rules.push(trailingSlashRule({ base, files }));
    }
    rules.push(...redirectRules(read(redirects)));
  }

  // The order decides which header rule wins where two match; see headerRules.
  return rules.map((rule, index): EdgeRule => ({ ...rule, OrderIndex: index }));
};

const read = (path?: string) => {
  if (!path || !existsSync(path)) {
    return "";
  }
  return readFileSync(path, "utf8");
};

const lines = (file: string) =>
  file
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

const urlTrigger = (patterns: string[], matching: 0 | 2): Trigger => ({
  Type: 0,
  PatternMatches: patterns,
  PatternMatchingType: matching,
});

// A trigger takes at most 5 patterns.
const chunks = (items: string[]) => {
  const result: string[][] = [];
  for (let i = 0; i < items.length; i += 5) {
    result.push(items.slice(i, i + 5));
  }
  return result;
};

// A Lua pattern for exactly this path, with or without a trailing slash. A plain *\/old also matched /x/old.
const anchored = (path: string) => {
  const pattern = path
    .replace(/\/$/, "")
    .replace(/[-.+?()[\]%^$]/g, "%$&")
    .replace(/(^|\/):\w+/g, "$1[^/]+")
    .replace(/\*/g, ".*");
  return `pattern:^https?://[^/]+${pattern}/?$`;
};

const assetCacheRule = (folder: string): EdgeRule => ({
  Description: `${RULE_PREFIX}cache ${folder}`,
  Enabled: true,
  ActionType: 5,
  ActionParameter1: "Cache-Control",
  ActionParameter2: "public, max-age=31536000, immutable",
  TriggerMatchingType: 0,
  Triggers: [urlTrigger([`*${folder}/*`], 0)],
});

const trailingSlashRule = ({ base, files }: { base: string; files: string[] }): EdgeRule => {
  // A path that ends in a file with an extension, such as /favicon.svg, keeps its form.
  const skip = ["pattern:^https?://.*/[^/]+%.%w+$"];
  // So does a stored file without one, such as /CNAME, which would otherwise redirect to a path that does not exist.
  for (const file of files) {
    if (!/\.[^/]+$/.test(file) && file !== "_redirects" && file !== "_headers") {
      skip.push(anchored(posix.join(base, file)));
    }
  }

  return {
    Description: `${RULE_PREFIX}trailing slash`,
    Enabled: true,
    ActionType: 1,
    // The query string is lost: every path variable bunny.net has already contains it.
    ActionParameter1: "https://%{Url.Hostname}%{Url.Directory}%{Url.FileName}/",
    ActionParameter2: "301",
    TriggerMatchingType: 1,
    Triggers: [
      urlTrigger(["pattern:^https?://[^/]+/.*[^/]$"], 0),
      ...chunks(skip).map((patterns) => urlTrigger(patterns, 2)),
    ],
  };
};

const redirectRules = (file: string) => {
  const rules: EdgeRule[] = [];

  for (const line of lines(file)) {
    const [source, target, status = "301"] = line.split(/\s+/);
    if (!source || !target) {
      continue;
    }

    const segments = source.split("/").filter(Boolean);
    // %{Path.N} fills in a whole segment, so /old-:id cannot become an edge rule.
    if (segments.some((segment) => /.:|^:.*\W/.test(segment))) {
      warning(`Redirect "${line}" has a parameter that is not a whole path segment, so it gets no edge rule.`);
      continue;
    }

    rules.push({
      Description: `${RULE_PREFIX}redirect ${source}`,
      Enabled: true,
      ActionType: 1,
      ActionParameter1: redirectTarget(segments, target),
      // bunny.net answers 301 for a rule set to 308, and 302 for 307.
      ActionParameter2: { "308": "301", "307": "302" }[status] ?? status,
      TriggerMatchingType: 0,
      Triggers: [urlTrigger([anchored(source)], 0)],
    });
  }

  return rules;
};

// :param becomes %{Path.N} and :splat becomes %{Path.N-}, N being that segment's index in the source.
const redirectTarget = (segments: string[], target: string) => {
  if (/^https?:\/\//.test(target)) {
    return target;
  }

  const path = target
    .replace(/:splat\b/g, () => `%{Path.${segments.indexOf("*")}-}`)
    .replace(/:(\w+)/g, (match, name: string) => {
      const index = segments.indexOf(`:${name}`);
      if (index === -1) {
        return match;
      }
      return `%{Path.${index}}`;
    });

  return `https://%{Url.Hostname}${path}`;
};

/**
 * Per header: one rule with the value for every URL, which is the value of
 * `/*` when the file has it, else the most common; then a rule per other value
 * and kind of path. Each only sets the header when the response from the
 * origin has none, so a route's own header stays.
 *
 * Where two rules match one URL, the one with the higher OrderIndex wins
 * (measured on 2026-11-27), so the rules are ordered from general to specific:
 * the value for every URL, then wildcard paths, shortest first, then exact
 * paths. That needs no list of exceptions, which would run into bunny.net's
 * limit of 5 triggers per rule.
 */
const headerRules = (file: string) => {
  const byHeader = new Map<string, Map<string, string[]>>();
  let path: string | undefined;

  for (const line of lines(file)) {
    if (line.startsWith("/")) {
      path = line;
      continue;
    }
    const colon = line.indexOf(":");
    if (!path || colon === -1) {
      continue;
    }
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    const values = byHeader.get(name) ?? new Map<string, string[]>();
    values.set(value, [...(values.get(value) ?? []), path]);
    byHeader.set(name, values);
  }

  const everywhere: EdgeRule[] = [];
  const specific: { rule: EdgeRule; rank: number }[] = [];

  for (const [name, values] of byHeader) {
    const sorted = [...values].sort((a, b) => b[1].length - a[1].length);
    const first = sorted.find(([, paths]) => paths.includes("/*")) ?? sorted[0];
    if (!first) {
      continue;
    }
    const missing: Trigger = { Type: 2, Parameter1: name, PatternMatches: ["*"], PatternMatchingType: 2 };
    const rule = (description: string, value: string, triggers: Trigger[]): EdgeRule => ({
      Description: `${RULE_PREFIX}header ${description}`,
      Enabled: true,
      ActionType: 5,
      ActionParameter1: name,
      ActionParameter2: value,
      TriggerMatchingType: 1,
      Triggers: [missing, ...triggers],
    });

    everywhere.push(rule(name, first[0], []));

    sorted
      .filter((entry) => entry !== first)
      .forEach(([value, paths], index) => {
        const wildcards = paths.filter((path) => path.includes("*"));
        const exact = paths.filter((path) => !path.includes("*"));
        // A longer wildcard is narrower, so it ranks after a shorter one; exact paths rank after every wildcard.
        const groups = [
          ...wildcards.map((path) => ({ paths: [path], rank: path.length })),
          ...chunks(exact).map((group) => ({ paths: group, rank: Infinity })),
        ];
        groups.forEach((group, part) => {
          specific.push({
            rule: rule(`${name} ${index + 1}.${part + 1}`, value, [urlTrigger(group.paths.map(anchored), 0)]),
            rank: group.rank,
          });
        });
      });
  }

  return [...everywhere, ...specific.sort((a, b) => a.rank - b.rank).map(({ rule }) => rule)];
};
