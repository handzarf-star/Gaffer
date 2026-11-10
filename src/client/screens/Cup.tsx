import { useCallback, useEffect, useMemo, useState } from 'react';
import { BRAND } from '../../shared/brand';
import { CUP_STAGES, buildOpponent, cupBoard, dailyLabel, dailySeed } from '../../shared/cup';
import { ROUNDS, placePlayer, type RatingsMode } from '../../shared/draft';
import { FORMATIONS, FORMATION_IDS, type FormationId } from '../../shared/formations';
import type { TFn } from '../../shared/i18n';
import { player } from '../../shared/players';
import { BASE_POOL_IDS, POOLS, type PoolId } from '../../shared/pools';
import { hashSeed, randomSeed } from '../../shared/rng';
import { simulateMatch } from '../../shared/sim';
import { autoArrange, changeFormation, emptySquad, profile, swapSlots, type Squad, type StyleId } from '../../shared/squad';
import { Confetti } from '../components/Confetti';
import { Pitch } from '../components/Pitch';
import { Button, Icon, Seg, cx, shareOrCopy } from '../components/ui';
import { navigate, useScrollTop } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { BOT_HUES, SEAT_HUES } from '../../shared/protocol';
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

const POOL_IDS: PoolId[] = BASE_POOL_IDS;
const keyFor = (mode: Mode, seed: string) => (mode === 'daily' ? `daily:${seed}` : 'cup:current');

