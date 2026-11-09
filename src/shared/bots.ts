// CPU teams. They draft after the humans have finished (from players the humans did not take), so a CPU never steals
// your target in a Duel draft but the squads are still all different. Difficulty is how well they pick and how many
// cards they get to choose from.

import { aiPick, dealBoard, openRoles, placePlayer, suggestSlot } from './draft';
import { FORMATION_IDS, type FormationId } from './formations';
import { Rng } from './rng';
import { poolPlayers, type PoolId } from './players';
import { STYLE_IDS, autoArrange, changeFormation, emptySquad, profile, type Squad } from './squad';

export type BotLevel = 'easy' | 'normal' | 'hard';

export const BOT_LEVELS: Record<BotLevel, { name: string; blurb: string; skill: number; pack: number }> = {
  easy: { name: 'Easy', blurb: 'Picks a bit randomly. Good for a relaxed run.', skill: 0.3, pack: 3 },
  normal: { name: 'Normal', blurb: 'Sensible drafts. A fair fight.', skill: 0.6, pack: 3 },
  hard: { name: 'Hard', blurb: 'Picks well from bigger packs. Bring your best XI.', skill: 0.88, pack: 4 },
};

const PREFIX = ['Northgate', 'Harbour', 'Ironbridge', 'Kestrel', 'Ashford', 'Redcliffe', 'Marlow', 'Stonehaven', 'Larkfield', 'Brightwater', 'Thornbury', 'Elmstead', 'Highmoor', 'Saltmarsh', 'Wexcombe', 'Oakham'];
const SUFFIX = ['Rovers', 'Athletic', 'Wanderers', 'Albion', 'Dynamo', 'Rangers', 'Town', 'Borough', 'Forest', 'Harriers', 'Olympic', 'Vanguard'];

/** Distinct names for up to 16 CPU teams. */
export function botNames(seed: string, count: number): string[] {
  const rng = new Rng(`${seed}/botnames`);
  const prefixes = rng.shuffle(PREFIX);
  return Array.from({ length: count }, (_, i) => `${prefixes[i % prefixes.length]} ${rng.pick(SUFFIX)}`);
}

export function buildBotSquad(seed: string, pool: PoolId, level: BotLevel, taken: Set<string>, key: string): Squad {
  const rng = new Rng(`${seed}/bot/${key}`);
  const cfg = BOT_LEVELS[level];
  const formation: FormationId = rng.pick(FORMATION_IDS);
  let sq = emptySquad(formation);
  for (let round = 1; round <= 11; round++) {
    const board = dealBoard({
      seed: `${seed}/botdraft/${key}`, pool, round, key, size: cfg.pack,
      taken, needs: [openRoles(sq).map((o) => o.role)],
    });
    let pick = aiPick(sq, board, cfg.skill, rng);
    if (!pick) {
      // the pool is nearly drained: take the best player nobody has
      const spare = poolPlayers(pool).filter((p) => !taken.has(p.id)).sort((a, b) => b.ovr - a.ovr)[0];
      const slot = spare ? suggestSlot(sq, spare.id) : null;
      if (spare && slot) pick = { cardId: spare.id, slotId: slot };
    }
    if (!pick) break;
    const next = placePlayer(sq, pick.slotId, pick.cardId);
    if (!next) break;
    sq = next;
    taken.add(pick.cardId);
  }
  sq = autoArrange(sq);
  // smarter CPUs also pick the formation and tactic that suit their players
  if (level !== 'easy') {
    let best = sq;
    let bestOvr = profile(sq).overall;
    for (const f of FORMATION_IDS) {
      const c = changeFormation(sq, f);
      const o = profile(c).overall;
      if (o > bestOvr + 0.05) { best = c; bestOvr = o; }
    }
    sq = best;
  }
  let style = rng.pick(STYLE_IDS);
  if (level !== 'easy' && rng.chance(cfg.skill)) {
    let bestOvr = -1;
    for (const st of STYLE_IDS) {
      const o = profile({ ...sq, style: st }).overall;
      if (o > bestOvr) { bestOvr = o; style = st; }
    }
  }
  return { ...sq, style };
}
