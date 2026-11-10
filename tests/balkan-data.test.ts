import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

// Guards the sourced Balkan squad dataset (data/derived/merged.json). The rule: every fact traces to a fetched source.
type Row = {
  club: string; name: string; no: number | null; pos: string | null; nat: string | null; section: string;
  born: string | null; bornPrecision: string | null; wikidata: { qid: string; modified: string | null; url: string } | null; identity: string;
};
type Club = { name: string; source: { site: string; title: string; revid: number; revisionAt: string; fetchedAt: string; url: string }; players: Row[] };
const data = JSON.parse(fs.readFileSync(new URL('../data/derived/merged.json', import.meta.url), 'utf8')) as { clubs: Record<string, Club> };
const clubs = Object.entries(data.clubs);

describe('Balkan squad data (sourced)', () => {
  it('covers the sixteen planned clubs, six of them the ones the game must have', () => {
    expect(clubs).toHaveLength(16);
    for (const id of ['crvena-zvezda', 'partizan', 'dinamo-zagreb', 'hajduk', 'zeljeznicar', 'sarajevo']) expect(data.clubs[id], id).toBeDefined();
  });

  it.each(clubs)('%s: carries a pinned Wikipedia revision and a retrieval date', (_id, c) => {
    expect(c.source.site).toBe('en.wikipedia.org');
    expect(Number.isInteger(c.source.revid) && c.source.revid > 0).toBe(true);
    expect(c.source.url).toContain(`oldid=${c.source.revid}`);
    expect(Date.parse(c.source.fetchedAt)).toBeGreaterThan(0);
  });

  it.each(clubs)('%s: a playable squad (enough players, enough keepers, no duplicates)', (_id, c) => {
    const squad = c.players.filter((p) => p.section === 'squad');
    expect(squad.length).toBeGreaterThanOrEqual(22);
    expect(squad.filter((p) => p.pos === 'GK').length).toBeGreaterThanOrEqual(2);
    expect(squad.filter((p) => p.pos === 'DF').length).toBeGreaterThanOrEqual(5);
    expect(squad.filter((p) => p.pos === 'MF').length).toBeGreaterThanOrEqual(5);
    // Wikipedia files wide forwards under MF (Red Star lists just two FW), so the floor is low on purpose
    expect(squad.filter((p) => p.pos === 'FW').length).toBeGreaterThanOrEqual(2);
    const keys = squad.map((p) => `${p.name}|${p.no}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every date of birth comes with a Wikidata item that supplied it, and is plausible', () => {
    const year = new Date().getFullYear();
    for (const [, c] of clubs) for (const p of c.players) {
      if (!p.born) continue;
      expect(p.wikidata, `${p.name} has a birth date but no source item`).not.toBeNull();
      expect(p.wikidata!.qid).toMatch(/^Q\d+$/);
      expect(p.bornPrecision === 'day' ? /^\d{4}-\d{2}-\d{2}$/.test(p.born) : /^\d{4}$/.test(p.born)).toBe(true);
      const age = year - Number(p.born.slice(0, 4));
      expect(age, `${p.name} born ${p.born}`).toBeGreaterThanOrEqual(15);
      expect(age, `${p.name} born ${p.born}`).toBeLessThanOrEqual(45);
    }
  });

  it('players without a verified identity carry no Wikidata facts at all', () => {
    for (const [, c] of clubs) for (const p of c.players) if (!p.wikidata) { expect(p.born, p.name).toBeNull(); expect(['no-match', 'ambiguous', 'link-unresolved']).toContain(p.identity); }
  });

  it('only known position and nationality codes are present', () => {
    for (const [, c] of clubs) for (const p of c.players) { expect(['GK', 'DF', 'MF', 'FW'], p.name).toContain(p.pos); expect(p.nat, p.name).toMatch(/^[A-Z]{3}$/); }
  });
});