/* Stage names and the sentences built around them. Bosnian declines the stage name (u finale, u polufinalu), so every sentence is spelled out per stage. */
const stageName = (t: TFn, i: number): string => t(CUP_STAGES[i]!);
function throughTo(t: TFn, i: number): string {
  switch (i) {
    case 1: return t('Through to the Quarter-final');
    case 2: return t('Through to the Semi-final');
    default: return t('Through to the Final');
  }
}
function kickOff(t: TFn, i: number): string {
  switch (i) {
    case 0: return t('Kick off the Round of 16');
    case 1: return t('Kick off the Quarter-final');
    case 2: return t('Kick off the Semi-final');
    default: return t('Kick off the Final');
  }
}
function onTo(t: TFn, i: number): string {
  switch (i) {
    case 1: return t('On to the Quarter-final');
    case 2: return t('On to the Semi-final');
    default: return t('On to the Final');
  }
}
function outIn(t: TFn, i: number): string {
  switch (i) {
    case 0: return t('Out in the Round of 16');
    case 1: return t('Out in the Quarter-final');
    case 2: return t('Out in the Semi-final');
    default: return t('Out in the Final');
  }
}

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
  const { t } = useI18n();
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
        <p className="eyebrow">{mode === 'daily' ? t('Daily Draft · {date}', { date: dailyLabel(s.seed) }) : t('Solo Cup')}</p>
        <h1>{mode === 'daily' ? t('Same packs for everyone today') : t('Win four knockout rounds')}</h1>
        <p className="muted">
          {mode === 'daily'
            ? t('Everyone in the world gets the identical packs and opponents today. Compare how far you got with your mates.')
            : t('Draft an XI from 11 packs, then beat four AI sides in a row. Fresh packs every run.')}
        </p>
        <div className="setting">
          <label>{t('Player pool')}</label>
          {mode === 'daily' ? (
            <p><b>{t(POOLS[s.pool].name)}</b> <span className="muted">{t("is today's pool")}</span></p>
          ) : (
            <div className="opts opts--3">
              {POOL_IDS.map((id) => (
                <button key={id} className={cx('opt', s.pool === id && 'is-on')} onClick={() => update({ pool: id })} aria-pressed={s.pool === id}>
                  <b>{t(POOLS[id].name)}</b><span>{t(POOLS[id].blurb)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="setting setting--inline">
          <div>
            <label>{t('Ratings on cards')}</label>
            <Seg<RatingsMode> label={t('Ratings')} value={s.ratings} onChange={(v) => update({ ratings: v })} options={[{ value: 'hidden', label: t('Hidden') }, { value: 'tier', label: t('Stars') }, { value: 'full', label: t('Numbers') }]} />
          </div>
          <div>
            <label>{t('Formation')}</label>
            <Seg<string> label={t('Formation')} value={s.squad.formation} onChange={(v) => update({ squad: emptySquad(v as FormationId) })} options={FORMATION_IDS.map((id) => ({ value: id, label: FORMATIONS[id].name }))} />
          </div>
        </div>
        <div className="row">
          <Button variant="primary" size="lg" icon="play" onClick={start}>{t('Start drafting')}</Button>
          <Button variant="ghost" onClick={() => navigate('/')}>{t('Back')}</Button>
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
        subtitle={mode === 'daily' ? t('Daily {date}', { date: dailyLabel(s.seed) }) : t('Solo Cup')}
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
        title={s.stage === 0 ? t('Set your lineup') : throughTo(t, s.stage)}
        subtitle={s.stage === 0 ? t('Choose a formation and style, then take on the cup.') : t('Adjust your lineup and style before the next one.')}
        readyLabel={kickOff(t, s.stage)}
        opponent={{ name: opp.name, overall: opp.overall, stage: stageName(t, s.stage) }}
      />
    );
  }

  if (s.phase === 'match' && opp && s.matchStartedAt) {
    return <CupMatch s={s} opp={opp} update={update} />;
  }

  return <CupOver s={s} onNew={newRun} />;
}

function CupMatch({ s, opp, update }: { s: Save; opp: ReturnType<typeof buildOpponent>; update: (p: Partial<Save> | ((x: Save) => Save)) => void }) {
  const { t, lang } = useI18n();
  // The team name also fills the Bosnian commentary lines ("Korner za {t}", "{t} slavi"), which need a noun, not the pronoun "Ti".
  const you = lang === 'en' ? 'You' : t('Your team');
  const result = useMemo(
    () => simulateMatch(s.squad, opp.squad, [you, opp.name], `${s.seed}/cup/${s.stage}`, { knockout: true }),
    [s.squad, s.seed, s.stage, opp, you],
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
      fixtures={[{ a: { name: you, hue: 1, color: SEAT_HUES[1], squad: s.squad }, b: { name: opp.name, hue: 0, color: BOT_HUES[0], squad: opp.squad, bot: true }, result }]}
      startAt={s.matchStartedAt!}
      you={() => 0}
      onSeen={() => undefined}
      pace="normal"
      continueLabel={won ? (last ? t('Lift the trophy') : onTo(t, s.stage + 1)) : t('See how it ended')}
      onContinue={next}
    />
  );
}

function CupOver({ s, onNew }: { s: Save; onNew: () => void }) {
  const { t, tn } = useI18n();
  const prof = profile(s.squad);
  const champion = s.status === 'champion';
  const reached = champion ? t('Champions') : outIn(t, Math.min(s.stage, 3));
  const wins = s.results.filter((r) => r.won).length;

  useEffect(() => {
    if (champion) sfx.win();
    const best = lsGet<{ wins: number; ovr: number } | null>('cup:best', null);
    if (s.mode === 'cup' && (!best || wins > best.wins || (wins === best.wins && prof.overall > best.ovr))) lsSet('cup:best', { wins, ovr: prof.overall });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const text = [
    `${BRAND.name} ${s.mode === 'daily' ? t('Daily {date}', { date: dailyLabel(s.seed) }) : t('Cup')} · ${reached}${champion ? ' 🏆' : ''}`,
    t('{formation} · {ovr} OVR · {chem}% chem · {wins}/4 wins', { formation: FORMATIONS[s.squad.formation].name, ovr: prof.overall.toFixed(1), chem: prof.chem.score, wins }),
    s.results.map((r) => (r.won ? '🟩' : '🟥')).join('') + '⬜'.repeat(Math.max(0, 4 - s.results.length)),
  ].join('\n');

  return (
    <div className="result">
      {champion && <Confetti burst="cup" count={70} />}
      <section className={cx('panel winner', champion && 'winner--you')}>
        <p className="eyebrow">{s.mode === 'daily' ? t('Daily {date}', { date: dailyLabel(s.seed) }) : t('Solo Cup')}</p>
        <h1>{champion ? t('Champions!') : reached}</h1>
        <p className="winner__sum">{tn('{n} win', '{n} wins', wins)} · {t('{ovr} overall', { ovr: prof.overall.toFixed(1) })}</p>
        <ol className="cupresults">
          {s.results.map((r) => (
            <li key={r.stage} className={r.won ? 'is-win' : 'is-loss'}>
              <span className="cupresults__stage">{stageName(t, r.stage)}</span>
              <span>{t('vs {opp}', { opp: r.opp })}</span>
              <b>{r.score[0]}–{r.score[1]}{r.pens ? ` (${t('{a}–{b} pens', { a: r.pens[0], b: r.pens[1] })})` : ''}</b>
              <Icon name={r.won ? 'check' : 'x'} size={16} />
            </li>
          ))}
        </ol>
        <div className="row row--center">
          <Button variant="soft" icon="share" onClick={() => shareOrCopy({ title: BRAND.name, text: text, url: location.origin })}>{t('Share result')}</Button>
          {s.mode === 'cup' ? <Button variant="primary" size="lg" icon="refresh" onClick={onNew}>{t('New run')}</Button> : <Button variant="primary" size="lg" onClick={() => navigate('/')}>{t('Back home')}</Button>}
          {s.mode === 'cup' && <Button variant="ghost" onClick={() => navigate('/')}>{t('Home')}</Button>}
        </div>
      </section>
      <section className="panel">
        <h2 className="panel__title">{t('Your XI')}</h2>
        <div className="squadview">
          <Pitch formation={s.squad.formation} slots={s.squad.slots} links={prof.chem.links} linkCount={prof.chem.perSlot} ratings="full" label={t('Your final XI')} />
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
