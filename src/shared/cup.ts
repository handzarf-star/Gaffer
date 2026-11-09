// Solo knockout cup and the daily draft. Pure and seeded, so a run can be resumed from a saved state
// and the daily draft is identical for everybody.

import { aiPick, boardSize, dealBoard, openRoles, placePlayer } from './draft';
import { FORMATION_IDS, type FormationId } from './formations';
import { Rng } from './rng';
import type { PoolId } from './players';
import { emptySquad, profile, STYLE_IDS, type Squad } from './squad';

export const CUP_STAGES = ['Round of 16', 'Quarter-final', 'Semi-final', 'Final'] as const;

/** AI drafting skill and pack size per stage: later opponents choose better and from more cards. */
const STAGE_SKILL = [0.5, 0.68, 0.84, 0.95];
const STAGE_PACK = [3, 3, 4, 5];

const PREFIX = ['Northgate', 'Harbour', 'Ironbridge', 'Kestrel', 'Ashford', 'Redcliffe', 'Marlow', 'Stonehaven', 'Larkfield', 'Brightwater', 'Thornbury', 'Elmstead', 'Highmoor', 'Saltmarsh', 'Wexcombe', 'Oakham'];
const SUFFIX = ['Rovers', 'Athletic', 'Wanderers', 'Albion', 'Dynamo', 'Rangers', 'Town', 'Borough', 'Forest', 'Harriers', 'Olympic', 'Vanguard'];

export interface Opponent {
  name: string;
  squad: Squad;
  overall: number;
}

export function opponentName(seed: string, stage: number): string {
  const r = new Rng(`${seed}/oppname/${stage}`);
  return `${r.pick(PREFIX)} ${r.pick(SUFFIX)}`;
}

export function buildOpponent(seed: string, stage: number, pool: PoolId): Opponent {
  const rng = new Rng(`${seed}/opp/${stage}`);
  const formation = rng.pick(FORMATION_IDS);
  let squad = emptySquad(formation);
  squad = { ...squad, style: rng.pick(STYLE_IDS) };
  const taken = new Set<string>();
  for (let round = 1; round <= 11; round++) {
    const board = dealBoard({
      seed: `${seed}/oppdraft/${stage}`, pool, round, key: 'ai', size: STAGE_PACK[stage] ?? 3, taken,
      needs: [openRoles(squad).map((o) => o.role)],
    });
    const pick = aiPick(squad, board, STAGE_SKILL[stage] ?? 0.7, rng);
    if (!pick) break;
    const next = placePlayer(squad, pick.slotId, pick.cardId);
    if (!next) break;
    squad = next;
    taken.add(pick.cardId);
  }
  return { name: opponentName(seed, stage), squad, overall: profile(squad).overall };
}

/** The pack you see in a given round of a solo draft. Depends only on the seed, the round and what you own. */
export function cupBoard(seed: string, pool: PoolId, round: number, squad: Squad): string[] {
  const owned = new Set(Object.values(squad.slots).filter((x): x is string => !!x));
  return dealBoard({
    seed, pool, round, key: 'solo', size: boardSize('packs', 1), taken: owned,
    needs: [openRoles(squad).map((o) => o.role)],
  });
}

export function dailySeed(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `daily-${y}-${m}-${day}`;
}

export function dailyLabel(seed: string): string {
  return seed.replace('daily-', '');
}

export type { FormationId };
