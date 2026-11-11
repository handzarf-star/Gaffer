import { describe, expect, it } from 'vitest';
import { dealPacks, GLOW_HONEST, PACKS_PER_ROUND, SCENT_OF } from '../src/shared/packs';
import { openRoles } from '../src/shared/draft';
import { emptySquad } from '../src/shared/squad';
import { player, tierOf } from '../src/shared/players';
import { poolPlayers } from '../src/shared/pools';

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

describe('a pool that runs dry', () => {
  const ids = poolPlayers('modern').map((p) => p.id);
  /** only the first `left` players of a shuffled-by-seed pool are still available */
  const dealWith = (left: number, seed: string, wanted: typeof needs = needs) =>
    dealPacks({ seed, pool: 'modern', round: 1 + (left % 11), key: 'x', size: 3, taken: new Set(ids.slice(left)), needs: wanted });

  it('degrades from 12 cards to 1 to 0 without throwing: fewer packs, never an empty one, never a repeated or taken card', () => {
    for (let left = 12; left >= 0; left--) {
      for (let i = 0; i < 25; i++) {
        const free = new Set(ids.slice(0, left));
        const offers = dealWith(left, `dry${i}`);
        const cards = offers.flatMap((o) => o.cards);
        expect(offers.length, `left=${left}`).toBe(Math.min(PACKS_PER_ROUND, Math.ceil(left / 3)));
        for (const o of offers) {
          expect(o.cards.length, `left=${left}: an empty pack`).toBeGreaterThanOrEqual(1);
          expect(o.clue.name).toBeTruthy();
          expect(['goals', 'grit', 'engine', 'gloves']).toContain(o.clue.scent);
          expect(['bronze', 'silver', 'gold', 'icon']).toContain(o.clue.glow);
        }
        expect(new Set(cards).size, `left=${left}: a card is in two packs`).toBe(cards.length);
        for (const c of cards) expect(free.has(c), `left=${left}: dealt a card that is not available`).toBe(true);
        // every card that is still there and fits in three packs of three is dealt
        expect(cards.length).toBe(Math.min(left, PACKS_PER_ROUND * 3));
      }
    }
  });
  it('one card left: one pack holding it', () => {
    const offers = dealWith(1, 'last');
    expect(offers).toHaveLength(1);
    expect(offers[0]!.cards).toEqual([ids[0]]);
  });
  it('nothing left at all: no packs, not an exception', () => {
    expect(dealWith(0, 'none')).toEqual([]);
  });
  it('still copes when the seat needs a role that no remaining card can fill, or needs nothing', () => {
    const gkOnly = [['GK' as const]] as unknown as typeof needs; // asks for a keeper from a pool that may have none left
    for (let left = 6; left >= 1; left--) {
      expect(() => dealWith(left, 'role', gkOnly)).not.toThrow();
      expect(dealWith(left, 'role', gkOnly).length).toBeGreaterThanOrEqual(1);
      expect(dealWith(left, 'none-needed', [[]]).length).toBeGreaterThanOrEqual(1);
      expect(dealWith(left, 'no-seats', []).length).toBeGreaterThanOrEqual(1);
    }
  });
  it('is deterministic when thin too', () => {
    expect(dealWith(5, 'same')).toEqual(dealWith(5, 'same'));
  });
});
