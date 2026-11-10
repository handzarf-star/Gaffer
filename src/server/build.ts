import { DEV_BUILD, parseBuildId } from '../shared/build';

interface AssetFetcher { fetch(input: Request | string): Promise<Response> }

let cache: { id: string; at: number } | null = null;

/** The build id of the app this Worker serves, read from the index.html in its own static assets. Cached for a minute. */
export async function currentBuild(assets: AssetFetcher, now = Date.now()): Promise<string> {
  if (cache && now - cache.at < 60_000) return cache.id;
  let id = DEV_BUILD;
  try {
    const res = await assets.fetch(new Request('https://assets.invalid/'));
    if (res.ok) id = parseBuildId(await res.text());
  } catch {
    /* no assets (unit tests, API-only runs): report "dev" */
  }
  cache = { id, at: now };
  return id;
}

export function resetBuildCache(): void { cache = null; }
