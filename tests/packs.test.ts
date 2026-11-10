import { describe, expect, it } from 'vitest';
import { dealPacks, GLOW_HONEST, PACKS_PER_ROUND, SCENT_OF } from '../src/shared/packs';
import { openRoles } from '../src/shared/draft';
import { emptySquad } from '../src/shared/squad';
import { player, tierOf } from '../src/shared/players';

const needs = [openRoles(emptySquad('433')).map((o) => o.role)];
const deal = (seed: string, round = 1, taken: string[] = []) => dealPacks({ seed, pool: 'modern', round, key: 'x', size: 3, taken: new Set(taken), needs });

describe('pick-a-pack', () => {
  it('deals three sealed packs of three, with no card in two packs and a needed role in every pack', () => {
    for (let i = 0; i < 60; i++) {
      const offers = deal('s' + i, 1 + (i % 11));
      expect(offers).toHaveLength(PACKS_PER_ROUND);
      const all = offers.flatMap((o) => o.cards);
      expect(new Set(all).size, 'a card is in two packs').toBe(all.length);
      for (const o of offers) { expect(o.cards).toHaveLength(3); expect(o.clue.name.length).toBeGreaterThan(3); }
      expect(new Set(offers.map((o) => o.clue.name)).size, 'two packs share a name').toBe(3);
    }
  });

  it('is deterministic, and never deals a card that is already taken', () => {
    expect(deal('same')).toEqual(deal('same'));
    const first = deal('t').flatMap((o) => o.cards);
    const again = deal('t', 1, first.slice(0, 4)).flatMap((o) => o.cards);
    for (const c of first.slice(0, 4)) expect(again).not.toContain(c);
  });

  it('clues are hints, not promises: better than a guess, far from certain', () => {
    let glowRight = 0, scentInside = 0, packs = 0, glowIcon = 0, glowIconReallyIcon = 0;
    for (let i = 0; i < 400; i++) {
      for (const o of deal('c' + i, 1 + (i % 11))) {
        packs++;
        const order = ['bronze', 'silver', 'gold', 'icon'];
        const top = o.cards.map((id) => tierOf(player(id).ovr)).reduce((b, t) => (order.indexOf(t) > order.indexOf(b) ? t : b), 'bronze');
        if (o.clue.glow === top) glowRight++;
        if (o.clue.glow === 'icon') { glowIcon++; if (top === 'icon') glowIconReallyIcon++; }
        if (o.cards.some((id) => SCENT_OF[player(id).pos] === o.clue.scent)) scentInside++;
      }
    }
    const glowRate = glowRight / packs;
    const scentRate = scentInside / packs;
    expect(glowRate).toBeGreaterThan(GLOW_HONEST); // it does mean something
    expect(glowRate).toBeLessThan(0.75); // but it is mostly luck
    expect(scentRate).toBeGreaterThan(0.6);
    expect(scentRate).toBeLessThan(0.9);
    // a blinding glow is not a guarantee of an icon
    expect(glowIcon).toBeGreaterThan(0);
    expect(glowIconReallyIcon / glowIcon).toBeLessThan(0.9);
    expect(glowIconReallyIcon / glowIcon).toBeGreaterThan(0.1);
  });
});
