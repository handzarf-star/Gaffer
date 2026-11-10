// Pick-a-pack: before you see any players you choose between three sealed packs. Each pack carries a name, a glow, a smell
// and a rumour. They are hints, not promises: the glow is right about half the time and the smell a little more, so a
// choice feels tactical (you can read the clues, you know what your squad needs) while the result is mostly luck.
// No flags, no crests: the mystery comes from the packaging.

import { dealBoard, type DealInput } from './draft';
import { player, tierOf, type Pos, type Tier } from './players';
import { Rng } from './rng';

export type Scent = 'goals' | 'grit' | 'engine' | 'gloves';

export interface PackClue {
  name: string;
  /** what the wrapper seems to be glowing: the best card inside, when the clue is honest */
  glow: Tier;
  scent: Scent;
  rumour: string;
}

export interface PackOffer {
  cards: string[];
  clue: PackClue;
}

export const PACKS_PER_ROUND = 3;
/** how often a clue tells the truth on purpose. A lucky random clue can also be right, so the real rate is higher. */
export const GLOW_HONEST = 0.45;
export const SCENT_HONEST = 0.45;

export const SCENT_OF: Record<Pos, Scent> = {
  GK: 'gloves', CB: 'grit', LB: 'grit', RB: 'grit', CDM: 'engine', CM: 'engine', CAM: 'engine', LW: 'goals', RW: 'goals', ST: 'goals',
};

export const SCENT_TEXT: Record<Scent, string> = {
  goals: 'Smells of goals',
  grit: 'A whiff of grit',
  engine: 'Engine-room hum',
  gloves: 'Fresh gloves',
};

export const GLOW_TEXT: Record<Tier, string> = {
  bronze: 'Dull wrapper',
  silver: 'Silver sheen',
  gold: 'Golden glow',
  icon: 'Blinding glow',
};

const NAMES = [
  'The Brown Envelope', 'Midnight Scout', 'Cup Final Hamper', 'Training Ground Rumour', 'Sunday League Bag', 'Boardroom Gamble',
  'Golden Boot Box', 'Deadline Day Deal', "The Agent's Briefcase", 'Tunnel Whispers', 'Dressing Room Banter', "Scout's Notebook",
  'Floodlight Special', "Substitute's Bench", 'The Mystery Parcel', 'Press Box Leak', 'Kit Man Special', 'Lucky Dip',
];

const RUMOURS = [
  "Someone's cousin works at the training ground.", 'Left on the coach, apparently.', 'The kit man swears by this one.',
  'Smells faintly of liniment.', 'Rattles a little.', "Found behind the physio's bench.", "The groundskeeper won't say.",
  'Signed off by a very tired scout.', 'Came in with the late post.', 'Heard it was a bargain.', 'The captain looked away when it arrived.',
  'Warm to the touch.', 'Won on a coin toss.', "Marked 'handle with care'.", 'A rival scout offered double.', 'It hums around kick-off time.',
  'The mascot is nervous.', 'Delivered by a stranger in a trench coat.', 'Smuggled out of the stadium lounge.', 'A referee once refused to open it.',
];

const TIERS: Tier[] = ['bronze', 'silver', 'gold', 'icon'];
const TIER_ORDER: Record<Tier, number> = { bronze: 0, silver: 1, gold: 2, icon: 3 };
const SCENTS: Scent[] = ['goals', 'grit', 'engine', 'gloves'];

export function clueFor(cards: string[], name: string, rumour: string, rng: Rng): PackClue {
  const best = cards.reduce<Tier>((b, id) => (TIER_ORDER[tierOf(player(id).ovr)] > TIER_ORDER[b] ? tierOf(player(id).ovr) : b), 'bronze');
  const glow = rng.chance(GLOW_HONEST) ? best : rng.weighted(TIERS, (t) => ({ bronze: 0.35, silver: 0.4, gold: 0.2, icon: 0.05 })[t]);
  const inside = cards.map((id) => SCENT_OF[player(id).pos]);
  const scent = rng.chance(SCENT_HONEST) ? rng.pick(inside) : rng.pick(SCENTS);
  return { name, glow, scent, rumour };
}

/** Three sealed packs for one seat in one round. Every pack on its own is playable: it holds a card for a role the seat still needs. */
export function dealPacks(inp: DealInput & { count?: number }): PackOffer[] {
  const count = inp.count ?? PACKS_PER_ROUND;
  const rng = new Rng(`${inp.seed}/packs/${inp.round}/${inp.key}`);
  const names = rng.shuffle(NAMES).slice(0, count);
  const rumours = rng.shuffle(RUMOURS).slice(0, count);
  const used = new Set<string>(inp.taken);
  const offers: PackOffer[] = [];
  for (let i = 0; i < count; i++) {
    const cards = dealBoard({ ...inp, key: `${inp.key}#${i}`, taken: used });
    for (const c of cards) used.add(c);
    offers.push({ cards, clue: clueFor(cards, names[i]!, rumours[i]!, rng) });
  }
  return offers;
}
