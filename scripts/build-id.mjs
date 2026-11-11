// The build id: a short hash of the (content-hashed) asset file names of a build. Used by the Vite plugin and by its test.
import crypto from 'node:crypto';

export function buildIdFromFiles(files) {
  const h = crypto.createHash('sha256');
  for (const f of [...files].sort()) h.update(`${f}\n`);
  return h.digest('hex').slice(0, 10);
}
