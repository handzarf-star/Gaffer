// Shared helpers for the squad-data pipeline. Rules this pipeline lives by:
//   1. A fact enters the dataset only if a fetched source says it; each row carries that source (url, revision, date).
//   2. Nothing is written from memory. A gap stays a gap and is reported.
//   3. Be a polite client: identify ourselves, go one request at a time, obey Retry-After, cache every response on disk.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
export const RAW = path.join(ROOT, 'data', 'raw');
// A descriptive agent without personal details (Wikimedia asks for a real tool name; contact info is optional for low volume).
export const UA = 'GafferDataBuilder/1.0 (hobby football game; non-commercial; read-only, low volume)';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const keyOf = (url) => crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);

/**
 * GET a URL with retries. 429/503 wait for Retry-After (plus a little), anything else non-2xx fails loudly.
 * The body is cached under data/raw/<label>-<hash>.<ext> so re-runs hit the network only for what is missing;
 * pass { fresh: true } to refetch. Returns { body, status, fetchedAt, fromCache, file }.
 */
export async function get(url, { label = 'get', ext = 'json', accept, fresh = false, tries = 14 } = {}) {
  fs.mkdirSync(RAW, { recursive: true });
  const file = path.join(RAW, `${label}-${keyOf(url)}.${ext}`);
  const meta = `${file}.meta.json`;
  if (!fresh && fs.existsSync(file) && fs.existsSync(meta)) {
    return { body: fs.readFileSync(file, 'utf8'), status: 200, fetchedAt: JSON.parse(fs.readFileSync(meta, 'utf8')).fetchedAt, fromCache: true, file };
  }
  let lastNote = '';
  for (let i = 1; i <= tries; i++) {
    let res;
    try {
      res = await fetch(url, { headers: { 'user-agent': UA, ...(accept ? { accept } : {}) }, signal: AbortSignal.timeout(60_000) });
    } catch (e) {
      lastNote = `network: ${e.cause?.code || e.message}`;
      await sleep(Math.min(30_000, 2_000 * i));
      continue;
    }
    if (res.ok) {
      const body = await res.text();
      // MediaWiki answers throttling with plain text; never cache that as data
      if (/too many requests/i.test(body.slice(0, 200))) { lastNote = 'throttled (200 body)'; await sleep(8_000); continue; }
      const fetchedAt = new Date().toISOString();
      fs.writeFileSync(file, body);
      fs.writeFileSync(meta, JSON.stringify({ url, fetchedAt, status: res.status }, null, 2));
      return { body, status: res.status, fetchedAt, fromCache: false, file };
    }
    if (res.status === 429 || res.status === 503) {
      const ra = Number(res.headers.get('retry-after'));
      const wait = (Number.isFinite(ra) && ra > 0 ? ra : 5 * i) * 1000 + 600;
      lastNote = `HTTP ${res.status}, retry-after ${res.headers.get('retry-after')}`;
      await sleep(Math.min(wait, 90_000));
      continue;
    }
    throw new Error(`GET ${url} -> HTTP ${res.status}`);
  }
  throw new Error(`GET ${url} failed after ${tries} tries (${lastNote})`);
}

export const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
