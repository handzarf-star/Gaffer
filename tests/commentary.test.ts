import { describe, expect, it } from 'vitest';
import { commentary } from '../src/shared/i18n/commentary';
import { COMMENTARY_BS, FIXED_BS } from '../src/shared/i18n/commentary.bs';
import { T, simulateMatch } from '../src/shared/sim';
import { PLAYERS } from '../src/shared/players';
import { autoPick } from '../src/shared/draft';
import { emptySquad, type Squad } from '../src/shared/squad';

const ph = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))].sort();
const squadFrom = (offset: number): Squad => {
  let sq = emptySquad('433');
  const ids = PLAYERS.filter((p) => !p.only).slice(offset).map((p) => p.id);
  const taken = new Set<string>();
  for (let r = 0; r < 11; r++) { const pick = autoPick(sq, ids.filter((i) => !taken.has(i)).slice(0, 40)); if (!pick) break; sq = { ...sq, slots: { ...sq.slots, [pick.slotId]: pick.cardId } }; taken.add(pick.cardId); }
  return sq;
};

describe('Bosnian commentary', () => {
  it('has a line for every English template, in the same order', () => {
    for (const [group, list] of Object.entries(T)) {
      const bs = COMMENTARY_BS[group];
      expect(bs, `group ${group}`).toBeDefined();
      expect(bs!.length, `group ${group} length`).toBe((list as readonly string[]).length);
    }
    expect(Object.keys(COMMENTARY_BS).sort()).toEqual(Object.keys(T).sort());
  });
  it('uses only placeholders the English line has, so a name can never be missing or invented', () => {
    for (const [group, list] of Object.entries(T)) {
      (list as readonly string[]).forEach((en, i) => {
        const bs = COMMENTARY_BS[group]![i]!;
        for (const p of ph(bs)) expect(ph(en), `${group}:${i} uses {${p}} which the English line does not`).toContain(p);
        // a placeholder the English line has may be left out (names stay in the nominative), but the player acting must always appear
        if (en.includes('{p}')) expect(bs, `${group}:${i} lost the player`).toContain('{p}');
        if (en.includes('{k}')) expect(bs, `${group}:${i} lost the keeper`).toContain('{k}');
      });
    }
  });
  it('re-renders every event of real matches in Bosnian with no placeholder left over, and English is untouched', () => {
    const a = squadFrom(0), b = squadFrom(300);
    let events = 0;
    for (let i = 0; i < 30; i++) {
      const r = simulateMatch(a, b, ['Alpha', 'Beta'], `bs/${i}`, { knockout: true });
      for (const e of r.events) {
        events++;
        expect(commentary(e, 'en')).toBe(e.text);
        const bs = commentary(e, 'bs');
        expect(bs, `${e.tk}`).not.toMatch(/\{\w+\}/);
        expect(bs.length).toBeGreaterThan(5);
        expect(e.tk, `event "${e.text}" has no template key`).toBeTruthy();
      }
    }
    expect(events).toBeGreaterThan(500);
  });
  it('falls back to the English text for an unknown key', () => {
    expect(commentary({ text: 'Hello', tk: 'nope:3', tv: {} }, 'bs')).toBe('Hello');
    expect(commentary({ text: 'Hello' }, 'bs')).toBe('Hello');
  });
  it('has every fixed line', () => {
    for (const k of ['kickoff', 'half', 'full', 'et', 'etend', 'shootout', 'pen_goal', 'pen_miss']) expect(FIXED_BS[k], k).toBeTruthy();
  });
});
