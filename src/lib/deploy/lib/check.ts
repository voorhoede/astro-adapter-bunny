import { RELEASE_FILE } from "./release-file.ts";

/**
 * Waits until a pull zone answers with a release: its release file names the
 * commit, and for a site with a script, `/` answers anything but a server
 * error. A new pull zone served its first file after about 5 s, and a
 * switched one answered with the new release 2 to 7 s after the switch.
 */
export async function waitForRelease(
  url: string,
  { commit, hasScript }: { commit: string; hasScript: boolean },
  { timeout = 120_000 }: { timeout?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeout;

  await poll(`${url}/${RELEASE_FILE}`, deadline, async (response) => {
    if (response.status !== 200) return `answered ${response.status}`;
    const file = (await response.json()) as { commit?: string };
    return file.commit === commit ? true : `serves commit ${file.commit}`;
  });

  if (hasScript) {
    await poll(`${url}/`, deadline, async (response) =>
      response.status < 500 ? true : `answered ${response.status}`,
    );
  }
}

async function poll(
  url: string,
  deadline: number,
  accept: (response: Response) => Promise<true | string>,
): Promise<void> {
  let last = "no answer";

  for (;;) {
    try {
      // A unique query string keeps every try past the cache.
      const response = await fetch(`${url}?check=${Date.now()}`, {
        redirect: "manual",
      });
      const result = await accept(response);
      if (!response.bodyUsed) await response.body?.cancel();
      if (result === true) return;
      last = result;
    } catch (error) {
      last = String(error);
    }

    if (Date.now() > deadline) {
      throw new Error(`${url} did not answer with the release in time: ${last}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
