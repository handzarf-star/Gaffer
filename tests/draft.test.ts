import { describe, expect, it } from 'vitest';
import { ROUNDS, autoPick, dealBoard, openRoles, placePlayer } from '../src/shared/draft';
import { fitKind } from '../src/shared/formations';
import { PLAYER_BY_ID } from '../src/shared/players';
import { poolPlayers } from '../src/shared/pools';
import { emptySquad, isSquadComplete, profile } from '../src/shared/squad';

describe('dealing', () => {
  it('is deterministic and has no duplicate cards', () => {
    const base = { seed: 'abc', pool: 'modern' as const, round: 3, key: 'shared', size: 6, taken: new Set<string>(), needs: [['GK', 'ST'], ['CB']] as never };
    const a = dealBoard(base);
    const b = dealBoard(base);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
    expect(a).toHaveLength(6);
  });
  it('respects the pool and never re-deals taken players', () => {
    const taken = new Set(poolPlayers('legends').slice(0, 100).map((p) => p.id));
    for (let r = 1; r <= 30; r++) {
      const board = dealBoard({ seed: 's' + r, pool: 'legends', round: r, key: 'k', size: 8, taken, needs: [['GK']] });
      for (const id of board) {
        expect(taken.has(id)).toBe(false);
        expect(PLAYER_BY_ID.get(id)!.era).toBe('L');
      }
    }
  });
  it('includes a needed position for the seat', () => {
    let hits = 0;
    for (let r = 1; r <= 60; r++) {
      const board = dealBoard({ seed: 'need' + r, pool: 'modern', round: r, key: 'k', size: 3, taken: new Set(), needs: [['GK']] });
      if (board.some((id) => PLAYER_BY_ID.get(id)!.pos === 'GK')) hits++;
    }
    expect(hits).toBe(60);
  });
});

describe('a full solo auto-draft', () => {
  it('always completes with 11 distinct, mostly natural players', () => {
    for (let g = 0; g < 80; g++) {
      let sq = emptySquad('433');
      const taken = new Set<string>();
      for (let r = 1; r <= ROUNDS; r++) {
        const board = dealBoard({ seed: 'g' + g, pool: 'all', round: r, key: 'p', size: 3, taken, needs: [openRoles(sq).map((o) => o.role)] });
        const pick = autoPick(sq, board)!;
        expect(pick).toBeTruthy();
        sq = placePlayer(sq, pick.slotId, pick.cardId)!;
        taken.add(pick.cardId);
      }
      expect(isSquadComplete(sq)).toBe(true);
      expect(new Set(Object.values(sq.slots)).size).toBe(11);
      const prof = profile(sq);
      expect(prof.overall).toBeGreaterThan(70);
      // nobody should be forced into goal
      const gk = Object.entries(sq.slots).find(([slot]) => slot === 's0')![1]!;
      expect(fitKind(PLAYER_BY_ID.get(gk)!.pos, 'GK')).not.toBe('poor');
    }
  });
});
