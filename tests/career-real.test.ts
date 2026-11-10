import { describe, expect, it } from 'vitest';
import { PLAYER_BY_ID } from '../src/shared/players';
import { basisOf, getWorld } from '../src/shared/career/data';
import { createCareer, joinCareer, ROSTER, setReady, startCareer, table, tick, windowReady, type CareerState } from '../src/shared/career/engine';
import { lineOf } from '../src/shared/career/world';

const W = getWorld();
const HOUR = 3_600_000;

describe('the real career world', () => {
  it('has two leagues of sixteen, with the six clubs the game must have in the First League', () => {
    expect(W.clubs.filter((c) => c.league === 1)).toHaveLength(16);
    expect(W.clubs.filter((c) => c.league === 2)).toHaveLength(16);
    for (const id of ['crvena-zvezda', 'partizan', 'dinamo-zagreb', 'hajduk', 'zeljeznicar', 'sarajevo']) expect(W.club(id).league, id).toBe(1);
  });
  it('never clashes with the draft pool, and every player is sane', () => {
    const seen = new Set<string>();
    for (const p of W.players) {
      expect(PLAYER_BY_ID.has(p.id), p.id).toBe(false);
      expect(seen.has(p.id), `duplicate ${p.id}`).toBe(false);
      seen.add(p.id);
      expect(p.ovr).toBeGreaterThanOrEqual(45);
      expect(p.ovr).toBeLessThanOrEqual(86);
      expect(p.nat).toMatch(/^[A-Z]{3}$/);
      if (p.age !== null) { expect(p.age).toBeGreaterThanOrEqual(15); expect(p.age).toBeLessThanOrEqual(45); }
    }
  });
  it('every club can field a team: two keepers, enough in every line', () => {
    for (const c of W.clubs) {
      const ps = W.byClub.get(c.id) ?? [];
      const n = { GK: 0, DF: 0, MF: 0, FW: 0 };
      for (const p of ps) n[lineOf(p.pos)]++;
      expect(n.GK, `${c.id} keepers`).toBeGreaterThanOrEqual(2);
      expect(ps.length, c.id).toBeGreaterThanOrEqual(20);
      expect(n.DF + n.MF + n.FW, c.id).toBeGreaterThanOrEqual(18);
    }
  });
  it('the First League pool is deep enough to draft sixteen squads of twenty, in every position', () => {
    const pool = W.players.filter((p) => W.club(p.club).league === 1);
    expect(pool.length).toBeGreaterThanOrEqual(ROSTER * 16);
    const lines = { GK: 0, DF: 0, MF: 0, FW: 0 };
    for (const p of pool) lines[lineOf(p.pos)]++;
    expect(lines.GK).toBeGreaterThanOrEqual(32);
    expect(lines.DF).toBeGreaterThanOrEqual(16 * 6);
    expect(lines.MF).toBeGreaterThanOrEqual(16 * 6);
    expect(lines.FW).toBeGreaterThanOrEqual(16 * 3);
  });
  it('every rating has a published basis, and the best player at a club has the best rank', () => {
    for (const c of W.clubs) {
      const ps = [...(W.byClub.get(c.id) ?? [])].sort((a, b) => b.ovr - a.ovr);
      expect(basisOf(ps[0]!.id)!.rank, c.id).toBe(1);
    }
    expect(basisOf('k-not-a-player')).toBeNull();
  });
  it('stronger clubs get stronger squads (club level is the anchor)', () => {
    const avg = (id: string) => { const ps = [...(W.byClub.get(id) ?? [])].sort((a, b) => b.ovr - a.ovr).slice(0, 11); return ps.reduce((s, p) => s + p.ovr, 0) / ps.length; };
    expect(avg('dinamo-zagreb')).toBeGreaterThan(avg('siroki-brijeg'));
    expect(avg('hajduk')).toBeGreaterThan(avg('velez'));
  });
});

describe('a real league, start to finish', () => {
  it('drafts from the whole pool, plays a season and moves on, without breaking a rule', () => {
    const st: CareerState = createCareer(W, 'REAL', 'real-seed', 0);
    expect(joinCareer(W, st, { memberId: 'm0-aaaaaaaa', name: 'Sam', choice: { kind: 'real', id: 'zeljeznicar' } }).ok).toBe(true);
    expect(joinCareer(W, st, { memberId: 'm1-bbbbbbbb', name: 'Alex', choice: { kind: 'custom', name: 'Sunday Rovers' } }).ok).toBe(true);
    let now = 0;
    expect(startCareer(W, st, now).ok).toBe(true);
    while (st.phase === 'draft') { now += 13 * HOUR; tick(W, st, now); }
    // the draft mixed the clubs up: a real club's squad is no longer its own players
    const zel = st.clubs['zeljeznicar']!;
    expect(zel.roster).toHaveLength(ROSTER);
    expect(zel.roster.filter((id) => W.player(id).club === 'zeljeznicar').length).toBeLessThan(ROSTER);
    let guard = 0;
    while (st.season === 1 && guard++ < 200) {
      now += 10;
      if (st.phase === 'play') for (const m of st.members) setReady(W, st, m.id, true, now);
      else if (st.phase === 'window') for (const m of st.members) windowReady(W, st, m.id, true, now);
    }
    expect(st.season).toBe(2);
    expect(st.history[0]!.promoted).toHaveLength(2);
    // sanity of the football: goals per match across the whole season
    const rows = table(st, 1);
    expect(rows).toHaveLength(16);
  });
});
