import { FORMATIONS, effectiveOvr, type Role } from './formations';
import { Rng } from './rng';
import { player, shortName } from './players';
import { profile, type Profile, type Squad } from './squad';

export type EventType =
  | 'kickoff'
  | 'save'
  | 'miss'
  | 'post'
  | 'goal'
  | 'yellow'
  | 'red'
  | 'half'
  | 'full'
  | 'et'
  | 'etend'
  | 'shootout'
  | 'pen_goal'
  | 'pen_miss';

export interface MatchEvent {
  /** minute 0..120 (shootout events use 121+) */
  t: number;
  type: EventType;
  /** team the event is about: scorer / carded player / penalty taker */
  team: 0 | 1;
  p?: string;
  a?: string;
  /** score after this event; for pen_* the shootout score */
  s: [number, number];
  text: string;
}

export interface MatchStats {
  shots: [number, number];
  onTarget: [number, number];
  xg: [number, number];
  possession: [number, number];
  yellows: [number, number];
  reds: [number, number];
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
const ROLE_FOUL_W: Record<Role, number> = {
  GK: 0.2, CB: 3, LB: 2, RB: 2, LWB: 2, RWB: 2, CDM: 3.4, CM: 2.2, LM: 1.2, RM: 1.2, CAM: 1, LW: 0.8, RW: 0.8, ST: 1.1,
};

interface Unit {
  id: string;
  role: Role;
  eff: number;
}

function units(sq: Squad): Unit[] {
  return FORMATIONS[sq.formation].slots
    .map((s) => ({ id: sq.slots[s.id] ?? '', role: s.role, eff: 0 }))
    .filter((u) => u.id)
    .map((u) => ({ ...u, eff: effectiveOvr(u.id, u.role) }));
}

/** match-day form: one normal draw per team per match, scaled to rating points */
const FORM_SD = 2.8;
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

interface Side {
  prof: Profile;
  units: Unit[];
  /** players still on the pitch */
  onPitch: Unit[];
  reds: number;
  yellowed: Set<string>;
  form: number;
}

const TEMPLATES = {
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
  save: [
    '{k} gets down brilliantly to stop {p}.',
    '{p} lets fly, but {k} palms it away.',
    'Big save from {k}! {p} cannot believe it.',
    '{k} tips {p}\'s effort around the post.',
  ],
  miss: [
    '{p} had the chance and blazes it over.',
    '{p} drags it wide from a good position.',
    'Wasteful from {p}. That was there to be hit.',
    '{p} goes for power and loses control of it.',
  ],
  post: [
    '{p} rattles the woodwork!',
    'Off the post! {p} is inches away.',
    '{p} hits the bar. So close.',
  ],
  yellow: ['{p} goes into the book.', 'Yellow card for {p} after a late challenge.', '{p} is booked for dissent.'],
  red: ['RED CARD! {p} is sent off.', '{p} sees red. {t} are down to ten.', 'Straight red for {p}. Disaster.'],
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
  };
  const attackCount: [number, number] = [0, 0];
  const scorers: Record<string, number> = {};
  const assists: Record<string, number> = {};
  const saves: Record<string, number> = {};
  const redded = new Set<string>();

  const push = (e: Omit<MatchEvent, 's'> & { s?: [number, number] }) =>
    events.push({ ...e, s: e.s ?? [score[0], score[1]] });

  const pickBy = (side: Side, weight: (u: Unit) => number, exclude?: string): Unit => {
    const pool = side.onPitch.filter((u) => u.id !== exclude);
    return rng.weighted(pool.length ? pool : side.onPitch, weight);
  };

  const gkOf = (side: Side): Unit | undefined => side.onPitch.find((u) => u.role === 'GK');

