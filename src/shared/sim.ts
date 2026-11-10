import { FORMATIONS, ROLE_TO_POS, effectiveOvr, type Role } from './formations';
import { Rng } from './rng';
import { player, shortName } from './players';
import { YELLOW_PER_90, traits, type Traits } from './playerstats';
import { profile, type Profile, type Squad } from './squad';

export type EventType =
  | 'kickoff'
  | 'save'
  | 'miss'
  | 'post'
  | 'goal'
  | 'yellow'
  | 'red'
  | 'freekick'
  | 'penalty'
  | 'corner'
  | 'half'
  | 'full'
  | 'et'
  | 'etend'
  | 'shootout'
  | 'pen_goal'
  | 'pen_miss';

/** Where a shot came from. Award events (freekick/penalty/corner) are followed by a shot event with the same source. */
export type Source = 'play' | 'freekick' | 'penalty' | 'corner';

export interface MatchEvent {
  /** minute 0..120 (shootout events use 121+) */
  t: number;
  type: EventType;
  /** team the event is about: scorer / carded player / taker */
  team: 0 | 1;
  p?: string;
  a?: string;
  /** the other player involved: the player who was fouled */
  v?: string;
  src?: Source;
  /** the chance of this shot scoring, 0 to 1 (shots only), exactly as the engine rolled it: the live view's arrow uses it so it never overstates a chance */
  xg?: number;
  /** score after this event; for pen_* the shootout score */
  s: [number, number];
  text: string;
  /** which commentary template produced `text` ("group:index", or a fixed key like "kickoff") and the names it was filled with, so a client can write the same line in another language */
  tk?: string;
  tv?: Record<string, string>;
}

export interface MatchStats {
  shots: [number, number];
  onTarget: [number, number];
  xg: [number, number];
  possession: [number, number];
  yellows: [number, number];
  reds: [number, number];
  fouls: [number, number];
  corners: [number, number];
  /** penalties awarded */
  penalties: [number, number];
  freeKicks: [number, number];
}

export interface MatchResult {
  score: [number, number];
  pens: [number, number] | null;
  went: 'ft' | 'et' | 'pens';
  /** null = draw (only when draws are allowed) */
  winner: 0 | 1 | null;
  events: MatchEvent[];
  stats: MatchStats;
  motm: { team: 0 | 1; player: string; reason: string };
  headline: string;
  overall: [number, number];
}

export interface SimOptions {
  /** true = must produce a winner (extra time + shootout). */
  knockout: boolean;
}

const ROLE_SCORE_W: Record<Role, number> = {
  GK: 0.005, CB: 0.7, LB: 0.5, RB: 0.5, LWB: 0.8, RWB: 0.8, CDM: 0.7, CM: 1.4, LM: 2.4, RM: 2.4, CAM: 2.8, LW: 3.2, RW: 3.2, ST: 5,
};
const ROLE_ASSIST_W: Record<Role, number> = {
  GK: 0.02, CB: 0.4, LB: 2, RB: 2, LWB: 2.2, RWB: 2.2, CDM: 1.2, CM: 2.5, LM: 2.6, RM: 2.6, CAM: 3, LW: 3, RW: 3, ST: 1.5,
};
const ROLE_HEAD_W: Record<Role, number> = {
  GK: 0, CB: 3, LB: 0.4, RB: 0.4, LWB: 0.4, RWB: 0.4, CDM: 1.2, CM: 1, LM: 0.5, RM: 0.5, CAM: 0.8, LW: 0.6, RW: 0.6, ST: 3,
};

interface Unit {
  id: string;
  role: Role;
  eff: number;
  tr: Traits;
}

function units(sq: Squad): Unit[] {
  return FORMATIONS[sq.formation].slots
    .map((s) => ({ id: sq.slots[s.id] ?? '', role: s.role }))
    .filter((u) => u.id)
    .map((u) => ({ ...u, eff: effectiveOvr(u.id, u.role), tr: traits(u.id) }));
}

/** match-day form: one normal draw per team per match, scaled to rating points */
const FORM_SD = 2.8;
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/* ───── real-world-shaped rates (see playerstats.ts for sources) ───── */
/** fouls per team-minute: ~11 a game each, the top-flight average */
const FOUL_RATE = 0.12;
/** share of fouls that are a yellow card: 11 fouls x 0.185 = ~2 yellows per team, ~4.2 a game */
const YELLOW_PER_FOUL = 0.185;
const RED_PER_FOUL = 0.003;
/** fouls inside the box: ~0.15 penalties per team per game (~0.3 a game; top-five leagues run 0.25-0.36) */
const PEN_PER_FOUL = 0.0135;
/** dangerous direct free kicks: ~1 shot per team per game */
const FK_PER_FOUL = 0.1;
const PEN_CONVERSION = 0.775;
/** attacks that win a corner which produces a shot */
const CORNER_SHOT_PER_ATTACK = 0.05;
/** open-play shot quality is lower than before because set pieces now supply their own goals */
const OPEN_QUALITY = 0.083;

