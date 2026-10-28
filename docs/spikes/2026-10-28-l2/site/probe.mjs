import { readSiteConfig } from '<bunny-edge-deploy>/src/static-site/parse.js';
import { analyzeSiteConfig, siteRules } from '<bunny-edge-deploy>/src/static-site/rules.js';
const config = await readSiteConfig('.');
console.log('parsed headers', JSON.stringify(config.headers));
console.log('parsed redirects', JSON.stringify(config.redirects));
console.log('analysis', JSON.stringify(analyzeSiteConfig(config)));
try {
  const rules = siteRules({ storageZone: 'zone', deployId: 'abc', files: ['index.html', 'robots.txt'], ...config });
  console.log('rules', rules.length);
  for (const r of rules) console.log('-', r.Description ?? '', 'action', r.ActionType, JSON.stringify(r.ActionParameter1 ?? '').slice(0, 80), JSON.stringify((r.Triggers ?? []).map((t) => t.PatternMatches)).slice(0, 120));
} catch (e) { console.log('siteRules threw:', e.message); }