  const playMinute = (minute: number, tempoScale: number, label: number) => {
    const [sa, sb] = sides;
    // current strength with red-card penalty (-6% per man down on all lines)
    const strength = (side: Side, i: 0 | 1) => {
      const k = 1 - 0.06 * side.reds;
      return {
        att: (side.prof.att + attMod[i] + side.form * FORM_SD * 1.0) * k,
        mid: (side.prof.mid + side.form * FORM_SD * 0.7) * k,
        def: (side.prof.def + side.form * FORM_SD * 0.6) * k,
        gk: side.prof.gk,
      };
    };
    const A = strength(sa, 0);
    const B = strength(sb, 1);
    const tempo = ((sa.prof.tempo + sb.prof.tempo) / 2) * tempoScale;
    if (!rng.chance(clamp(0.62 * tempo, 0.1, 0.9))) return;

    // who has the ball
    const pA = sigmoid((A.mid - B.mid) / 14);
    const att: 0 | 1 = rng.chance(0.5 + (pA - 0.5) * 0.8) ? 0 : 1;
    attackCount[att]++;
    const atk = att === 0 ? A : B;
    const dfn = att === 0 ? B : A;
    const atkSide = sides[att];
    const dfnSide = sides[att === 0 ? 1 : 0];

    // is a chance created?
    const pChance = clamp(0.45 + (atk.att - dfn.def) / 58, 0.18, 0.78);
    if (!rng.chance(pChance)) return;

    const shooter = pickBy(atkSide, (u) => ROLE_SCORE_W[u.role] * Math.pow(Math.max(u.eff, 30) / 80, 4));
    stats.shots[att]++;

    const gk = gkOf(dfnSide);
    const gkEff = gk ? gk.eff : 40;
    const quality = clamp(0.1 + (atk.att - dfn.def) / 480 + rng.normal() * 0.025, 0.03, 0.4);
    const shooterF = 1 + (shooter.eff - 80) / 110;
    const gkF = clamp(1 - (gkEff - 80) / 140, 0.55, 1.5);
    const pGoal = clamp(quality * shooterF * gkF, 0.01, 0.65);
    stats.xg[att] += quality * shooterF;

    const roll = rng.next();
    const tName = names[att];
    const pName = shortName(player(shooter.id).name);
    if (roll < pGoal) {
      stats.onTarget[att]++;
      score[att]++;
      scorers[shooter.id] = (scorers[shooter.id] ?? 0) + 1;
      let assistId: string | undefined;
      if (rng.chance(0.78)) {
        const as = pickBy(atkSide, (u) => ROLE_ASSIST_W[u.role] * Math.pow(Math.max(u.eff, 30) / 80, 2), shooter.id);
        assistId = as.id;
        assists[as.id] = (assists[as.id] ?? 0) + 1;
      }
      const text = assistId
        ? fill(rng.pick(TEMPLATES.goalAssist), { p: pName, a: shortName(player(assistId).name) })
        : fill(rng.pick(TEMPLATES.goal), { p: pName, t: tName });
      push({ t: label, type: 'goal', team: att, p: shooter.id, a: assistId, text });
      return;
    }
    // not a goal: on target (save), woodwork or off target
    const onT = rng.chance(0.42 + (shooter.eff - 80) / 400);
    if (onT) {
      stats.onTarget[att]++;
      if (gk) saves[gk.id] = (saves[gk.id] ?? 0) + 1;
      if (quality * shooterF > 0.11 || rng.chance(0.3)) {
        push({
          t: label, type: 'save', team: att, p: shooter.id,
          text: fill(rng.pick(TEMPLATES.save), { p: pName, k: gk ? shortName(player(gk.id).name) : 'The keeper' }),
        });
      }
    } else if (rng.chance(0.14)) {
      push({ t: label, type: 'post', team: att, p: shooter.id, text: fill(rng.pick(TEMPLATES.post), { p: pName }) });
    } else if (quality * shooterF > 0.12 || rng.chance(0.2)) {
      push({ t: label, type: 'miss', team: att, p: shooter.id, text: fill(rng.pick(TEMPLATES.miss), { p: pName }) });
    }
  };

