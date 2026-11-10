import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { buildIdFromFiles } from '../scripts/build-id.mjs';
import { BUILD_META, DEV_BUILD, isStale, parseBuildId } from '../src/shared/build';
import { currentBuild, resetBuildCache } from '../src/server/build';
import { parseMessage } from '../src/server/schema';

describe('build id helpers', () => {
  it('reads the id from the tag Vite writes, and is "dev" when there is none', () => {
    expect(parseBuildId(`<html><head><meta name="${BUILD_META}" content="a1b2c3d4e5" /></head></html>`)).toBe('a1b2c3d4e5');
    expect(parseBuildId('<html><head></head></html>')).toBe(DEV_BUILD);
    expect(parseBuildId('<meta name="gaffer-build" content="x y">')).toBe(DEV_BUILD); // not a plausible id: ignore it
  });

  it('calls a client out of date only when both builds are known and differ', () => {
    expect(isStale('aaaaaaaaaa', 'bbbbbbbbbb')).toBe(true);
    expect(isStale('aaaaaaaaaa', 'aaaaaaaaaa')).toBe(false);
    expect(isStale('dev', 'bbbbbbbbbb')).toBe(false);
    expect(isStale('aaaaaaaaaa', 'dev')).toBe(false);
    expect(isStale('aaaaaaaaaa', null)).toBe(false);
    expect(isStale('aaaaaaaaaa', undefined)).toBe(false);
    expect(isStale('aaaaaaaaaa', '')).toBe(false);
  });

  it('derives the id from asset names: stable, order-independent, and different when any file changes', () => {
    const a = buildIdFromFiles(['assets/index-ABC.js', 'assets/index-DEF.css']);
    expect(a).toMatch(/^[0-9a-f]{10}$/);
    expect(buildIdFromFiles(['assets/index-DEF.css', 'assets/index-ABC.js'])).toBe(a);
    expect(buildIdFromFiles(['assets/index-ABC.js', 'assets/index-XYZ.css'])).not.toBe(a);
  });
});

describe('the server reads its own build id', () => {
  it('from the index.html in its assets, caches it, and falls back to "dev" when assets are missing or broken', async () => {
    resetBuildCache();
    let calls = 0;
    const assets = { fetch: async () => { calls++; return new Response(`<head><meta name="gaffer-build" content="0123456789"></head>`); } };
    expect(await currentBuild(assets, 1_000)).toBe('0123456789');
    expect(await currentBuild(assets, 30_000)).toBe('0123456789');
    expect(calls).toBe(1);
    expect(await currentBuild(assets, 70_000)).toBe('0123456789');
    expect(calls).toBe(2);
    resetBuildCache();
    expect(await currentBuild({ fetch: async () => { throw new Error('no assets'); } })).toBe(DEV_BUILD);
    resetBuildCache();
    expect(await currentBuild({ fetch: async () => new Response('nope', { status: 404 }) })).toBe(DEV_BUILD);
    resetBuildCache();
  });
});

describe('the wire accepts and keeps the build id', () => {
  it('lets a hello carry the client build, and still rejects an absurd one', () => {
    const base = { t: 'hello', code: 'ABCD', name: 'Sam' };
    expect(parseMessage(JSON.stringify({ ...base, build: 'a1b2c3d4e5' }))).toEqual({ ...base, build: 'a1b2c3d4e5' });
    expect(parseMessage(JSON.stringify(base))).toEqual(base); // an older client without it still works
    expect(parseMessage(JSON.stringify({ ...base, build: 'x'.repeat(200) }))).toBeNull();
  });
});

describe('a real Vite build stamps index.html', () => {
  it('writes a build id that equals the hash of the emitted asset names', async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gaffer-build-'));
    try {
      await build({ logLevel: 'silent', build: { outDir: out, emptyOutDir: true } });
      const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
      const id = parseBuildId(html);
      expect(id).toMatch(/^[0-9a-f]{10}$/);
      const files = fs.readdirSync(path.join(out, 'assets')).map((f) => `assets/${f}`);
      // fonts are emitted too; the plugin hashes every asset, so the same listing must give the same id
      expect(buildIdFromFiles(files)).toBe(id);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  }, 60_000);
});
