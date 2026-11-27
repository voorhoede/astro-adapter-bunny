import { RELEASE_FILE } from "./release-file.ts";

/**
 * Waits until a pull zone answers with a release: its release file names the
 * commit. The file is uploaded last and is not a page of the site, so this
 * tells whether the release is live on the URL, not whether the site works. A
 * new pull zone served its first file after about 5 s, and a switched one
 * answered with the new release 2 to 7 s after the switch.
 */
export const waitForRelease = async ({ url, sha }: { url: URL; sha: string }) => {
  const deadline = Date.now() + 120_000;

  await poll({ url: new URL(RELEASE_FILE, url), deadline }, async (response) => {
    if (response.status !== 200) {
      return `answered ${response.status}`;
    }
    const file = (await response.json()) as { commit?: string };
    if (file.commit !== sha) {
      return `serves commit ${file.commit}`;
    }
    return true;
  });
};

const poll = async (
  { url, deadline }: { url: URL; deadline: number },
  accept: (response: Response) => Promise<true | string>,
) => {
  let last = "no answer";

  while (Date.now() < deadline) {
    // A new query string every time keeps each try past the cache.
    const attempt = new URL(url);
    attempt.searchParams.set("check", String(Date.now()));

    try {
      const response = await fetch(attempt, { redirect: "manual" });
      const result = await accept(response);
      if (!response.bodyUsed) {
        await response.body?.cancel();
      }
      if (result === true) {
        return;
      }
      last = result;
    } catch (error) {
      last = String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`${url.href} did not answer with the release in time: ${last}`);
};
