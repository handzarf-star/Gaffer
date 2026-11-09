import { useCallback, useEffect, useMemo, useState } from 'react';
import { BRAND } from '../../shared/brand';
import { CUP_STAGES, buildOpponent, cupBoard, dailyLabel, dailySeed } from '../../shared/cup';
import { ROUNDS, placePlayer, type RatingsMode } from '../../shared/draft';
import { FORMATIONS, FORMATION_IDS, type FormationId } from '../../shared/formations';
import { POOLS, player, type PoolId } from '../../shared/players';
import { hashSeed, randomSeed } from '../../shared/rng';
import { simulateMatch } from '../../shared/sim';
import { autoArrange, changeFormation, emptySquad, profile, swapSlots, type Squad, type StyleId } from '../../shared/squad';
import { Confetti } from '../components/Confetti';
import { Pitch } from '../components/Pitch';
import { Button, Icon, Seg, cx, shareOrCopy } from '../components/ui';
import { navigate, useScrollTop } from '../lib/hooks';
import { sfx } from '../lib/sfx';
import { lsGet, lsSet } from '../lib/storage';
import { DraftScreen } from './DraftScreen';
import { MatchPlayer } from './MatchPlayer';
import { SetupScreen } from './SetupScreen';

type Mode = 'cup' | 'daily';

interface Result {
  stage: number;
  opp: string;
  score: [number, number];
  pens: [number, number] | null;
  won: boolean;
  headline: string;
}

interface Save {
  v: 1;
  mode: Mode;
  seed: string;
  pool: PoolId;
  ratings: RatingsMode;
  phase: 'intro' | 'draft' | 'setup' | 'match' | 'over';
  round: number;
  squad: Squad;
  stage: number;
  results: Result[];
  status: 'alive' | 'out' | 'champion';
  matchStartedAt: number | null;
}

const POOL_IDS: PoolId[] = ['modern', 'legends', 'all'];
const keyFor = (mode: Mode, seed: string) => (mode === 'daily' ? `daily:${seed}` : 'cup:current');

function fresh(mode: Mode): Save {
  const seed = mode === 'daily' ? dailySeed() : randomSeed();
  return {
    v: 1,
    mode,
    seed,
    pool: mode === 'daily' ? POOL_IDS[hashSeed(seed) % 3]! : lsGet<PoolId>('cup:pool', 'modern'),
    ratings: lsGet<RatingsMode>('cup:ratings', 'tier'),
    phase: 'intro',
    round: 1,
    squad: emptySquad(lsGet<FormationId>('cup:formation', '433')),
    stage: 0,
    results: [],
    status: 'alive',
    matchStartedAt: null,
  };
}

function load(mode: Mode): Save {
  const base = fresh(mode);
  const saved = lsGet<Save | null>(keyFor(mode, base.seed), null);
  if (saved && saved.v === 1 && saved.mode === mode && (mode === 'cup' || saved.seed === base.seed)) return saved;
  return base;
}

