import { describe, expect, it } from 'vitest';
import { NATIONS } from '../src/shared/nations';
import { PLAYERS, shortName, tierOf } from '../src/shared/players';
import { poolPlayers } from '../src/shared/pools';

describe('player database', () => {
  it('has enough players and unique ids', () => {
    expect(PLAYERS.length).toBeGreaterThan(500);
    expect(new Set(PLAYERS.map((p) => p.id)).size).toBe(PLAYERS.length);
  });
  it('every nation code is known and ratings are sane', () => {
    for (const p of PLAYERS) {
      expect(NATIONS[p.nat], `${p.name} -> ${p.nat}`).toBeTruthy();
      expect(p.ovr).toBeGreaterThanOrEqual(60);
      expect(p.ovr).toBeLessThanOrEqual(99);
    }
  });
  it('each pool can fill a squad with depth at every position', () => {
    for (const pool of ['modern', 'legends', 'all'] as const) {
      const ps = poolPlayers(pool);
      for (const pos of ['GK', 'LB', 'CB', 'RB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST'] as const) {
        expect(ps.filter((p) => p.pos === pos).length, `${pool}:${pos}`).toBeGreaterThanOrEqual(12);
      }
    }
  });
  it('tiers cover the range', () => {
    expect(tierOf(99)).toBe('icon');
    expect(tierOf(88)).toBe('gold');
    expect(tierOf(82)).toBe('silver');
    expect(tierOf(70)).toBe('bronze');
  });
  it('short names', () => {
    expect(shortName('Trent Alexander-Arnold')).toBe('Alexander-Arnold');
    expect(shortName('Kevin De Bruyne')).toBe('De Bruyne');
    expect(shortName('Virgil van Dijk')).toBe('van Dijk');
    expect(shortName('Neymar')).toBe('Neymar');
    expect(shortName('Marc-Andre ter Stegen')).toBe('ter Stegen');
    expect(shortName('Jairzinho Jr')).toBe('Jairzinho Jr');
  });
});