interface Side {
  prof: Profile;
  units: Unit[];
  /** players still on the pitch */
  onPitch: Unit[];
  reds: number;
  yellowed: Set<string>;
  form: number;
}

export const T = {
  goal: [
    '{p} finishes it. {t} score.',
    'GOAL! {p} puts {t} ahead of the argument.',
    '{p} buries it. The keeper had no chance.',
    'Clinical from {p}. {t} are celebrating.',
    '{p} makes space and fires home.',
    'Beautiful move, and {p} is there at the end of it.',
  ],
  goalAssist: [
    '{a} picks him out and {p} makes no mistake.',
    '{a} threads it through, {p} slots it home.',
    'Lovely ball from {a}. {p} finishes.',
    '{a} crosses, {p} gets across his man and scores.',
    'Great work by {a}, and {p} applies the finish.',
  ],
  goalFk: ['{p} curls the free kick over the wall and into the corner!', 'What a free kick from {p}! The keeper never moved.', '{p} bends it round the wall. Unstoppable.'],
  goalPen: ['{p} sends the keeper the wrong way. Penalty scored.', '{p} steps up and buries the penalty.', 'Cool as you like from {p}. Penalty converted.'],
  goalCorner: ['The corner is swung in and {p} rises highest to head it home!', '{p} powers a header in from the corner.', 'Scrappy but it counts: {p} bundles in from the corner.'],
  save: ['{k} gets down brilliantly to stop {p}.', '{p} lets fly, but {k} palms it away.', 'Big save from {k}! {p} cannot believe it.', "{k} tips {p}'s effort around the post."],
  saveFk: ['{k} claws the free kick from {p} away.', '{p} hits it well but {k} is across to save.'],
  savePen: ['{k} guesses right and saves the penalty from {p}!', 'PENALTY SAVED! {k} denies {p}.'],
  saveCorner: ['{k} punches the corner clear under pressure.', '{p} gets a header in, {k} saves.'],
  miss: ['{p} had the chance and blazes it over.', '{p} drags it wide from a good position.', 'Wasteful from {p}. That was there to be hit.', '{p} goes for power and loses control of it.'],
  missFk: ['{p} sends the free kick into the wall.', '{p} lifts the free kick over the bar.', 'The free kick from {p} sails wide.'],
  missPen: ['{p} puts the penalty over the bar!', '{p} drags the penalty wide. Disaster.'],
  missCorner: ['The header from {p} goes just over.', '{p} cannot keep the header down.'],
  post: ['{p} rattles the woodwork!', 'Off the post! {p} is inches away.', '{p} hits the bar. So close.'],
  yellow: ['{p} goes into the book for a foul on {v}.', 'Yellow card for {p} after a late challenge on {v}.', '{p} is booked for a tug on {v}.'],
  red: ['RED CARD! {p} is sent off.', '{p} sees red. {t} are down to ten.', 'Straight red for {p}. Disaster.'],
  red2: ['Second yellow for {p}, and that is a red. {t} are down to ten.', '{p} is booked again and has to go!'],
  fk: ['Dangerous free kick, and {p} stands over it.', '{v} is brought down on the edge of the box. {p} lines up the free kick.', 'Free kick in a shooting position for {t}. {p} is on it.'],
  pen: ['PENALTY! {v} is brought down in the box.', 'Penalty to {t}! {v} goes down under the challenge.', 'The referee points to the spot. {v} was clipped.'],
  corner: ['Corner to {t}. It is swung into a crowded box.', '{t} win a corner and send everyone forward.'],
};

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