  const cardCheck = (minute: number, label: number) => {
    for (const i of [0, 1] as const) {
      const side = sides[i];
      const aggr = side.prof.aggression;
      if (rng.chance(0.021 * aggr)) {
        // players who are already on a yellow tone it down most of the time
        let u = pickBy(side, (x) => ROLE_FOUL_W[x.role]);
        if (side.yellowed.has(u.id) && rng.chance(0.85)) u = pickBy(side, (x) => (side.yellowed.has(x.id) ? 0 : ROLE_FOUL_W[x.role]));
        if (side.yellowed.has(u.id)) {
          // second yellow
          side.onPitch = side.onPitch.filter((x) => x.id !== u.id);
          side.reds++;
          stats.reds[i]++;
          redded.add(u.id);
          push({ t: label, type: 'red', team: i, p: u.id, text: fill(rng.pick(TEMPLATES.red), { p: shortName(player(u.id).name), t: names[i] }) });
        } else {
          side.yellowed.add(u.id);
          stats.yellows[i]++;
          push({ t: label, type: 'yellow', team: i, p: u.id, text: fill(rng.pick(TEMPLATES.yellow), { p: shortName(player(u.id).name) }) });
        }
      } else if (rng.chance(0.0004 * aggr) && side.onPitch.length > 8) {
        const u = pickBy(side, (x) => (x.role === 'GK' ? 0 : ROLE_FOUL_W[x.role]));
        side.onPitch = side.onPitch.filter((x) => x.id !== u.id);
        side.reds++;
        stats.reds[i]++;
        redded.add(u.id);
        push({ t: label, type: 'red', team: i, p: u.id, text: fill(rng.pick(TEMPLATES.red), { p: shortName(player(u.id).name), t: names[i] }) });
      }
    }
  };

  push({ t: 0, type: 'kickoff', team: 0, text: `Kick-off: ${names[0]} v ${names[1]}.` });
  const stoppage1 = 1 + rng.int(3);
  const stoppage2 = 2 + rng.int(4);
  for (let m = 1; m <= 45 + stoppage1; m++) {
    const label = m > 45 ? 45 : m;
    playMinute(m, 1, label);
    cardCheck(m, label);
  }
  push({ t: 45, type: 'half', team: 0, text: `Half-time: ${names[0]} ${score[0]}-${score[1]} ${names[1]}.` });
  for (let m = 46; m <= 90 + stoppage2; m++) {
    const label = m > 90 ? 90 : m;
    playMinute(m, 1, label);
    cardCheck(m, label);
  }
  push({ t: 90, type: 'full', team: 0, text: `Full-time: ${names[0]} ${score[0]}-${score[1]} ${names[1]}.` });

  let went: MatchResult['went'] = 'ft';
  let pens: [number, number] | null = null;
  let winner: 0 | 1 | null = score[0] > score[1] ? 0 : score[1] > score[0] ? 1 : null;

