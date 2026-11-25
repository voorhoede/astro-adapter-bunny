# usage: python3 -I check-manifest.py <project root> <expectation: ssr|static|static-redirects|outdir>
import json, os, sys
root, mode = sys.argv[1], sys.argv[2]
ok = fail = 0
def c(name, cond):
    global ok, fail
    if cond: ok += 1
    else:
        fail += 1; print("FAIL", name)
p = os.path.join(root, ".bunny/build.json")
c("file exists", os.path.isfile(p))
m = json.load(open(p)) if os.path.isfile(p) else {}
pkg = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../package.json")))
astro = json.load(open(os.path.join(root, "node_modules/astro/package.json")))
c("manifestVersion", m.get("manifestVersion") == 1)
c("adapter", m.get("adapter") == {"package": pkg["name"], "version": pkg["version"]})
c("framework", m.get("framework") == {"name": "astro", "version": astro["version"]})
x = m.get("astroAdapterBunny", {})
# The commit is the checkout's, so it is checked for its form and left out of the exact comparisons.
commit = x.pop("commit", None)
c("commit", commit is None or (len(commit) == 40 and all(ch in "0123456789abcdef" for ch in commit)))
if mode == "ssr":
    out = "dist"
    c("kind", m.get("kind") == "ssr")
    s = m.get("script", {})
    c("script entry/type", s.get("entry") == "dist/index.js" and s.get("type") == "middleware")
    c("script bytes", s.get("bytes") == os.path.getsize(os.path.join(root, "dist/index.js")))
    c("pullZone", m.get("requires", {}).get("pullZone") == {"disableCookies": False, "enableSmartCache": False})
    env = m.get("requires", {}).get("env", [])
    c("env secret", {"name": "SECRET_MESSAGE", "reason": "astro:env secret", "secret": True, "optional": True} in env)
    c("env no public", not any(e["name"].startswith("PUBLIC_") for e in env))
    c("dev", m.get("dev") == {"command": "astro dev"})
    c("extras", x == {"base": "/", "trailingSlash": "ignore", "buildFormat": "directory", "assetsDir": "_astro", "redirects": "dist/client/_redirects", "headers": "dist/client/_headers"})
elif mode.startswith("static"):
    out = "dist"
    c("kind", m.get("kind") == "static")
    c("no script", "script" not in m)
    c("no requires", "requires" not in m)
    if mode == "static-redirects": c("redirects", x.get("redirects") == "dist/client/_redirects")
    else: c("no redirects", "redirects" not in x)
elif mode == "outdir":
    out = "build"
    c("entry", m.get("script", {}).get("entry") == "build/index.js")
    c("format", x.get("buildFormat") == "file")
c("assets dir", m.get("assets") == {"dir": f"{out}/client"})
print(f"[manifest {mode}] passed {ok}, failed {fail}")
