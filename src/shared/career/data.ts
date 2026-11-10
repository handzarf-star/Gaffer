// The real career world: 32 Balkan clubs and their current squads, built from the generated rows.
import { BASIS_ROWS, CLUB_ROWS, PLAYER_ROWS } from './world.gen';
import { indexWorld, type IndexedWorld, type World } from './world';

let cached: IndexedWorld | null = null;

export function getWorld(): IndexedWorld {
  if (cached) return cached;
  const world: World = {
    clubs: CLUB_ROWS.map(([id, name, country, league, colors]) => ({ id, name, country, league, colors })),
    players: PLAYER_ROWS.map(([id, name, nat, pos, ovr, age, ci, no]) => ({ id, name, nat, pos, ovr, age, club: CLUB_ROWS[ci]![0], no })),
  };
  cached = indexWorld(world);
  return cached;
}

/** Why a player is rated what he is. */
export interface RatingBasis { caps: number; apps: number; article: boolean; rank: number }
let basisIndex: Map<string, RatingBasis> | null = null;
export function basisOf(playerId: string): RatingBasis | null {
  if (!basisIndex) {
    basisIndex = new Map();
    PLAYER_ROWS.forEach((row, i) => {
      const b = BASIS_ROWS[i]!;
      basisIndex!.set(row[0], { caps: b[0], apps: b[1], article: b[2] === 1, rank: b[3] });
    });
  }
  return basisIndex.get(playerId) ?? null;
}
