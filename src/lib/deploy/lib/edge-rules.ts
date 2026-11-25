// Turns a build into bunny.net edge rules, as docs/deploy.md describes under
// "Static sites", "Trailing slash", "Redirects" and "Headers". Pure functions:
// the pull zone module applies what they return.

export type EdgeRule = {
  Description: string;
  Enabled: true;
  ActionType: number;
  ActionParameter1?: string;
  ActionParameter2?: string;
  TriggerMatchingType: number;
  Triggers: Trigger[];
};

type Trigger = {
  Type: number;
  Parameter1?: string;
  PatternMatches: string[];
  PatternMatchingType: number;
};

/** Every rule the tool makes starts with this, so it replaces its own rules and leaves the site owner's alone. */
export const RULE_PREFIX = "astro-adapter-bunny: ";

const ACTION = { redirect: 1, setResponseHeader: 5 } as const;
const MATCH = { any: 0, all: 1, none: 2 } as const;
const TRIGGER = { url: 0, responseHeader: 2 } as const;
// A trigger takes at most this many patterns.
const PATTERNS_PER_TRIGGER = 5;

export type RuleInput = {
  hasScript: boolean;
  base: string;
  assetsDir: string;
  trailingSlash: "always" | "never" | "ignore";
  redirects: string;
  headers: string;
  /** Stored paths without an extension, such as `CNAME`, which a trailing slash redirect has to skip. */
  filesWithoutExtension: string[];
};

