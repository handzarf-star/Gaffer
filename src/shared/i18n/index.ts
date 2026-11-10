// Translation core. English text is the key: t('Create a room'). Another language supplies a dictionary of English -> its own text.
// A missing entry falls back to English (never a blank or a key code), and tests/i18n.test.ts fails the build if a string that the
// code wraps in t() / tn() has no Bosnian entry, so the Bosnian version cannot silently rot.
//
//   t('Round {n} of {total}', { n: 3, total: 11 })
//   tn('{n} injured', '{n} injured', count)        // English: one / other.  Bosnian (see bs.ts): one / few / other, per CLDR
//
// Placeholders are {name}. Values are inserted as text, never as markup.

export type Lang = 'en' | 'bs';
export const LANGS: Record<Lang, { name: string; native: string; tag: string }> = {
  en: { name: 'English', native: 'English', tag: 'en' },
  bs: { name: 'Bosnian', native: 'Bosanski', tag: 'bs' },
};
export const LANG_IDS = Object.keys(LANGS) as Lang[];
export const DEFAULT_LANG: Lang = 'en';

export type Vars = Record<string, string | number>;
/** English key -> text, or for plurals English "one" form -> [one, few, other] */
export type Dict = Record<string, string | readonly [string, string, string]>;

const dicts: Partial<Record<Lang, Dict>> = {};
export function registerDict(lang: Lang, d: Dict): void {
  dicts[lang] = { ...(dicts[lang] ?? {}), ...d };
}
export function dictOf(lang: Lang): Dict {
  return dicts[lang] ?? {};
}

export function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function isLang(x: unknown): x is Lang {
  return typeof x === 'string' && (LANG_IDS as string[]).includes(x);
}

/** Pick the language from a stored choice or the browser's list of preferred languages. */
export function detectLang(stored: string | null | undefined, navigatorLanguages: readonly string[] = []): Lang {
  if (isLang(stored)) return stored;
  for (const l of navigatorLanguages) {
    const base = l.toLowerCase().split('-')[0];
    if (base === 'bs') return 'bs';
    if (base === 'en') return 'en';
  }
  return DEFAULT_LANG;
}

export function translate(lang: Lang, key: string, vars?: Vars): string {
  const hit = lang === 'en' ? undefined : dicts[lang]?.[key];
  const text = typeof hit === 'string' ? hit : key;
  return interpolate(text, vars);
}

const rules = new Map<Lang, Intl.PluralRules>();
/** 0 = one, 1 = few, 2 = other (the Bosnian split: 1, 21 | 2-4, 22-24 | 0, 5-20, 25-30 ...) */
export function pluralIndex(lang: Lang, n: number): 0 | 1 | 2 {
  if (lang === 'en') return n === 1 ? 0 : 2;
  let r = rules.get(lang);
  if (!r) { r = new Intl.PluralRules(LANGS[lang].tag); rules.set(lang, r); }
  const c = r.select(n);
  return c === 'one' ? 0 : c === 'few' ? 1 : 2;
}

export function translatePlural(lang: Lang, one: string, other: string, n: number, vars?: Vars): string {
  const merged: Vars = { n, ...(vars ?? {}) };
  if (lang === 'en') return interpolate(n === 1 ? one : other, merged);
  const hit = dicts[lang]?.[one];
  if (Array.isArray(hit)) return interpolate(hit[pluralIndex(lang, n)]!, merged);
  return interpolate(n === 1 ? one : other, merged);
}

export type TFn = (key: string, vars?: Vars) => string;
export type TnFn = (one: string, other: string, n: number, vars?: Vars) => string;

export function makeT(lang: Lang): { t: TFn; tn: TnFn } {
  return { t: (k, v) => translate(lang, k, v), tn: (o, ot, n, v) => translatePlural(lang, o, ot, n, v) };
}