export function CupPage({ mode }: { mode: Mode }) {
  const [s, setS] = useState<Save>(() => load(mode));
  const update = useCallback((patch: Partial<Save> | ((x: Save) => Save)) => {
    setS((cur) => {
      const next = typeof patch === 'function' ? patch(cur) : { ...cur, ...patch };
      lsSet(keyFor(mode, next.seed), next);
      return next;
    });
  }, [mode]);

  useScrollTop(`${s.phase}:${s.stage}`);
  const opp = useMemo(() => (s.phase === 'setup' || s.phase === 'match' ? buildOpponent(s.seed, s.stage, s.pool) : null), [s.phase, s.stage, s.seed, s.pool]);
  const board = useMemo(() => (s.phase === 'draft' ? cupBoard(s.seed, s.pool, s.round, s.squad) : []), [s.phase, s.seed, s.pool, s.round, s.squad]);

  const start = () => {
    lsSet('cup:formation', s.squad.formation);
    if (mode === 'cup') { lsSet('cup:pool', s.pool); }
    lsSet('cup:ratings', s.ratings);
    sfx.whistle();
    update({ phase: 'draft', round: 1, squad: emptySquad(s.squad.formation) });
  };

  const onPick = (card: string, slot: string) => {
    update((cur) => {
      const next = placePlayer(cur.squad, slot, card);
      if (!next) return cur;
      if (cur.round >= ROUNDS) return { ...cur, squad: autoArrange(next), phase: 'setup', round: ROUNDS };
      return { ...cur, squad: next, round: cur.round + 1 };
    });
  };

  const newRun = () => {
    const f = fresh('cup');
    f.squad = emptySquad(s.squad.formation);
    f.pool = s.pool;
    f.ratings = s.ratings;
    lsSet(keyFor('cup', f.seed), f);
    setS(f);
  };

  /* ───────── screens ───────── */

  if (s.phase === 'intro') {
    return (
      <div className="intro panel">
        <p className="eyebrow">{mode === 'daily' ? `Daily Draft · ${dailyLabel(s.seed)}` : 'Solo Cup'}</p>
        <h1>{mode === 'daily' ? 'Same packs for everyone today' : 'Win four knockout rounds'}</h1>
        <p className="muted">
          {mode === 'daily'
            ? 'Everyone in the world gets the identical packs and opponents today. Compare how far you got with your mates.'
            : 'Draft an XI from 11 packs, then beat four AI sides in a row. Fresh packs every run.'}
        </p>
        <div className="setting">
          <label>Player pool</label>
          {mode === 'daily' ? (
            <p><b>{POOLS[s.pool].name}</b> <span className="muted">is today's pool</span></p>
          ) : (
            <div className="opts opts--3">
              {POOL_IDS.map((id) => (
                <button key={id} className={cx('opt', s.pool === id && 'is-on')} onClick={() => update({ pool: id })} aria-pressed={s.pool === id}>
                  <b>{POOLS[id].name}</b><span>{POOLS[id].blurb}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="setting setting--inline">
          <div>
            <label>Ratings on cards</label>
            <Seg<RatingsMode> label="Ratings" value={s.ratings} onChange={(v) => update({ ratings: v })} options={[{ value: 'hidden', label: 'Hidden' }, { value: 'tier', label: 'Stars' }, { value: 'full', label: 'Numbers' }]} />
          </div>
          <div>
            <label>Formation</label>
            <Seg<string> label="Formation" value={s.squad.formation} onChange={(v) => update({ squad: emptySquad(v as FormationId) })} options={FORMATION_IDS.map((id) => ({ value: id, label: FORMATIONS[id].name }))} />
          </div>
        </div>
        <div className="row">
          <Button variant="primary" size="lg" icon="play" onClick={start}>Start drafting</Button>
          <Button variant="ghost" onClick={() => navigate('/')}>Back</Button>
        </div>
      </div>
    );
  }

  if (s.phase === 'draft') {
    return (
      <DraftScreen
        round={s.round}
        board={board}
        mode={s.ratings}
        squad={s.squad}
        turn="all"
        canPick
        shared={false}
        deadline={null}
        offset={0}
        pickMs={0}
        rivals={[]}
        log={[]}
        onPick={onPick}
        subtitle={mode === 'daily' ? `Daily ${dailyLabel(s.seed)}` : 'Solo Cup'}
      />
    );
  }

  if (s.phase === 'setup' && opp) {
    return (
      <SetupScreen
        squad={s.squad}
        mode={s.ratings}
        deadline={null}
        offset={0}
        totalMs={0}
        ready={false}
        rivals={[]}
        onFormation={(f) => update((c) => ({ ...c, squad: changeFormation(c.squad, f) }))}
        onSwap={(a, b) => update((c) => ({ ...c, squad: swapSlots(c.squad, a, b) }))}
        onArrange={() => update((c) => ({ ...c, squad: autoArrange(c.squad) }))}
        onStyle={(st: StyleId) => update((c) => ({ ...c, squad: { ...c.squad, style: st } }))}
        onReady={(r) => { if (r) update({ phase: 'match', matchStartedAt: Date.now() + 3000 }); }}
        title={s.stage === 0 ? 'Set your lineup' : `Through to the ${CUP_STAGES[s.stage]}`}
        subtitle={s.stage === 0 ? 'Choose a formation and style, then take on the cup.' : 'Adjust your lineup and style before the next one.'}
        readyLabel={`Kick off the ${CUP_STAGES[s.stage]}`}
        opponent={{ name: opp.name, overall: opp.overall, stage: CUP_STAGES[s.stage]! }}
      />
    );
  }

  if (s.phase === 'match' && opp && s.matchStartedAt) {
    return <CupMatch s={s} opp={opp} update={update} />;
  }

  return <CupOver s={s} onNew={newRun} />;
}

function CupMatch({ s, opp, update }: { s: Save; opp: ReturnType<typeof buildOpponent>; update: (p: Partial<Save> | ((x: Save) => Save)) => void }) {
  const result = useMemo(
    () => simulateMatch(s.squad, opp.squad, ['You', opp.name], `${s.seed}/cup/${s.stage}`, { knockout: true }),
    [s.squad, s.seed, s.stage, opp],
  );
  const won = result.winner === 0;
  const last = s.stage >= CUP_STAGES.length - 1;
  const record = () => {
    const r: Result = { stage: s.stage, opp: opp.name, score: result.score, pens: result.pens, won, headline: result.headline };
    update((c) => {
      if (c.results.some((x) => x.stage === s.stage)) return c;
      return { ...c, results: [...c.results, r] };
    });
  };
  const next = () => {
    record();
    if (!won) update((c) => ({ ...c, phase: 'over', status: 'out', matchStartedAt: null }));
    else if (last) update((c) => ({ ...c, phase: 'over', status: 'champion', matchStartedAt: null }));
    else update((c) => ({ ...c, phase: 'setup', stage: c.stage + 1, matchStartedAt: null }));
  };
  return (
    <MatchPlayer
      fixtures={[{ a: { name: 'You', hue: 1, squad: s.squad }, b: { name: opp.name, hue: 0, squad: opp.squad }, result }]}
      startAt={s.matchStartedAt!}
      you={() => 0}
      onSeen={() => undefined}
      continueLabel={won ? (last ? 'Lift the trophy' : `On to the ${CUP_STAGES[s.stage + 1]}`) : 'See how it ended'}
      onContinue={next}
    />
  );
}

function CupOver({ s, onNew }: { s: Save; onNew: () => void }) {
  const prof = profile(s.squad);
  const champion = s.status === 'champion';
  const reached = champion ? 'Champions' : `Out in the ${CUP_STAGES[Math.min(s.stage, 3)]}`;
  const wins = s.results.filter((r) => r.won).length;

  useEffect(() => {
    if (champion) sfx.win();
    const best = lsGet<{ wins: number; ovr: number } | null>('cup:best', null);
    if (s.mode === 'cup' && (!best || wins > best.wins || (wins === best.wins && prof.overall > best.ovr))) lsSet('cup:best', { wins, ovr: prof.overall });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const text = [
    `${BRAND.name} ${s.mode === 'daily' ? `Daily ${dailyLabel(s.seed)}` : 'Cup'} · ${reached}${champion ? ' 🏆' : ''}`,
    `${FORMATIONS[s.squad.formation].name} · ${prof.overall.toFixed(1)} OVR · ${prof.chem.score}% chem · ${wins}/4 wins`,
    s.results.map((r) => (r.won ? '🟩' : '🟥')).join('') + '⬜'.repeat(Math.max(0, 4 - s.results.length)),
  ].join('\n');

  return (
    <div className="result">
      {champion && <Confetti burst="cup" count={70} />}
      <section className={cx('panel winner', champion && 'winner--you')}>
        <p className="eyebrow">{s.mode === 'daily' ? `Daily ${dailyLabel(s.seed)}` : 'Solo Cup'}</p>
        <h1>{champion ? 'Champions!' : reached}</h1>
        <p className="winner__sum">{wins} win{wins === 1 ? '' : 's'} · {prof.overall.toFixed(1)} overall</p>
        <ol className="cupresults">
          {s.results.map((r) => (
            <li key={r.stage} className={r.won ? 'is-win' : 'is-loss'}>
              <span className="cupresults__stage">{CUP_STAGES[r.stage]}</span>
              <span>vs {r.opp}</span>
              <b>{r.score[0]}–{r.score[1]}{r.pens ? ` (${r.pens[0]}–${r.pens[1]} pens)` : ''}</b>
              <Icon name={r.won ? 'check' : 'x'} size={16} />
            </li>
          ))}
        </ol>
        <div className="row row--center">
          <Button variant="soft" icon="share" onClick={() => shareOrCopy({ title: BRAND.name, text: text, url: location.origin })}>Share result</Button>
          {s.mode === 'cup' ? <Button variant="primary" size="lg" icon="refresh" onClick={onNew}>New run</Button> : <Button variant="primary" size="lg" onClick={() => navigate('/')}>Back home</Button>}
          {s.mode === 'cup' && <Button variant="ghost" onClick={() => navigate('/')}>Home</Button>}
        </div>
      </section>
      <section className="panel">
        <h2 className="panel__title">Your XI</h2>
        <div className="squadview">
          <Pitch formation={s.squad.formation} slots={s.squad.slots} links={prof.chem.links} linkCount={prof.chem.perSlot} ratings="full" label="Your final XI" />
          <ul className="roster">
            {FORMATIONS[s.squad.formation].slots.map((slot) => {
              const pid = s.squad.slots[slot.id];
              return pid ? <RosterRow key={slot.id} id={pid} role={slot.role} /> : null;
            })}
          </ul>
        </div>
      </section>
    </div>
  );
}

function RosterRow({ id, role }: { id: string; role: string }) {
  const p = player(id);
  return <li><b className="roster__ovr">{p.ovr}</b><span>{p.name}</span><i>{role}</i></li>;
}
