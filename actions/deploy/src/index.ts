import { getInput, getMultilineInput, info, setFailed, setOutput, setSecret } from "@actions/core";
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { configurePullZone, createPullZone, getPullZone } from "../../shared/bunny/pull-zone.ts";
import { createScript, getScript, publishScript } from "../../shared/bunny/script.ts";
import { createStorageZone, getStorageZone, updateStorageZone } from "../../shared/bunny/storage-zone.ts";
import { branchName, branchPullZoneName, commitSha, pullZoneUrl, releaseName } from "../../shared/github/names.ts";
import { uploadReleaseFile } from "../../shared/releases/release-file.ts";
import { switchPullZone } from "../../shared/releases/switch-pull-zone.ts";
import { waitForRelease } from "../../shared/releases/wait-for-release.ts";
import { loadConfig } from "../../shared/config.ts";
import { buildEdgeRules } from "./build-edge-rules.ts";
import { checkSecrets } from "./check-secrets.ts";
import { readManifest } from "./manifest.ts";
import { parseLines } from "./parse-lines.ts";
import { listFiles, uploadFiles } from "./upload-files.ts";

try {
  // The site's folder, with its build and bunny.config.ts, such as one site of several in a repository.
  process.chdir(getInput("working_directory") || ".");

  const manifest = readManifest();
  const secrets = parseLines(getMultilineInput("secrets"));
  const variables = parseLines(getMultilineInput("variables"));
  // Masked in the log before anything could print them, also an error message from bunny.net.
  for (const value of Object.values(secrets)) {
    setSecret(value);
  }
  checkSecrets({ manifest, secrets });

  const config = await loadConfig();
  const sha = commitSha();
  const name = releaseName();
  const clientDir = manifest.assets.dir;
  const hasScript = manifest.script !== undefined;
  const rules = buildEdgeRules({ manifest, files: await listFiles(clientDir) });

  // 1. Storage zone and script at the same time: neither needs the other. Each is found first, so a deploy that failed halfway can run again.
  const [storageZone, script] = await Promise.all([
    (async () => {
      const zone = await getStorageZone({ name });
      if (zone) {
        return zone;
      }
      return createStorageZone({
        Name: name,
        Region: config.storage.region,
        ZoneTier: config.storage.tier,
        ReplicationRegions: config.storage.replicationRegions,
      });
    })(),
    (async () => {
      if (!hasScript) {
        return undefined;
      }
      const existing = await getScript({ name });
      if (existing) {
        return existing;
      }
      return createScript({ name });
    })(),
  ]);
  setSecret(storageZone.Password);

  // 2. The release's pull zone needs both; the upload and the script go alongside it.
  await Promise.all([
    (async () => {
      let pullZone = await getPullZone({ name });
      if (!pullZone) {
        pullZone = await createPullZone({ name, storageZoneId: storageZone.Id });
      }
      // Always, also for a pull zone an earlier run made: that run may have stopped before this step.
      await configurePullZone({
        id: pullZone.Id,
        name,
        storageZoneId: storageZone.Id,
        scriptId: script?.Id,
        rules,
        settings: config.pullZone,
      });
    })(),
    (async () => {
      const { base } = manifest.astroAdapterBunny;
      await uploadFiles({ storageZone, dir: clientDir, base });
      if (existsSync(join(clientDir, "404.html"))) {
        await updateStorageZone({
          id: storageZone.Id,
          Custom404FilePath: posix.join("/", base, "404.html"),
          Rewrite404To200: false,
        });
      }
      // Last, so a pull zone that answers with it has every other file.
      await uploadReleaseFile({ storageZone, release: name, sha });
    })(),
    (async () => {
      if (!script || !manifest.script) {
        return;
      }
      await publishScript({
        id: script.Id,
        code: readFileSync(manifest.script.entry, "utf8"),
        variables,
        secrets,
      });
    })(),
  ]);

  // 3. The release answers on its own URL before the visitors of its branch get it.
  const releaseUrl = pullZoneUrl(name);
  await waitForRelease({ url: releaseUrl, release: name });
  info(`Release URL: ${releaseUrl.href}`);
  setOutput("release", name);
  setOutput("release_url", releaseUrl.href);

  // 4. Then the branch's pull zone moves to it, and goes back when it does not answer with it.
  const branchUrl = await switchPullZone({
    name: branchPullZoneName(branchName()),
    release: name,
    storageZoneId: storageZone.Id,
    scriptId: script?.Id,
    rules,
    settings: config.pullZone,
  });
  info(`Branch URL: ${branchUrl.href}`);
  setOutput("branch_url", branchUrl.href);
} catch (error) {
  setFailed(error instanceof Error ? error.message : String(error));
}
