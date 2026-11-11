import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

// The Content-Security-Policy we ship (public/_headers). Google sign-in needs a few narrowly scoped allowances; everything else must stay tight.
const headers = fs.readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
const block = (path: string): string[] => {
  const lines = headers.split('\n');
  const i = lines.findIndex((l) => l.trim() === path);
  const out: string[] = [];
  for (let k = i + 1; k < lines.length && /^\s+\S/.test(lines[k]!); k++) out.push(lines[k]!.trim());
  return out;
};
const csp = (block('/*').find((l) => l.startsWith('Content-Security-Policy:')) ?? '').replace('Content-Security-Policy:', '').trim();
const directives = new Map(csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const [name, ...vals] = d.split(/\s+/); return [name!, vals] as const; }));
const allows = (dir: string, src: string) => (directives.get(dir) ?? directives.get('default-src') ?? []).includes(src);

describe('Content-Security-Policy (public/_headers)', () => {
  it('is present on every path', () => { expect(csp.length).toBeGreaterThan(50); });

  it("lets Google's sign-in script, frame, requests and styles load, and only those paths", () => {
    expect(allows('script-src', "'self'")).toBe(true);
    expect(allows('script-src', 'https://accounts.google.com/gsi/client')).toBe(true);
    expect(allows('frame-src', 'https://accounts.google.com/gsi/')).toBe(true);
    expect(allows('connect-src', 'https://accounts.google.com/gsi/')).toBe(true);
    expect(allows('style-src', 'https://accounts.google.com/gsi/style')).toBe(true);
  });

  it('keeps the game working: same-origin sockets and API, own fonts and images', () => {
    expect(allows('connect-src', "'self'")).toBe(true);
    expect(allows('connect-src', 'ws:')).toBe(true);
    expect(allows('connect-src', 'wss:')).toBe(true);
    expect(allows('font-src', "'self'")).toBe(true);
    expect(allows('img-src', 'data:')).toBe(true);
  });

  it('did not get looser anywhere else', () => {
    for (const [name, vals] of directives) {
      for (const v of vals) {
        expect(v, `${name} allows a wildcard`).not.toBe('*');
        expect(v, `${name} allows every https origin`).not.toBe('https:');
        if (name === 'script-src') { expect(v).not.toBe("'unsafe-inline'"); expect(v).not.toBe("'unsafe-eval'"); }
        if (v.startsWith('https://')) expect(v, `${name}: only Google's sign-in paths may be named`).toMatch(/^https:\/\/accounts\.google\.com\/gsi\//);
      }
    }
    expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
    expect(directives.get('base-uri')).toEqual(["'self'"]);
    expect(directives.get('form-action')).toEqual(["'self'"]);
    expect(directives.get('default-src')).toEqual(["'self'"]);
  });

  it('keeps hashed assets cacheable forever', () => {
    expect(block('/assets/*').join(' ')).toContain('immutable');
  });
});