/** Pure, deterministic match simulation. */
export function simulateMatch(
  sqA: Squad,
  sqB: Squad,
  names: [string, string],
  seed: string,
  opts: SimOptions,
): MatchResult {
  const rng = new Rng(seed);
  /** pick a commentary line (same single random draw as before) and remember which one it was */
  const say = (group: string, vars: Record<string, string>): { text: string; tk: string; tv: Record<string, string> } => {
    const list = (T as unknown as Record<string, string[]>)[group]!;
    const tpl = rng.pick(list);
    return { text: fill(tpl, vars), tk: `${group}:${list.indexOf(tpl)}`, tv: vars };
  };
  const profs: [Profile, Profile] = [profile(sqA), profile(sqB)];
  const sides: [Side, Side] = [0, 1].map((i) => {
    const sq = i === 0 ? sqA : sqB;
    const u = units(sq);
    return { prof: profs[i as 0 | 1], units: u, onPitch: u.slice(), reds: 0, yellowed: new Set<string>(), form: rng.normal() };
  }) as [Side, Side];

  // Counter: +2 attack when you are clearly the underdog
  const attMod: [number, number] = [0, 0];
  for (const i of [0, 1] as const) {
    const me = i === 0 ? sqA : sqB;
    if (me.style === 'counter' && profs[1 - i]!.overall - profs[i]!.overall >= 3) attMod[i] = 2;
  }

  const score: [number, number] = [0, 0];
  const events: MatchEvent[] = [];
  const stats: MatchStats = {
    shots: [0, 0], onTarget: [0, 0], xg: [0, 0], possession: [50, 50], yellows: [0, 0], reds: [0, 0],
    fouls: [0, 0], corners: [0, 0], penalties: [0, 0], freeKicks: [0, 0],
  };
  const attackCount: [number, number] = [0, 0];
  const scorers: Record<string, number> = {};
  const assists: Record<string, number> = {};
  const saves: Record<string, number> = {};
  const redded = new Set<string>();

  const push = (e: Omit<MatchEvent, 's'> & { s?: [number, number] }) => events.push({ ...e, s: e.s ?? [score[0], score[1]] });
  const sn = (id: string) => shortName(player(id).name);
  const other = (i: 0 | 1): 0 | 1 => (i === 0 ? 1 : 0);

  const pickBy = (side: Side, weight: (u: Unit) => number, exclude?: string): Unit => {
    const pool = side.onPitch.filter((u) => u.id !== exclude);
    return rng.weighted(pool.length ? pool : side.onPitch, weight);
  };
  const gkOf = (side: Side): Unit | undefined => side.onPitch.find((u) => u.role === 'GK');

  const strength = (side: Side, i: 0 | 1) => {
    const k = 1 - 0.06 * side.reds;
    return {
      att: (side.prof.att + attMod[i] + side.form * FORM_SD * 1.0) * k,
      mid: (side.prof.mid + side.form * FORM_SD * 0.7) * k,
      def: (side.prof.def + side.form * FORM_SD * 0.6) * k,
      gk: side.prof.gk,
    };
  };

  /** Resolves a shot from any source: goal, save, miss or post. */
  const shot = (att: 0|1, shooter: Unit, src: Source, pGoal: number, xg: number, label: number, opts2: { assist?: Unit; victim?: string } = {}) => {
    const dfnSide = sides[other(att)];
    const gk = gkOf(dfnSide);
    const k = gk ? shortName(player(gk.id).name) : 'The keeper';
    const pn = sn(shooter.id);
    const tName = names[att];
    stats.shots[att]++;
    stats.xg[att] += xg;

    if (rng.chance(pGoal)) {
      stats.onTarget[att]++;
      score[att]++;
      scorers[shooter.id] = (scorers[shooter.id] ?? 0) + 1;
      let assistId: string | undefined;
      let said: ReturnType<typeof say>;
      if (src === 'play' && rng.chance(0.78)) {
        const as = pickBy(sides[att], (u) => ROLE_ASSIST_W[u.role] * Math.pow(Math.max(u.eff, 30) / 80, 2), shooter.id);
        assistId = as.id;
        assists[as.id] = (assists[as.id] ?? 0) + 1;
        said = say('goalAssist', { p: pn, a: sn(as.id) });
      } else if (src === 'freekick') said = say('goalFk', { p: pn });
      else if (src === 'penalty') said = say('goalPen', { p: pn });
      else if (src === 'corner') said = say('goalCorner', { p: pn });
      else said = say('goal', { p: pn, t: tName });
      push({ t: label, type: 'goal', team: att, p: shooter.id, a: assistId, src, xg: Math.round(pGoal * 100) / 100, ...said });
      return;
    }

    // not a goal. How it fails depends on where it came from.
    let outcome: 'save' | 'miss' | 'post';
    if (src === 'play') {
      outcome = rng.chance(0.42 + (shooter.eff - 80) / 400) ? 'save' : rng.chance(0.14) ? 'post' : 'miss';
      // open-play non-goals are only shown when they were real chances
      if (!(xg > 0.12 || rng.chance(0.17))) {
        if (outcome === 'save') stats.onTarget[att]++;
        if (outcome === 'save' && gk) saves[gk.id] = (saves[gk.id] ?? 0) + 1;
        return;
      }
    } else if (src === 'penalty') {
      const pSave = clamp(0.58 + ((gk?.tr.pks ?? 0.2) - 0.2) * 0.5, 0.4, 0.8);
      const r = rng.next();
      outcome = r < pSave ? 'save' : r < pSave + 0.07 ? 'post' : 'miss';
    } else if (src === 'freekick') {
      const r = rng.next();
      outcome = r < 0.48 ? 'save' : r < 0.57 ? 'post' : 'miss';
    } else {
      const r = rng.next();
      outcome = r < 0.4 ? 'save' : r < 0.5 ? 'post' : 'miss';
    }
    if (outcome === 'save') {
      stats.onTarget[att]++;
      if (gk) saves[gk.id] = (saves[gk.id] ?? 0) + 1;
    }
    const key = (outcome + (src === 'play' ? '' : src === 'freekick' ? 'Fk' : src === 'penalty' ? 'Pen' : 'Corner')) as keyof typeof T;
    push({ t: label, type: outcome, team: att, p: shooter.id, src, xg: Math.round(pGoal * 100) / 100, ...say(key in T ? key : outcome, { p: pn, k }) });
  };

  const sendOff = (i: 0 | 1, u: Unit, label: number, second: boolean, victim?: string) => {
    const side = sides[i];
    side.onPitch = side.onPitch.filter((x) => x.id !== u.id);
    side.reds++;
    stats.reds[i]++;
    redded.add(u.id);
    push({
      t: label, type: 'red', team: i, p: u.id, v: victim,
      ...say(second ? 'red2' : 'red', { p: sn(u.id), t: names[i] }),
    });
  };

  const card = (i: 0 | 1, u: Unit, yellowP: number, redP: number, label: number, victim?: string) => {
    const side = sides[i];
    if (rng.chance(redP) && u.role !== 'GK' && side.onPitch.length > 8) return sendOff(i, u, label, false, victim);
    if (!rng.chance(yellowP)) return;
    if (side.yellowed.has(u.id)) {
      if (side.onPitch.length > 8 && u.role !== 'GK') sendOff(i, u, label, true, victim);
      return;
    }
    side.yellowed.add(u.id);
    stats.yellows[i]++;
    push({ t: label, type: 'yellow', team: i, p: u.id, v: victim, ...say('yellow', { p: sn(u.id), v: victim ? sn(victim) : 'an opponent' }) });
  };

  /** A foul by team `i`. Real tendencies decide who commits it and whether it is booked. */
  const foul = (i: 0 | 1, label: number) => {
    const side = sides[i];
    const opp = sides[other(i)];
    stats.fouls[i]++;
    const weight = (u: Unit) => YELLOW_PER_90[ROLE_TO_POS[u.role]] * u.tr.disc;
    let fouler = pickBy(side, weight);
    // a player already on a yellow usually thinks twice
    if (side.yellowed.has(fouler.id) && rng.chance(0.88)) fouler = pickBy(side, (u) => (side.yellowed.has(u.id) ? 0 : weight(u)));
    const victim = pickBy(opp, (u) => ROLE_ASSIST_W[u.role] * (u.role === 'GK' ? 0 : 1));
    const attTilt = clamp(1 + (strength(opp, other(i)).att - strength(side, i).def) / 80, 0.7, 1.4);
    const r = rng.next();
    const j = other(i);
    if (r < PEN_PER_FOUL * attTilt) {
      const takers = opp.onPitch.filter((u) => u.role !== 'GK');
      const taker = rng.weighted(takers, (u) => Math.pow(u.tr.pk, 6));
      stats.penalties[j]++;
      push({ t: label, type: 'penalty', team: j, p: taker.id, v: victim.id, src: 'penalty', ...say('pen', { v: sn(victim.id), t: names[j] }) });
      card(i, fouler, 0.3, 0.05, label, victim.id);
      const gk = gkOf(side);
      const pGoal = clamp(PEN_CONVERSION + (taker.tr.pk - 0.55) * 0.3 - ((gk?.tr.pks ?? 0.2) - 0.2) * 0.3, 0.5, 0.95);
      shot(j, taker, 'penalty', pGoal, pGoal, label, { victim: victim.id });
    } else if (r < (PEN_PER_FOUL * attTilt) + FK_PER_FOUL) {
      const takers = opp.onPitch.filter((u) => u.role !== 'GK');
      const taker = rng.weighted(takers, (u) => Math.pow(0.05 + u.tr.fk, 3) * (u.eff / 80));
      stats.freeKicks[j]++;
      push({ t: label, type: 'freekick', team: j, p: taker.id, v: victim.id, src: 'freekick', ...say('fk', { p: sn(taker.id), v: sn(victim.id), t: names[j] }) });
      card(i, fouler, YELLOW_PER_FOUL * 1.1, RED_PER_FOUL, label, victim.id);
      const gk = gkOf(side);
      const gkF = clamp(1 - ((gk?.eff ?? 40) - 80) / 140, 0.55, 1.5);
      const pGoal = clamp(0.055 * (0.4 + taker.tr.fk * 1.1) * gkF, 0.01, 0.2);
      shot(j, taker, 'freekick', pGoal, pGoal, label);
    } else {
      card(i, fouler, YELLOW_PER_FOUL, RED_PER_FOUL, label, victim.id);
    }
  };

  const playMinute = (label: number, tempoScale: number) => {
    const [sa, sb] = sides;
    const A = strength(sa, 0);
    const B = strength(sb, 1);

    // fouls (cards, free kicks and penalties all start here)
    for (const i of [0, 1] as const) {
      const mine = i === 0 ? A : B;
      const theirs = i === 0 ? B : A;
      const pressure = 1 + clamp((theirs.mid - mine.mid) / 80, -0.2, 0.25);
      if (rng.chance(FOUL_RATE * sides[i].prof.aggression * pressure)) foul(i, label);
    }

    const tempo = ((sa.prof.tempo + sb.prof.tempo) / 2) * tempoScale;
    if (!rng.chance(clamp(0.62 * tempo, 0.1, 0.9))) return;

    // who has the ball
    const pA = sigmoid((A.mid - B.mid) / 14);
    const att: 0 | 1 = rng.chance(0.5 + (pA - 0.5) * 0.8) ? 0 : 1;
    attackCount[att]++;
    const atk = att === 0 ? A : B;
    const dfn = att === 0 ? B : A;
    const atkSide = sides[att];
    const dfnSide = sides[other(att)];

    // is a chance created?
    const pChance = clamp(0.45 + (atk.att - dfn.def) / 58, 0.18, 0.78);
    if (!rng.chance(pChance)) {
      if (rng.chance(CORNER_SHOT_PER_ATTACK)) {
        const header = pickBy(atkSide, (u) => ROLE_HEAD_W[u.role] * Math.pow(Math.max(u.eff, 30) / 80, 3));
        const gk = gkOf(dfnSide);
        const gkF = clamp(1 - ((gk?.eff ?? 40) - 80) / 140, 0.55, 1.5);
        const pGoal = clamp(0.085 * (1 + (header.eff - 80) / 110) * gkF, 0.01, 0.4);
        stats.corners[att]++;
        push({ t: label, type: 'corner', team: att, p: header.id, src: 'corner', ...say('corner', { t: names[att] }) });
        shot(att, header, 'corner', pGoal, pGoal, label);
      }
      return;
    }

    const shooter = pickBy(atkSide, (u) => ROLE_SCORE_W[u.role] * Math.pow(Math.max(u.eff, 30) / 80, 4));
    const gk = gkOf(dfnSide);
    const gkEff = gk ? gk.eff : 40;
    const base = clamp(OPEN_QUALITY + (atk.att - dfn.def) / 560 + rng.normal() * 0.022, 0.025, 0.4);
    // chances are not all alike: most are speculative, some are good, a few are clear-cut. The average is unchanged, so goals
    // per match are too; what changes is that the live view can honestly say "big chance".
    const kind = rng.next();
    const quality = clamp(base * (kind < 0.7 ? 0.55 : kind < 0.94 ? 1.6 : 4), 0.02, 0.62);
    const shooterF = 1 + (shooter.eff - 80) / 110;
    const gkF = clamp(1 - (gkEff - 80) / 140, 0.55, 1.5);
    const pGoal = clamp(quality * shooterF * gkF, 0.01, 0.65);
    shot(att, shooter, 'play', pGoal, quality * shooterF, label);
  };

  push({ t: 0, type: 'kickoff', team: 0, text: `Kick-off: ${names[0]} v ${names[1]}.`, tk: 'kickoff', tv: { a: names[0], b: names[1] } });
  const stoppage1 = 1 + rng.int(3);
  const stoppage2 = 2 + rng.int(4);
  for (let m = 1; m <= 45 + stoppage1; m++) playMinute(m > 45 ? 45 : m, 1);
  push({ t: 45, type: 'half', team: 0, text: `Half-time: ${names[0]} ${score[0]}-${score[1]} ${names[1]}.`, tk: 'half', tv: { a: names[0], b: names[1], x: String(score[0]), y: String(score[1]) } });
  for (let m = 46; m <= 90 + stoppage2; m++) playMinute(m > 90 ? 90 : m, 1);
  push({ t: 90, type: 'full', team: 0, text: `Full-time: ${names[0]} ${score[0]}-${score[1]} ${names[1]}.`, tk: 'full', tv: { a: names[0], b: names[1], x: String(score[0]), y: String(score[1]) } });

  let went: MatchResult['went'] = 'ft';
  let pens: [number, number] | null = null;
  let winner: 0 | 1 | null = score[0] > score[1] ? 0 : score[1] > score[0] ? 1 : null;

  if (winner === null && opts.knockout) {
    went = 'et';
    push({ t: 91, type: 'et', team: 0, text: 'Level after 90. Extra time.', tk: 'et', tv: {} });
    for (let m = 91; m <= 120; m++) playMinute(m, 0.78);
    push({ t: 120, type: 'etend', team: 0, text: `After extra time: ${score[0]}-${score[1]}.`, tk: 'etend', tv: { x: String(score[0]), y: String(score[1]) } });
    winner = score[0] > score[1] ? 0 : score[1] > score[0] ? 1 : null;
    if (winner === null) {
      went = 'pens';
      const sh: [number, number] = [0, 0];
      push({ t: 121, type: 'shootout', team: 0, s: [0, 0], text: 'Penalties. Nerves of steel required.', tk: 'shootout', tv: {} });
      // best penalty takers first (outfield before the keeper)
      const takers = ([0, 1] as const).map((i) =>
        sides[i].onPitch.slice().sort((a, b) => (a.role === 'GK' ? 1 : 0) - (b.role === 'GK' ? 1 : 0) || b.tr.pk - a.tr.pk || b.eff - a.eff),
      );
      const kick = (i: 0 | 1, n: number) => {
        const list = takers[i]!;
        const taker = list[n % list.length]!;
        const keeper = gkOf(sides[other(i)]);
        const pc = clamp(PEN_CONVERSION + (taker.tr.pk - 0.55) * 0.3 - ((keeper?.tr.pks ?? 0.2) - 0.2) * 0.25, 0.5, 0.93);
        const scored = rng.chance(pc);
        if (scored) sh[i]++;
        push({
          t: 121 + n, type: scored ? 'pen_goal' : 'pen_miss', team: i, p: taker.id, s: [sh[0], sh[1]],
          text: scored ? `${sn(taker.id)} scores. ${sh[0]}-${sh[1]}.` : `${sn(taker.id)} misses! ${sh[0]}-${sh[1]}.`,
          tk: scored ? 'pen_goal' : 'pen_miss', tv: { p: sn(taker.id), x: String(sh[0]), y: String(sh[1]) },
        });
      };
      let round = 0;
      for (; round < 5; round++) {
        kick(0, round);
        if (decided(sh, round, 0)) break;
        kick(1, round);
        if (decided(sh, round, 1)) break;
      }
      let guard = 0;
      while (sh[0] === sh[1] && guard++ < 40) {
        round++;
        kick(0, round);
        kick(1, round);
      }
      if (sh[0] === sh[1]) sh[rng.int(2) as 0 | 1]++; // astronomically unlikely safety net
      pens = [sh[0], sh[1]];
      winner = sh[0] > sh[1] ? 0 : 1;
    }
  }

  // possession from attack share, nudged toward 50 so it reads like football
  const totalAtk = attackCount[0] + attackCount[1] || 1;
  const p0 = Math.round(clamp(50 + (attackCount[0] / totalAtk - 0.5) * 70, 28, 72));
  stats.possession = [p0, 100 - p0];
  stats.xg = [Math.round(stats.xg[0] * 100) / 100, Math.round(stats.xg[1] * 100) / 100];
  // corners that did not produce a shot are not simulated; the stat is filled in from territory so it reads like a real match
  stats.corners = [
    Math.max(stats.corners[0], Math.round(attackCount[0] * 0.17)),
    Math.max(stats.corners[1], Math.round(attackCount[1] * 0.17)),
  ];

  // man of the match
  const rows: Array<{ id: string; team: 0 | 1; score: number; reason: string }> = [];
  for (const i of [0, 1] as const) {
    const cleanSheet = score[other(i)]! === 0;
    for (const u of sides[i].units) {
      const g = scorers[u.id] ?? 0;
      const a = assists[u.id] ?? 0;
      const sv = saves[u.id] ?? 0;
      let sc = g * 3 + a * 1.6 + sv * 0.45 + u.eff / 200;
      let reason = g ? `${g} goal${g > 1 ? 's' : ''}` : a ? `${a} assist${a > 1 ? 's' : ''}` : 'solid all-round display';
      if (cleanSheet && (u.role === 'GK' || u.role === 'CB')) {
        sc += 1.6;
        if (!g && !a) reason = u.role === 'GK' ? `clean sheet and ${sv} save${sv === 1 ? '' : 's'}` : 'rock-solid at the back';
      }
      if (u.role === 'GK' && sv >= 4 && !g) reason = `${sv} saves`;
      if (redded.has(u.id)) sc -= 3;
      if (winner === i) sc += 0.6;
      rows.push({ id: u.id, team: i, score: sc, reason });
    }
  }
  rows.sort((x, y) => y.score - x.score || player(y.id).ovr - player(x.id).ovr);
  const top = rows[0]!;

  const result: MatchResult = {
    score: [score[0], score[1]],
    pens,
    went,
    winner,
    events,
    stats,
    motm: { team: top.team, player: top.id, reason: top.reason },
    headline: '',
    overall: [profs[0].overall, profs[1].overall],
  };
  result.headline = headlineFor(result, names, rng.fork('headline'));
  return result;
}

