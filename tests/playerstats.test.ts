import { describe, expect, it } from 'vitest';
import { PLAYER_BY_ID, PLAYERS } from '../src/shared/players';
import { TRAIT_OVERRIDE_KEYS, YELLOW_PER_90, traits } from '../src/shared/playerstats';

describe('player traits (cards, penalties, set pieces)', () => {
  it('every override refers to a real player id (a typo would silently do nothing)', () => {
    const bad = TRAIT_OVERRIDE_KEYS.filter((k) => !PLAYER_BY_ID.has(k));
    expect(bad).toEqual([]);
  });
  it('known tendencies come through', () => {
    expect(traits('sergio-ramos').disc).toBeGreaterThan(traits('philipp-lahm').disc * 3);
    expect(traits('robert-lewandowski').pk).toBeGreaterThan(0.9);
    expect(traits('juninho-pernambucano').fk).toBeGreaterThan(0.95);
    expect(traits('emiliano-martinez').pks).toBeGreaterThan(traits('thibaut-courtois').pks);
  });
  it('everyone else falls back to their position average and stays in range', () => {
    for (const p of PLAYERS) {
      const t = traits(p);
      expect(t.disc).toBeGreaterThan(0);
      expect(t.disc).toBeLessThanOrEqual(3);
      for (const v of [t.pk, t.fk, t.pks]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    // keepers rarely take penalties or free kicks
    expect(traits('manuel-neuer').pk).toBeLessThan(0.1);
  });
  it('position baselines add up to a real-world card rate (~1.9 yellows per team per game)', () => {
    const xi = YELLOW_PER_90.GK + 2 * YELLOW_PER_90.CB + YELLOW_PER_90.LB + YELLOW_PER_90.RB + YELLOW_PER_90.CDM + 2 * YELLOW_PER_90.CM + 2 * YELLOW_PER_90.LW + YELLOW_PER_90.ST;
    expect(xi).toBeGreaterThan(1.6);
    expect(xi).toBeLessThan(2.3);
  });
});
