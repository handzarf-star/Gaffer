import { FORMATIONS, ROLE_TO_POS, effectiveOvr, type Role } from './formations';
import { Rng } from './rng';
import { PLAYERS, player, poolPlayers, tierOf, type Pos, type PoolId, type Tier } from './players';
import type { Squad } from './squad';

export type DraftFormat = 'duel' | 'packs' | 'turns';
export type RatingsMode = 'hidden' | 'tier' | 'full';
export const ROUNDS = 11;

export const FORMAT_INFO: Record<DraftFormat, { name: string; blurb: string }> = {
  duel: { name: 'Duel', blurb: 'One shared board each round, picks alternate. Steal your mate\'s target.' },
  packs: { name: 'Packs', blurb: 'Everyone opens their own pack at the same time. Fast and lucky.' },
  turns: { name: 'Take turns', blurb: 'One of you drafts a whole squad while the other watches live, then you swap. CPU teams go last.' },
};

export function boardSize(format: DraftFormat, seats: number): number {
  return format === 'duel' ? Math.min(8, seats + 4) : 3;
}

const POS_WEIGHT: Record<Pos, number> = {
  GK: 0.6, CB: 1.2, LB: 0.7, RB: 0.7, CDM: 0.9, CM: 1.1, CAM: 0.8, LW: 0.8, RW: 0.8, ST: 1.2,
};

const TIER_WEIGHT: Record<PoolId, Record<Tier, number>> = {
  modern: { bronze: 0.3, silver: 0.44, gold: 0.21, icon: 0.05 },
  legends: { bronze: 0.02, silver: 0.28, gold: 0.5, icon: 0.2 },
  all: { bronze: 0.18, silver: 0.4, gold: 0.31, icon: 0.11 },
};

export function openRoles(sq: Squad): Array<{ slotId: string; role: Role }> {
  return FORMATIONS[sq.formation].slots.filter((s) => !sq.slots[s.id]).map((s) => ({ slotId: s.id, role: s.role }));
}

export interface DealInput {
  seed: string;
  pool: PoolId;
  round: number;
  /** key that makes each seat's pack different in `packs` format; use 'shared' for duel */
  key: string;
  size: number;
  /** players that can no longer appear (already drafted in a shared draft, or already in your squad) */
  taken: ReadonlySet<string>;
  /** open roles of every seat the board should serve; one "needed" card is added per seat */
  needs: Role[][];
}

const poolCache = new Map<PoolId, ReturnType<typeof indexPool>>();
function indexPool(pool: PoolId) {
  const all = poolPlayers(pool);
  const byPos = new Map<Pos, typeof all>();
  for (const p of all) {
    const arr = byPos.get(p.pos) ?? [];
    arr.push(p);
    byPos.set(p.pos, arr);
  }
  return { all, byPos };
}
function poolIndex(pool: PoolId) {
  let ix = poolCache.get(pool);
  if (!ix) {
    ix = indexPool(pool);
    poolCache.set(pool, ix);
  }
  return ix;
}

/** Deterministically deal one board of player ids. */
export function dealBoard(inp: DealInput): string[] {
  const rng = new Rng(`${inp.seed}/deal/${inp.round}/${inp.key}`);
  const { all, byPos } = poolIndex(inp.pool);
  const chosen: string[] = [];
  const used = new Set<string>(inp.taken);
  const tierW = TIER_WEIGHT[inp.pool];

  const draw = (pos: Pos | null): string | null => {
    const pickTier = (): Tier => rng.weighted(['bronze', 'silver', 'gold', 'icon'] as Tier[], (t) => tierW[t]);
    const source = pos ? (byPos.get(pos) ?? []) : all;
    const free = source.filter((p) => !used.has(p.id));
    if (free.length === 0) return null;
    // try the rolled tier, then relax to any tier
    const t = pickTier();
    const inTier = free.filter((p) => tierOf(p.ovr) === t);
    const pool = inTier.length ? inTier : free;
    const p = rng.pick(pool);
    used.add(p.id);
    return p.id;
  };

  // 1) one "needed" card per seat so nobody is ever locked out of finishing their XI
  for (const roles of inp.needs) {
    if (roles.length === 0 || chosen.length >= inp.size) continue;
    // prefer scarce roles: GK and anything the seat has only one slot left for
    const counts = new Map<Pos, number>();
    for (const r of roles) counts.set(ROLE_TO_POS[r], (counts.get(ROLE_TO_POS[r]) ?? 0) + 1);
    const posList = [...counts.keys()];
    const pos = rng.weighted(posList, (p) => (p === 'GK' ? 1.6 : 1) * (counts.get(p) ?? 1));
    const id = draw(pos) ?? draw(null);
    if (id) chosen.push(id);
  }
  // 2) the rest follows a natural squad distribution
  const posKeys = Object.keys(POS_WEIGHT) as Pos[];
  let guard = 0;
  while (chosen.length < inp.size && guard++ < 200) {
    const pos = rng.weighted(posKeys, (p) => POS_WEIGHT[p]);
    const onBoard = chosen.filter((id) => player(id).pos === pos).length;
    if (onBoard >= 3) continue;
    const id = draw(pos) ?? draw(null);
    if (id) chosen.push(id);
  }
  return rng.shuffle(chosen);
}

/* ───────────── picking helpers ───────────── */

export function suggestSlot(sq: Squad, playerId: string): string | null {
  let best: { slotId: string; v: number } | null = null;
  for (const o of openRoles(sq)) {
    const v = effectiveOvr(playerId, o.role);
    if (!best || v > best.v) best = { slotId: o.slotId, v };
  }
  return best ? best.slotId : null;
}

export function placePlayer(sq: Squad, slotId: string, playerId: string): Squad | null {
  if (!(slotId in sq.slots) || sq.slots[slotId]) return null;
  if (Object.values(sq.slots).includes(playerId)) return null;
  return { ...sq, slots: { ...sq.slots, [slotId]: playerId } };
}

/** Greedy best pick: highest effective rating in the best open slot. Never throws if any slot is open. */
export function autoPick(sq: Squad, board: readonly string[]): { cardId: string; slotId: string } | null {
  let best: { cardId: string; slotId: string; v: number } | null = null;
  const open = openRoles(sq);
  for (const id of board) {
    if (Object.values(sq.slots).includes(id)) continue;
    for (const o of open) {
      // small nudge toward natural fits so ties prefer the right position
      const p = player(id);
      const v = effectiveOvr(id, o.role) + (ROLE_TO_POS[o.role] === p.pos ? 0.5 : 0);
      if (!best || v > best.v) best = { cardId: id, slotId: o.slotId, v };
    }
  }
  return best ? { cardId: best.cardId, slotId: best.slotId } : null;
}

/** AI drafter: with probability `skill` picks like autoPick, otherwise a random card in its best slot. */
export function aiPick(sq: Squad, board: readonly string[], skill: number, rng: Rng): { cardId: string; slotId: string } | null {
  if (rng.chance(skill)) return autoPick(sq, board);
  const options = board.filter((id) => !Object.values(sq.slots).includes(id));
  if (options.length === 0) return null;
  const cardId = rng.pick(options);
  const slotId = suggestSlot(sq, cardId);
  return slotId ? { cardId, slotId } : null;
}

export const ALL_PLAYER_COUNT = PLAYERS.length;
