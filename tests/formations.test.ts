import { describe, expect, it } from 'vitest';
import { FORMATIONS, FORMATION_IDS, assignBest, fit, fitKind, penalty, slotLinks } from '../src/shared/formations';
import { PLAYERS } from '../src/shared/players';

describe('formations', () => {
  it('every formation has 11 slots, one keeper, unique ids and on-pitch coordinates', () => {
    for (const id of FORMATION_IDS) {
      const f = FORMATIONS[id];
      expect(f.slots).toHaveLength(11);
      expect(f.slots.filter((s) => s.role === 'GK')).toHaveLength(1);
      expect(new Set(f.slots.map((s) => s.id)).size).toBe(11);
      for (const s of f.slots) {
        expect(s.x).toBeGreaterThan(0);
        expect(s.x).toBeLessThan(100);
        expect(s.y).toBeGreaterThan(5);
        expect(s.y).toBeLessThan(98);
      }
    }
  });
  it('chemistry link graphs are connected enough but not complete', () => {
    for (const id of FORMATION_IDS) {
      const links = slotLinks(FORMATIONS[id]);
      expect(links.length, id).toBeGreaterThanOrEqual(14);
      expect(links.length, id).toBeLessThanOrEqual(24);
      // the whole team must be one connected graph
      const adj = new Map<string, string[]>(FORMATIONS[id].slots.map((s) => [s.id, []]));
      for (const [a, b] of links) { adj.get(a)!.push(b); adj.get(b)!.push(a); }
      const seen = new Set<string>(['s0']);
      const stack = ['s0'];
      while (stack.length) for (const n of adj.get(stack.pop()!)!) if (!seen.has(n)) { seen.add(n); stack.push(n); }
      expect(seen.size, `${id} connected`).toBe(11);
    }
  });
  it('fit behaves sensibly', () => {
    expect(fit('CM', 'CM')).toBe(1);
    expect(fitKind('CM', 'CM')).toBe('natural');
    expect(fitKind('LB', 'LWB')).toBe('close');
    expect(penalty('CM', 'CDM')).toBeLessThanOrEqual(5);
    expect(penalty('ST', 'GK')).toBeGreaterThanOrEqual(20);
    expect(penalty('GK', 'ST')).toBeGreaterThanOrEqual(20);
    expect(penalty('ST', 'CB')).toBeGreaterThan(penalty('CM', 'CB'));
    expect(penalty('LB', 'RB')).toBeLessThan(penalty('LB', 'LW'));
    // fit is symmetric for pairs that are both real roles
    expect(fit('LW', 'LM')).toBeCloseTo(fit('LM' as never, 'LW'), 5);
  });
  it('assignBest seats a natural XI exactly', () => {
    const pick = (pos: string, n: number) => PLAYERS.filter((p) => p.pos === pos && p.era === 'M').slice(0, n).map((p) => p.id);
    const ids = [...pick('GK', 1), ...pick('LB', 1), ...pick('CB', 2), ...pick('RB', 1), ...pick('CM', 2), ...pick('CDM', 1), ...pick('LW', 1), ...pick('ST', 1), ...pick('RW', 1)];
    const placed = assignBest(ids, FORMATIONS['433']);
    expect(Object.keys(placed)).toHaveLength(11);
    expect(new Set(Object.values(placed)).size).toBe(11);
    const gkSlot = FORMATIONS['433'].slots.find((s) => s.role === 'GK')!.id;
    expect(PLAYERS.find((p) => p.id === placed[gkSlot])!.pos).toBe('GK');
  });
});