/** The rules a pull zone needs for a build, and what could not become a rule. */
export function edgeRules(input: RuleInput): {
  rules: EdgeRule[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const rules = [
    // A site with a script answers its redirects, trailing slashes and caching itself, and answers a POST with 308 where a rule answers 301.
    ...(input.hasScript
      ? []
      : [
          assetCacheRule(input),
          ...trailingSlashRules(input),
          ...redirectRules(input.redirects, warnings),
        ]),
    ...headerRules(input.headers),
  ];

  return { rules, warnings };
}

function assetCacheRule({ base, assetsDir }: RuleInput): EdgeRule {
  const folder = `${base.replace(/\/$/, "")}/${assetsDir}`;
  return {
    Description: `${RULE_PREFIX}cache ${folder}`,
    Enabled: true,
    ActionType: ACTION.setResponseHeader,
    ActionParameter1: "Cache-Control",
    ActionParameter2: "public, max-age=31536000, immutable",
    TriggerMatchingType: MATCH.any,
    Triggers: [urlTrigger([`*${folder}/*`], MATCH.any)],
  };
}

// Only 'always': a rule for 'never' looped on a URL with a query string.
function trailingSlashRules({
  trailingSlash,
  filesWithoutExtension,
  base,
}: RuleInput): EdgeRule[] {
  if (trailingSlash !== "always") return [];

  const prefix = base.replace(/\/$/, "");
  const skip = [
    "pattern:^https?://.*/[^/]+%.%w+$",
    ...filesWithoutExtension.map((file) => anchored(`${prefix}/${file}`)),
  ];

  return [
    {
      Description: `${RULE_PREFIX}trailing slash`,
      Enabled: true,
      ActionType: ACTION.redirect,
      ActionParameter1:
        "https://%{Url.Hostname}%{Url.Directory}%{Url.FileName}/",
      ActionParameter2: "301",
      TriggerMatchingType: MATCH.all,
      Triggers: [
        urlTrigger(["pattern:^https?://[^/]+/.*[^/]$"], MATCH.any),
        ...chunks(skip).map((patterns) => urlTrigger(patterns, MATCH.none)),
      ],
    },
  ];
}

function redirectRules(file: string, warnings: string[]): EdgeRule[] {
  return lines(file).flatMap((line) => {
    const [source, target, status = "301"] = line.split(/\s+/);
    if (!source || !target) return [];

    const segments = source.split("/").filter(Boolean);
    if (segments.some((segment) => /.:|^:.*[^\w]/.test(segment))) {
      warnings.push(
        `Redirect "${line}" has a parameter that is not a whole path segment, which an edge rule cannot fill in.`,
      );
      return [];
    }

    return [
      {
        Description: `${RULE_PREFIX}redirect ${source}`,
        Enabled: true,
        ActionType: ACTION.redirect,
        ActionParameter1: redirectTarget(target, segments),
        // bunny.net answers 301 for a rule set to 308, and 302 for 307.
        ActionParameter2: { "308": "301", "307": "302" }[status] ?? status,
        TriggerMatchingType: MATCH.any,
        Triggers: [urlTrigger([anchored(source)], MATCH.any)],
      },
    ];
  });
}

function redirectTarget(target: string, sourceSegments: string[]): string {
  if (/^https?:\/\//.test(target)) return target;

  const index = (name: string) =>
    sourceSegments.findIndex((segment) => segment === name);
  const path = target
    .replace(/:splat\b/g, () => `%{Path.${index("*")}-}`)
    .replace(/:(\w+)/g, (match, name: string) => {
      const at = index(`:${name}`);
      return at === -1 ? match : `%{Path.${at}}`;
    });

  return `https://%{Url.Hostname}${path}`;
}

/**
 * One group per header name: the most common value in one rule for every URL
 * that has no other value, and a rule per other value. Each rule only sets the
 * header when the response has none, so a route's own header stays.
 */
function headerRules(file: string): EdgeRule[] {
  const byHeader = new Map<string, Map<string, string[]>>();
  let path: string | undefined;

  for (const line of lines(file)) {
    if (line.startsWith("/")) {
      path = line;
      continue;
    }
    const colon = line.indexOf(":");
    if (!path || colon === -1) continue;

    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    const values = byHeader.get(name) ?? new Map<string, string[]>();
    values.set(value, [...(values.get(value) ?? []), path]);
    byHeader.set(name, values);
  }

  return [...byHeader].flatMap(([name, values]) => {
    const [[common], ...others] = [...values].sort(
      (a, b) => b[1].length - a[1].length,
    ) as [[string, string[]], ...[string, string[]][]];
    const missing: Trigger = {
      Type: TRIGGER.responseHeader,
      Parameter1: name,
      PatternMatches: ["*"],
      PatternMatchingType: MATCH.none,
    };
    const exceptions = others.flatMap(([, paths]) => paths.map(anchored));

    return [
      {
        Description: `${RULE_PREFIX}header ${name}`,
        Enabled: true as const,
        ActionType: ACTION.setResponseHeader,
        ActionParameter1: name,
        ActionParameter2: common,
        TriggerMatchingType: MATCH.all,
        Triggers: [
          missing,
          ...chunks(exceptions).map((patterns) =>
            urlTrigger(patterns, MATCH.none),
          ),
        ],
      },
      ...others.flatMap(([value, paths], index) =>
        chunks(paths.map(anchored)).map((patterns, part) => ({
          Description: `${RULE_PREFIX}header ${name} ${index + 1}.${part + 1}`,
          Enabled: true as const,
          ActionType: ACTION.setResponseHeader,
          ActionParameter1: name,
          ActionParameter2: value,
          TriggerMatchingType: MATCH.all,
          Triggers: [missing, urlTrigger(patterns, MATCH.any)],
        })),
      ),
    ];
  });
}

/**
 * A Lua pattern for exactly this path, with or without a trailing slash. A
 * plain wildcard such as `*\/old` also matched `/x/old`.
 */
function anchored(path: string): string {
  const pattern = path
    .replace(/\/$/, "")
    .replace(/[-.+?()[\]%^$]/g, "%$&")
    .replace(/(^|\/):\w+/g, "$1[^/]+")
    .replace(/\*/g, ".*");
  return `pattern:^https?://[^/]+${pattern}/?$`;
}

function urlTrigger(patterns: string[], matching: number): Trigger {
  return {
    Type: TRIGGER.url,
    PatternMatches: patterns,
    PatternMatchingType: matching,
  };
}

function chunks(items: string[]): string[][] {
  const result: string[][] = [];
  for (let i = 0; i < items.length; i += PATTERNS_PER_TRIGGER) {
    result.push(items.slice(i, i + PATTERNS_PER_TRIGGER));
  }
  return result;
}

function lines(file: string): string[] {
  return file
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}