/** shootout is decided early when one side cannot be caught within the first five kicks */
function decided(sh: [number, number], round: number, kicker: 0 | 1): boolean {
  const takenA = round + 1;
  const takenB = kicker === 0 ? round : round + 1;
  const leftA = 5 - takenA;
  const leftB = 5 - takenB;
  return sh[0] > sh[1] + leftB || sh[1] > sh[0] + leftA;
}

function headlineFor(r: MatchResult, names: [string, string], rng: Rng): string {
  const [a, b] = r.score;
  const diff = Math.abs(a - b);
  const w = r.winner;
  const wn = w === null ? '' : names[w];
  const ln = w === null ? '' : names[1 - w];
  const total = a + b;
  const gap = r.overall[0] - r.overall[1];
  const favourite: 0 | 1 = gap >= 0 ? 0 : 1;
  const upset = w !== null && w !== favourite && Math.abs(gap) >= 5;
  const hatTrick = r.events.filter((e) => e.type === 'goal').reduce<Record<string, number>>((m, e) => {
    if (e.p) m[e.p] = (m[e.p] ?? 0) + 1;
    return m;
  }, {});
  const hat = Object.entries(hatTrick).find(([, n]) => n >= 3);
  const lastGoal = [...r.events].reverse().find((e) => e.type === 'goal');
  const lateWinner = !!lastGoal && lastGoal.t >= 85 && r.went === 'ft' && w !== null && lastGoal.team === w && diff === 1;
  const penDecider = !!lastGoal && lastGoal.src === 'penalty' && r.went === 'ft' && w !== null && lastGoal.team === w && diff === 1;
  const reds = r.stats.reds[0] + r.stats.reds[1];

  if (r.went === 'pens' && r.pens) return rng.pick([`${wn} survive the shootout, ${r.pens[w!]}-${r.pens[1 - w!]}`, `Penalty drama: ${wn} win it from the spot`, `${ln} heartbroken as ${wn} take it on penalties`]);
  if (hat) return `${shortName(player(hat[0]).name)} hat-trick sinks ${ln || 'the opposition'}`;
  if (upset) return rng.pick([`Shock! ${wn} topple the favourites`, `Giant-killing: ${wn} beat ${ln} against the odds`, `Upset of the day: ${wn} stun ${ln}`]);
  if (penDecider) return rng.pick([`A penalty decides it for ${wn}`, `${wn} win it from the spot`]);
  if (lateWinner) return rng.pick([`Last-gasp winner breaks ${ln} hearts`, `${wn} snatch it late`, `Stoppage-time drama as ${wn} edge it`]);
  if (w === null) return total === 0 ? 'Nil-nil: nothing to separate them' : rng.pick(['Honours even in a thriller', 'Share of the spoils', 'Everything level at the final whistle']);
  if (diff >= 4) return rng.pick([`${wn} run riot`, `Demolition: ${wn} ${Math.max(a, b)}-${Math.min(a, b)} ${ln}`, `${ln} torn apart: ${wn} are ruthless`]);
  if (diff >= 3) return rng.pick([`${wn} cruise past ${ln}`, `Comfortable night for ${wn}`, `${wn} too strong for ${ln}`]);
  if (reds >= 2) return rng.pick(['Red-card chaos as ' + wn + ' come out on top', `A feisty one: ${wn} take it`]);
  if (r.went === 'et') return rng.pick([`${wn} edge it in extra time`, `Extra-time winner sends ${wn} through`]);
  if (total >= 5) return rng.pick(["Goal-fest! Everyone gets their money's worth", `${wn} win a classic`]);
  if (total === 1) return rng.pick([`${wn} grind out a 1-0`, `One goal is enough for ${wn}`]);
  return rng.pick([`${wn} take the points`, `${wn} get the better of ${ln}`, `${wn} win a tight one`]);
}

