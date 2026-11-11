// Which build of the app is this? Vite writes <meta name="gaffer-build" content="..."> into index.html (an id derived from the hashed asset
// names, so it changes exactly when any shipped file changes). The server reads the same tag from the index.html it serves, so client and
// server agree on the id without any generated source file. A client whose id differs from the server's is out of date.

export const BUILD_META = 'gaffer-build';
/** Local development and unbuilt trees: never reported as out of date. */
export const DEV_BUILD = 'dev';

const META = new RegExp(`<meta\\s+name=["']${BUILD_META}["']\\s+content=["']([A-Za-z0-9._-]{1,40})["']`, 'i');

export function parseBuildId(html: string): string {
  return META.exec(html)?.[1] ?? DEV_BUILD;
}

/** True only when both sides know their build and the two differ. */
export function isStale(mine: string, server: string | null | undefined): boolean {
  if (!server || server === DEV_BUILD || mine === DEV_BUILD) return false;
  return mine !== server;
}
