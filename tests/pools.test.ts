import { describe, expect, it } from 'vitest';
import { PLAYER_BY_ID, PLAYERS, slug } from '../src/shared/players';
import { BALKAN_NATS, DATA_CHECK, ERA_IDS, eraCounts, eraOf, hasDecade, inPremierLeague, parsePoolKey, poolHealth, poolKey, poolPlayers } from '../src/shared/pools';
import { RoomEngine, testDeps } from '../src/shared/room';
import { parseMessage } from '../src/server/schema';

const names = (key: string) => new Set(poolPlayers(key).map((p) => p.name));

describe('the player tags (recollection, checked for typos)', () => {
  it('every tagged name is a real player', () => {
    for (const id of DATA_CHECK.decadeIds) expect(PLAYER_BY_ID.has(id), `decade list: unknown player "${id}"`).toBe(true);
    for (const id of DATA_CHECK.plIds) expect(PLAYER_BY_ID.has(id), `Premier League list: unknown player "${id}"`).toBe(true);
    expect(new Set(DATA_CHECK.plIds).size, 'a Premier League name is listed twice').toBe(DATA_CHECK.plIds.length);
  });
  it('every retired player has a decade and nobody has two', () => {
    for (const p of PLAYERS) if (p.era === 'L' && !p.only) expect(hasDecade(p.id), `no decade for ${p.name}`).toBe(true);
    expect(new Set(DATA_CHECK.decadeIds).size).toBe(DATA_CHECK.decadeIds.length);
    expect(DATA_CHECK.decadeIds.length).toBe(PLAYERS.filter((p) => p.era === 'L' && !p.only).length);
  });
  it('the three original pools did not change when the new ones arrived', () => {
    expect(poolPlayers('modern').length).toBe(PLAYERS.filter((p) => p.era === 'M' && !p.only).length);
    expect(poolPlayers('legends').length).toBe(PLAYERS.filter((p) => p.era === 'L').length);
    expect(poolPlayers('all').length).toBe(PLAYERS.filter((p) => !p.only).length);
    for (const key of ['modern', 'legends', 'all']) expect(poolPlayers(key).some((p) => p.only)).toBe(false);
  });
});

describe('pools and eras', () => {
  it('the Premier League pool holds people who played there and not those who never did', () => {
    const epl = names('epl');
    for (const n of ['Thierry Henry', 'Mohamed Salah', 'Erling Haaland', 'Patrick Vieira', 'Eric Cantona', 'Virgil van Dijk']) expect(epl.has(n), n).toBe(true);
    for (const n of ['Lionel Messi', 'Diego Maradona', 'Luka Modric', 'Pele', 'Neymar', 'Franz Beckenbauer']) expect(epl.has(n), n).toBe(false);
    expect(epl.size).toBeGreaterThan(250);
    expect(PLAYERS.filter(inPremierLeague).length).toBe(epl.size);
  });

  it('era filters cut the pool the way they say', () => {
    const nineties = poolPlayers('epl@90s');
    expect(nineties.length).toBeGreaterThan(25);
    for (const p of nineties) { expect(inPremierLeague(p)).toBe(true); expect(eraOf(p)).toBe('90s'); }
    expect(names('epl@90s').has('Eric Cantona')).toBe(true);
    expect(names('epl@90s').has('Mohamed Salah')).toBe(false);
    const modernAndNineties = poolPlayers('all@90s,now');
    expect(modernAndNineties.every((p) => eraOf(p) === '90s' || eraOf(p) === 'now')).toBe(true);
    // "Today" is the same people as the Modern Stars pool
    expect(poolPlayers('all@now').map((p) => p.id).sort()).toEqual(poolPlayers('modern').map((p) => p.id).sort());
  });

  it('keys are tidy: all eras means no filter, order does not matter, junk is ignored', () => {
    expect(poolKey('epl', ERA_IDS)).toBe('epl');
    expect(poolKey('epl', [])).toBe('epl');
    expect(poolKey('epl', ['00s', '90s'])).toBe('epl@90s,00s');
    expect(poolKey('epl', ['90s', '90s'])).toBe('epl@90s');
    expect(parsePoolKey('epl@90s,00s')).toEqual({ pool: 'epl', pools: ['epl'], eras: ['90s', '00s'], nations: [] });
    expect(parsePoolKey('nonsense@zzz')).toEqual({ pool: 'all', pools: ['all'], eras: [], nations: [] });
  });

  it('the Balkan pool is Bosnians, Croatians and Serbians, and its extras appear nowhere else', () => {
    const balkan = poolPlayers('balkan');
    expect(balkan.length).toBeGreaterThan(80);
    for (const p of balkan) expect(BALKAN_NATS.has(p.nat), p.name).toBe(true);
    const n = names('balkan');
    for (const x of ['Luka Modric', 'Edin Dzeko', 'Dusan Vlahovic', 'Nikola Milenkovic', 'Josko Gvardiol', 'Marko Livaja']) expect(n.has(x), x).toBe(true);
    for (const p of PLAYERS.filter((q) => q.only)) {
      for (const key of ['modern', 'legends', 'all', 'epl']) expect(names(key).has(p.name), `${p.name} leaked into ${key}`).toBe(false);
    }
  });

  it('eras that would be empty are known so the lobby can grey them out', () => {
    expect(eraCounts('modern').now).toBeGreaterThan(300);
    expect(eraCounts('modern')['90s']).toBe(0);
    expect(eraCounts('legends').now).toBe(0);
    expect(eraCounts('balkan').now).toBeGreaterThan(80);
  });
});

