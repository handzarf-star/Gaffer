import { describe, expect, it } from 'vitest';
import { buildBotSquad } from '../src/shared/bots';
import { getWorld } from '../src/shared/career/data';
import { dealBoard, openRoles } from '../src/shared/draft';
import { dealPacks } from '../src/shared/packs';
import { PLAYERS, STAR_BANDS, player, slug, tierOf } from '../src/shared/players';
import { LOBBY_POOLS, POOL_IDS, eraCounts, nationCounts, parsePoolKey, poolBands, poolHasStars, poolHealth, poolKey, poolPlayers } from '../src/shared/pools';
import { emptySquad, squadPlayerIds } from '../src/shared/squad';

const W = getWorld();

describe('the Balkan League as a draft pool', () => {
  it('is the first pool the lobby offers and holds the sourced squads, every one known to the match engine', () => {
    expect(LOBBY_POOLS[0]).toBe('bl');
    expect(POOL_IDS[0]).toBe('bl');
    const list = poolPlayers('bl');
    expect(list.length).toBe(W.players.length);
    expect(list.length).toBeGreaterThan(900);
    for (const p of list.slice(0, 50)) expect(player(p.id).name).toBe(p.name);
    expect(new Set(list.map((p) => p.id)).size).toBe(list.length);
  });
  it('is deep enough for a league of 12 on its own, in every line', () => {
    for (const teams of [4, 8, 12]) expect(poolHealth('bl', teams), `${teams} teams`).toMatchObject({ ok: true });
  });
  it('deals playable packs and a full CPU squad from it', () => {
    const sq = emptySquad('433');
    const offers = dealPacks({ seed: 'bl1', pool: 'bl', round: 1, key: 'x', size: 3, taken: new Set(), needs: [openRoles(sq).map((o) => o.role)] });
    expect(offers).toHaveLength(3);
    for (const o of offers) { expect(o.cards).toHaveLength(3); for (const id of o.cards) expect(id.startsWith('k-')).toBe(true); }
    const bot = buildBotSquad('bl-seed', 'bl', 'normal', new Set(), 'cpu1');
    expect(squadPlayerIds(bot)).toHaveLength(11);
    expect(squadPlayerIds(bot).every((id) => id.startsWith('k-'))).toBe(true);
  });
});

describe('cards are graded against the mix they come from', () => {
  it('star pools keep the fixed thresholds, so nothing about the existing pools moves', () => {
    for (const k of ['modern', 'legends', 'all', 'epl', 'balkan', 'bl+all', 'epl@90s']) expect(poolBands(k), k).toBe(STAR_BANDS);
    expect(poolHasStars('bl')).toBe(false);
    expect(poolHasStars('bl+epl')).toBe(true);
  });
  it('a league-only pool has all four tiers in sensible shares (on the stars\' thresholds every card would be bronze)', () => {
    const list = poolPlayers('bl');
    expect(list.every((p) => tierOf(p.ovr) === 'bronze')).toBe(true);
    const bands = poolBands('bl');
    const share = (t: string) => list.filter((p) => tierOf(p.ovr, bands) === t).length / list.length;
    expect(share('icon')).toBeGreaterThan(0.015); expect(share('icon')).toBeLessThan(0.06);
    expect(share('gold')).toBeGreaterThan(0.12); expect(share('gold')).toBeLessThan(0.24);
    expect(share('silver')).toBeGreaterThan(0.3); expect(share('silver')).toBeLessThan(0.5);
    expect(share('bronze')).toBeGreaterThan(0.3);
    expect(bands[0]).toBeLessThan(bands[1]); expect(bands[1]).toBeLessThan(bands[2]);
  });
  it('and the deal uses those grades: a Balkan League draft shows gold and icon cards, not only bronze', () => {
    const bands = poolBands('bl');
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) for (const id of dealBoard({ seed: `t${i}`, pool: 'bl', round: 1 + (i % 11), key: 'k', size: 3, taken: new Set(), needs: [['ST']] })) seen.add(tierOf(player(id).ovr, bands));
    expect([...seen].sort()).toEqual(['bronze', 'gold', 'icon', 'silver']);
  });
});

describe('several pools at once, and countries', () => {
  it('a key carries pools, eras and countries, in a canonical order', () => {
    expect(poolKey(['all', 'bl'], ['now'], ['SRB', 'BIH'])).toBe('bl+all@now#BIH,SRB');
    expect(parsePoolKey('bl+all@now#BIH,SRB')).toEqual({ pool: 'bl', pools: ['bl', 'all'], eras: ['now'], nations: ['BIH', 'SRB'] });
    expect(poolKey('modern')).toBe('modern'); // single pools keep their old key
    expect(poolKey(['epl'], ['90s', '00s'])).toBe('epl@90s,00s');
    expect(poolKey([], [], ['bih', '<x>', 'CRO'])).toBe('all#CRO');
  });
  it('the union holds every player of both, and a footballer who is in both appears once (the star entry)', () => {
    // the hand-rated Balkan extras are the ones who also sit in the sourced squads (Orsic, Livaja ...)
    const both = poolPlayers('bl+balkan');
    const ids = new Set(both.map((p) => p.id));
    expect(ids.size).toBe(both.length);
    const stars = poolPlayers('balkan');
    const doubles = W.players.filter((p) => stars.some((s) => s.id === slug(p.name)));
    expect(doubles.length).toBeGreaterThan(5);
    for (const d of doubles) { expect(ids.has(slug(d.name)), d.name).toBe(true); expect(ids.has(d.id), d.name).toBe(false); }
    expect(both.length).toBe(stars.length + W.players.length - doubles.length);
    // on its own the league keeps them, and a mix without that star entry keeps the league entry
    expect(poolPlayers('bl').some((p) => p.id === doubles[0]!.id)).toBe(true);
    expect(poolPlayers('bl+all').some((p) => p.id === doubles[0]!.id)).toBe(true);
    expect(poolPlayers('bl+all').length).toBe(poolPlayers('all').length + W.players.length);
  });
  it('a country filter narrows any mix, and counts tell the lobby what is there', () => {
    const bih = poolPlayers(poolKey(['bl', 'all'], [], ['BIH']));
    expect(bih.length).toBeGreaterThan(100);
    expect(bih.every((p) => p.nat === 'BIH')).toBe(true);
    const counts = nationCounts(['bl']);
    expect(counts[0]![0]).toBe('SRB');
    expect(counts.reduce((a, [, n]) => a + n, 0)).toBe(W.players.length);
    expect(nationCounts(['all'], ['now']).reduce((a, [, n]) => a + n, 0)).toBe(PLAYERS.filter((p) => !p.only && p.era === 'M').length);
    expect(eraCounts(['bl']).now).toBe(W.players.length);
    expect(eraCounts(['bl', 'all'], ['BIH']).now).toBe(poolPlayers(poolKey(['bl', 'all'], ['now'], ['BIH'])).length);
  });
  it('legends stay out of a league pool and the era filter still works on a mix', () => {
    expect(poolPlayers('bl@90s')).toHaveLength(0);
    const mix = poolPlayers('bl+all@90s');
    expect(mix.length).toBeGreaterThan(20);
    expect(mix.every((p) => p.era === 'L')).toBe(true);
  });
});
