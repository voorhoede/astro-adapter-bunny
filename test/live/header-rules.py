# usage: python3 -I header-rules.py <pull zone id> <_headers file>
# Turns _headers into edge rules the way the deploy specification describes.
import collections, json, os, subprocess, sys
pz, path = sys.argv[1], sys.argv[2]
pages, current = collections.defaultdict(dict), None
for line in open(path):
    if line.startswith("/"): current = line.strip()
    elif line.strip() and current:
        name, value = line.strip().split(":", 1); pages[current][name.strip()] = value.strip()
by_header = collections.defaultdict(lambda: collections.defaultdict(list))
for page, headers in pages.items():
    for name, value in headers.items(): by_header[name][value].append(page)
def pattern(p): return "pattern:^https?://[^/]+" + p.rstrip("/").replace("-", "%-").replace(".", "%.").replace("*", ".*") + "/?$"
def post(body):
    r = subprocess.run(["perl", "-e", "alarm 60; exec @ARGV", "bunny", "--profile", os.environ.get("BUNNY_PROFILE") or "default", "api", "POST", f"/pullzone/{pz}/edgerules/addOrUpdate", "--body", json.dumps(body)], capture_output=True, text=True)
    if r.returncode: print("rule failed", (r.stdout + r.stderr)[:200])
for name, values in by_header.items():
    missing = {"Type": 2, "Parameter1": name, "PatternMatches": ["*"], "PatternMatchingType": 2}
    ordered = sorted(values.items(), key=lambda kv: -len(kv[1]))
    default, others = ordered[0][0], ordered[1:]
    exceptions = [pattern(p) for _, ps in others for p in ps]
    triggers = [missing] + ([{"Type": 0, "PatternMatches": exceptions[i:i+5], "PatternMatchingType": 2} for i in range(0, len(exceptions), 5)])
    post({"Description": f"aab-live-header {name} default", "Enabled": True, "ActionType": 5, "ActionParameter1": name, "ActionParameter2": default, "TriggerMatchingType": 1, "Triggers": triggers})
    for i, (value, ps) in enumerate(others):
        post({"Description": f"aab-live-header {name} {i}", "Enabled": True, "ActionType": 5, "ActionParameter1": name, "ActionParameter2": value, "TriggerMatchingType": 1,
              "Triggers": [missing, {"Type": 0, "PatternMatches": [pattern(p) for p in ps], "PatternMatchingType": 0}]})
