import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectLang, dictOf, interpolate, pluralIndex, registerDict, translate, translatePlural } from '../src/shared/i18n';
import '../src/shared/i18n/bs';

describe('i18n core', () => {
  it('interpolates and leaves unknown placeholders visible instead of blank', () => {
    expect(interpolate('Round {n} of {total}', { n: 3, total: 11 })).toBe('Round 3 of 11');
    expect(interpolate('Hi {who}', {})).toBe('Hi {who}');
  });
  it('English is the key and the fallback', () => {
    expect(translate('en', 'Create a room')).toBe('Create a room');
    expect(translate('bs', 'A string nobody translated {n}', { n: 2 })).toBe('A string nobody translated 2');
  });
  it('Bosnian has three plural forms, per CLDR: 1,21 | 2-4,22-24 | everything else', () => {
    const form = (n: number) => pluralIndex('bs', n);
    expect([1, 21, 31, 101].map(form)).toEqual([0, 0, 0, 0]);
    expect([2, 3, 4, 22, 23, 24, 102].map(form)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect([0, 5, 11, 12, 13, 14, 15, 20, 25, 30, 111, 112].map(form)).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
  });
  it('picks the right plural text', () => {
    registerDict('bs', { '{n} test goal': ['{n} gol', '{n} gola', '{n} golova'] });
    const f = (n: number) => translatePlural('bs', '{n} test goal', '{n} test goals', n);
    expect([1, 2, 5, 21, 22, 25].map(f)).toEqual(['1 gol', '2 gola', '5 golova', '21 gol', '22 gola', '25 golova']);
    expect(translatePlural('en', '{n} test goal', '{n} test goals', 1)).toBe('1 test goal');
    expect(translatePlural('en', '{n} test goal', '{n} test goals', 3)).toBe('3 test goals');
  });
  it('chooses a language from a stored choice, then the browser list, then English', () => {
    expect(detectLang('bs', ['en-GB'])).toBe('bs');
    expect(detectLang(null, ['fr-FR', 'bs-BA'])).toBe('bs');
    expect(detectLang('xx', ['de'])).toBe('en');
  });
});

// Every string the code passes to t() / tn() must have a Bosnian entry. Strings are found by scanning the source, so a new
// t('...') without a translation fails here instead of showing English to a Bosnian player.
function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.(ts|tsx)$/.test(e.name) && !/[\\/]i18n[\\/]/.test(p) ? [p] : [];
  });
}
const STR = String.raw`'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"`;
const unq = (s: string) => s.replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n');

describe('Bosnian coverage', () => {
  const src = files(path.join(__dirname, '..', 'src'));
  const keys = new Set<string>();
  const plurals = new Set<string>();
  for (const f of src) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(new RegExp(String.raw`\bt\(\s*(?:${STR})`, 'g'))) keys.add(unq(m[1] ?? m[2] ?? ''));
    for (const m of text.matchAll(new RegExp(String.raw`\btn\(\s*(?:${STR})\s*,\s*(?:${STR})`, 'g'))) plurals.add(unq(m[1] ?? m[2] ?? ''));
  }
  const bs = dictOf('bs');
  it('finds the strings it is supposed to check (the scan is not silently empty)', () => {
    expect(keys.size).toBeGreaterThan(0);
  });
  it('has a Bosnian entry for every t() string', () => {
    const missing = [...keys].filter((k) => !(k in bs));
    expect(missing, `untranslated:\n${missing.join('\n')}`).toEqual([]);
  });
  it('has three Bosnian forms for every tn() string', () => {
    for (const k of plurals) {
      const v = bs[k];
      expect(Array.isArray(v) && v.length === 3, `plural "${k}"`).toBe(true);
    }
  });
  it('keeps every {placeholder} of the English text in the Bosnian text', () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    for (const [k, v] of Object.entries(bs)) {
      const vs = typeof v === 'string' ? [v] : [...v];
      for (const x of vs) expect(ph(x).replace(/(^|,)n(?=,|$)/, ''), `"${k}"`).toBe(ph(k).replace(/(^|,)n(?=,|$)/, ''));
    }
  });
  it('has no leftover English keys that the code no longer uses (dictionary stays honest)', () => {
    // data such as the brand tagline is translated through t(variable), so a key also counts as used if its exact text is a string in the source
    const literals = new Set<string>();
    for (const f of src) for (const m of fs.readFileSync(f, 'utf8').matchAll(new RegExp(STR, 'g'))) literals.add(unq(m[1] ?? m[2] ?? ''));
    const used = new Set([...keys, ...plurals, ...literals]);
    const dead = Object.keys(bs).filter((k) => !used.has(k) && !k.startsWith('@'));
    expect(dead.slice(0, 5), 'unused dictionary entries (first 5)').toEqual([]);
  });
});