  if (winner === null && opts.knockout) {
    went = 'et';
    push({ t: 91, type: 'et', team: 0, text: 'Level after 90. Extra time.' });
    for (let m = 91; m <= 120; m++) {
      playMinute(m, 0.78, m);
      if (m % 3 === 0) cardCheck(m, m);
    }
    push({ t: 120, type: 'etend', team: 0, text: `After extra time: ${score[0]}-${score[1]}.` });
    winner = score[0] > score[1] ? 0 : score[1] > score[0] ? 1 : null;
    if (winner === null) {
      went = 'pens';
      const sh: [number, number] = [0, 0];
      push({ t: 121, type: 'shootout', team: 0, s: [0, 0], text: 'Penalties. Nerves of steel required.' });
      // order takers by finishing quality (outfield first, keeper last)
      const takers = ([0, 1] as const).map((i) =>
        sides[i].onPitch
          .slice()
          .sort((a, b) => (b.role === 'GK' ? -1 : 0) - (a.role === 'GK' ? -1 : 0) || b.eff - a.eff),
      );
      const kick = (i: 0 | 1, n: number) => {
        const list = takers[i]!;
        const taker = list[n % list.length]!;
        const keeper = gkOf(sides[1 - i as 0 | 1]);
        const pc = clamp(0.77 + (taker.eff - 80) / 220 - ((keeper?.eff ?? 70) - 80) / 380, 0.55, 0.93);
        const scored = rng.chance(pc);
        if (scored) sh[i]++;
        push({
          t: 121 + n, type: scored ? 'pen_goal' : 'pen_miss', team: i, p: taker.id, s: [sh[0], sh[1]],
          text: scored
            ? `${shortName(player(taker.id).name)} scores. ${sh[0]}-${sh[1]}.`
            : `${shortName(player(taker.id).name)} misses! ${sh[0]}-${sh[1]}.`,
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

  // man of the match
  const rows: Array<{ id: string; team: 0 | 1; score: number; reason: string }> = [];
  for (const i of [0, 1] as const) {
    const cleanSheet = score[1 - i]! === 0;
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

  if (r.went === 'pens' && r.pens) return rng.pick([`${wn} survive the shootout, ${r.pens[w!]}-${r.pens[1 - w!]}`, `Penalty drama: ${wn} win it from the spot`, `${ln} heartbroken as ${wn} take it on penalties`]);
  if (hat) return `${shortName(player(hat[0]).name)} hat-trick sinks ${ln || 'the opposition'}`;
  if (upset) return rng.pick([`Shock! ${wn} topple the favourites`, `Giant-killing: ${wn} beat ${ln} against the odds`, `Upset of the day: ${wn} stun ${ln}`]);
  if (lateWinner) return rng.pick([`Last-gasp winner breaks ${ln} hearts`, `${wn} snatch it late`, `Stoppage-time drama as ${wn} edge it`]);
  if (w === null) return total === 0 ? 'Nil-nil: nothing to separate them' : rng.pick(['Honours even in a thriller', 'Share of the spoils', 'Everything level at the final whistle']);
  if (diff >= 4) return rng.pick([`${wn} run riot`, `Demolition: ${wn} ${Math.max(a, b)}-${Math.min(a, b)} ${ln}`, `${ln} tear-down: ${wn} are ruthless`]);
  if (diff >= 3) return rng.pick([`${wn} cruise past ${ln}`, `Comfortable night for ${wn}`, `${wn} too strong for ${ln}`]);
  if (r.went === 'et') return rng.pick([`${wn} edge it in extra time`, `Extra-time winner sends ${wn} through`]);
  if (total >= 5) return rng.pick(['Goal-fest! Everyone gets their money\'s worth', `${wn} win a classic`]);
  if (total === 1) return rng.pick([`${wn} grind out a 1-0`, `One goal is enough for ${wn}`]);
  return rng.pick([`${wn} take the points`, `${wn} get the better of ${ln}`, `${wn} win a tight one`]);
}

/* ───────────── playback schedule (shared by server and client so they agree on timing) ───────────── */

export interface ScheduledEvent {
  at: number;
  event: MatchEvent;
}

const MS_PER_MINUTE = 150;
const PAUSE: Partial<Record<EventType, number>> = {
  kickoff: 900, half: 1800, full: 1800, et: 1800, etend: 1500, shootout: 2000,
  goal: 3000, red: 1600, yellow: 900, save: 1300, miss: 1100, post: 1300, pen_goal: 1500, pen_miss: 1500,
};

export function playbackSchedule(result: MatchResult): { items: ScheduledEvent[]; totalMs: number } {
  const items: ScheduledEvent[] = [];
  let at = 600;
  let prevT = 0;
  let prevPause = 0;
  for (const e of result.events) {
    const gap = e.type.startsWith('pen_') || e.type === 'shootout' ? 0 : Math.max(0, e.t - prevT);
    at += prevPause + gap * MS_PER_MINUTE;
    items.push({ at, event: e });
    prevT = e.t >= 121 ? prevT : e.t;
    prevPause = PAUSE[e.type] ?? 800;
  }
  return { items, totalMs: at + prevPause + 1800 };
}