/* ───────────── playback schedule (shared by server and client so they agree on timing) ───────────── */

export type Pace = 'normal' | 'quick';

export interface ScheduledEvent {
  /** when this moment starts, ms from kick-off */
  at: number;
  /** how long the moment plays before the clock may run on */
  dur: number;
  event: MatchEvent;
}

/**
 * The live view cuts to the players and the ball only for these: goals, penalties, red cards and real chances. Everything
 * else (a yellow card, a speculative shot, a routine free kick or corner) is told on the arrow with a short label, so quiet
 * play stays quiet and the highlights mean something.
 */
export function isHighlight(e: MatchEvent): boolean {
  switch (e.type) {
    case 'goal': case 'penalty': case 'red': case 'kickoff': case 'shootout': case 'pen_goal': case 'pen_miss':
      return true;
    case 'save': case 'miss': case 'post':
      return e.src === 'penalty' || (e.xg ?? 0.1) >= 0.12;
    default:
      return false; // yellow cards, free-kick and corner awards, half-time, full-time
  }
}
/** how long a minor moment's label stays up */
const MINOR_DUR: Partial<Record<EventType, number>> = { yellow: 1900, freekick: 1200, corner: 1100, save: 1500, miss: 1400, post: 1500 };

const DUR: Partial<Record<EventType, number>> = {
  kickoff: 1500, half: 2000, full: 2000, et: 2000, etend: 1600, shootout: 2400,
  goal: 5600, red: 3400, yellow: 2200, save: 3000, miss: 2500, post: 2800,
  freekick: 2400, penalty: 3200, corner: 2000, pen_goal: 2800, pen_miss: 2800,
};
const SRC_BONUS: Record<Source, number> = { play: 0, freekick: 300, penalty: 400, corner: 200 };