describe('is there enough to draft from?', () => {
  it('the big pools are fine for a 16-team cup; thin mixes are refused with a reason', () => {
    for (const key of ['modern', 'legends', 'all', 'epl']) expect(poolHealth(key, 16).ok, key).toBe(true);
    expect(poolHealth('balkan', 4).ok).toBe(true);
    const thin = poolHealth('balkan', 12);
    expect(thin.ok).toBe(false);
    expect(thin.problem).toMatch(/thin/);
    const tiny = poolHealth('epl@classic', 4);
    expect(tiny.ok).toBe(false);
    expect(tiny.players).toBeLessThan(10);
  });
});

describe('a room drafts only from the chosen mix', () => {
  const room = (settings: Record<string, unknown>) => {
    const eng = RoomEngine.create('ABCD', 1_000_000, testDeps('pools'));
    const a = eng.join({ name: 'Sam' }, 1_000_000);
    const b = eng.join({ name: 'Alex' }, 1_000_000);
    if (!a.ok || !b.ok) throw new Error('join');
    expect(eng.handle(a.id, { t: 'settings', patch: { format: 'packs', competition: 'league', teams: 4, ...settings } as never }, 1_000_000).ok).toBe(true);
    return { eng, ids: [a.id, b.id] as const };
  };

  it('Premier League 90s and 00s: every pack card and every CPU player belongs to it', () => {
    const { eng, ids } = room({ pools: ['epl'], eras: ['90s', '00s'] });
    expect(eng.s.settings.eras).toEqual(['90s', '00s']);
    expect(eng.handle(ids[0], { t: 'start' }, 1_000_000).ok).toBe(true);
    const allowed = new Set(poolPlayers('epl@90s,00s').map((p) => p.id));
    for (const id of ids) for (const offer of eng.s.draft!.offers![id]!) for (const c of offer.cards) expect(allowed.has(c), c).toBe(true);
  });

  it('Balkans: CPU teams draft Balkan players too, with nobody on two CPU teams', () => {
    const { eng, ids } = room({ pools: ['balkan'] });
    expect(eng.handle(ids[0], { t: 'start' }, 1_000_000).ok).toBe(true);
    // finish the draft by the clock
    let t = 1_000_000;
    for (let i = 0; i < 80 && eng.s.phase === 'draft'; i++) { t += 40_000; eng.tick(t); }
    expect(eng.s.phase).toBe('setup');
    const allowed = new Set(poolPlayers('balkan').map((p) => p.id));
    const bots = eng.s.seats.filter((s) => s.bot);
    const taken: string[] = [];
    for (const bot of bots) for (const p of Object.values(eng.s.squads[bot.id]!.slots)) { expect(allowed.has(p!), `${bot.name}: ${p}`).toBe(true); taken.push(p!); }
    expect(new Set(taken).size).toBe(taken.length);
  });

  it('a mix that is too thin for the number of teams will not start, and says why', () => {
    const { eng, ids } = room({ pools: ['epl'], eras: ['classic'] });
    const r = eng.handle(ids[0], { t: 'start' }, 1_000_000);
    expect(r).toMatchObject({ ok: false, code: 'bad_settings' });
    expect(eng.s.phase).toBe('lobby');
  });

  it('settings reject unknown pools and eras', () => {
    const { eng, ids } = room({});
    expect(eng.handle(ids[0], { t: 'settings', patch: { pools: ['nope'] } as never }, 1_000_000).ok).toBe(false);
    expect(eng.handle(ids[0], { t: 'settings', patch: { eras: ['stone-age'] } as never }, 1_000_000).ok).toBe(false);
    expect(parseMessage(JSON.stringify({ t: 'settings', patch: { pools: ['epl'], eras: ['90s', 'now'] } }))).toEqual({ t: 'settings', patch: { pools: ['epl'], eras: ['90s', 'now'] } });
    expect(parseMessage(JSON.stringify({ t: 'settings', patch: { pools: ['nope'] } }))).toBeNull();
    expect(parseMessage(JSON.stringify({ t: 'settings', patch: { eras: ['stone-age'] } }))).toBeNull();
  });
});

describe('ids', () => {
  it('slug is exported and stable', () => {
    expect(slug("N'Golo Kante")).toBe('n-golo-kante');
  });
});