/** quiet stretches pass faster than real time, but the ball keeps moving at a calm pace: 1 minute ~0.45s, capped */
function gapMs(minutes: number): number {
  if (minutes <= 0) return 0;
  if (minutes <= 1) return 450 * minutes;
  return Math.min(3000, 450 + 150 * (minutes - 1));
}

/** A match should take about a minute and a half to watch, however many events it had. */
const TARGET_MS = { min: 74_000, max: 100_000 };

export function playbackSchedule(result: MatchResult, pace: Pace = 'normal'): { items: ScheduledEvent[]; totalMs: number; quiet: Array<[number, number]> } {
  const k = pace === 'quick' ? 0.62 : 1;
  const build = (gapScale: number, durScale = 1) => {
    const items: ScheduledEvent[] = [];
    const quiet: Array<[number, number]> = [];
    let at = 700 * k;
    let prevT = 0;
    let prevEnd = at;
    let gapSum = 0;
    for (const e of result.events) {
      const shootout = e.type.startsWith('pen_') || e.type === 'shootout';
      const g = shootout ? 0 : gapMs(Math.max(0, e.t - prevT)) * k * gapScale;
      gapSum += g;
      if (g > 400 * k) quiet.push([prevEnd, prevEnd + g]);
      at = prevEnd + g;
      const dur = ((isHighlight(e) || !(e.type in MINOR_DUR) ? (DUR[e.type] ?? 1500) + (e.src ? SRC_BONUS[e.src] : 0) : MINOR_DUR[e.type]!) * k * durScale);
      items.push({ at, dur, event: e });
      prevEnd = at + dur;
      if (e.t <= 120) prevT = e.t;
    }
    return { items, quiet, gapSum, totalMs: prevEnd + 2200 * k };
  };
  let r = build(1);
  if (r.gapSum > 0) {
    if (r.totalMs < TARGET_MS.min * k) r = build(Math.min(4, 1 + (TARGET_MS.min * k - r.totalMs) / r.gapSum));
    else if (r.totalMs > TARGET_MS.max * k) r = build(Math.max(0.35, 1 - (r.totalMs - TARGET_MS.max * k) / r.gapSum));
  }
  // a very busy match: even with the shortest gaps the moments add up, so trim them a little too (never below 70%)
  if (r.totalMs > TARGET_MS.max * k * 1.04) {
    const gs = r.gapSum > 0 ? Math.max(0.35, 1 - (r.totalMs - TARGET_MS.max * k) / r.gapSum) : 1;
    r = build(Math.min(1, gs), Math.max(0.7, (TARGET_MS.max * k) / r.totalMs));
  }
  return { items: r.items, totalMs: r.totalMs, quiet: r.quiet };
}
