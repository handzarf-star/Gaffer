import { useEffect, useMemo, useRef, useState } from 'react';
import { FORMATIONS } from '../../shared/formations';
import { player, shortName } from '../../shared/players';
import { playbackSchedule, type EventType, type MatchEvent, type MatchResult } from '../../shared/sim';
import { STYLES, profile, type Squad } from '../../shared/squad';
import { Confetti } from '../components/Confetti';
import { PlayerCard } from '../components/PlayerCard';
import { Avatar, Button, Icon, cx } from '../components/ui';
import { announce, useFrameClock } from '../lib/hooks';
import { buzz, sfx } from '../lib/sfx';

export interface MatchSide {
  name: string;
  hue: number;
  squad: Squad;
}
export interface MatchFixture {
  a: MatchSide;
  b: MatchSide;
  result: MatchResult;
  label?: string;
}

const GAP_MS = 4500;

const ICON: Partial<Record<EventType, string>> = {
  goal: '⚽', yellow: '🟨', red: '🟥', save: '🧤', miss: '💨', post: '🥅', pen_goal: '⚽', pen_miss: '✖️', kickoff: '🏁', half: '⏸️', full: '🏁', et: '⏱️', etend: '⏱️', shootout: '🎯',
};

function minuteAt(items: ReturnType<typeof playbackSchedule>['items'], t: number): number {
  let prev: (typeof items)[number] | null = null;
  let next: (typeof items)[number] | null = null;
  for (const it of items) {
    if (it.at <= t) prev = it;
    else {
      next = it;
      break;
    }
  }
  if (!prev) return 0;
  if (prev.event.t > 120) return 120;
  if (!next || next.event.t > 120) return prev.event.t;
  const span = next.at - prev.at;
  const frac = span > 0 ? Math.min(1, Math.max(0, (t - prev.at) / span)) : 1;
  return Math.floor(prev.event.t + (next.event.t - prev.event.t) * frac);
}

function phaseLabel(last: MatchEvent | undefined, minute: number, went: MatchResult['went']): string {
  if (!last) return 'Kick-off';
  switch (last.type) {
    case 'half': return 'Half-time';
    case 'full': return went === 'ft' ? 'Full-time' : 'Level after 90';
    case 'et': return 'Extra time';
    case 'etend': return went === 'et' ? 'Full-time (aet)' : 'End of extra time';
    case 'shootout': case 'pen_goal': case 'pen_miss': return 'Penalties';
    default: return minute <= 45 ? 'First half' : minute <= 90 ? 'Second half' : 'Extra time';
  }
}

export interface MatchPlayerProps {
  fixtures: MatchFixture[];
  /** local-clock time the first whistle blows (server start time minus clock offset) */
  startAt: number;
  /** which side is "you" per fixture: 0, 1 or null */
  you: (idx: number) => 0 | 1 | null;
  /** called once when everything has been watched or skipped */
  onSeen: () => void;
  /** show a button that moves on once finished */
  continueLabel?: string;
  onContinue?: () => void;
  /** if true the watcher can leave before the server moves on */
  waitingFor?: string | null;
}

export function MatchPlayer({ fixtures, startAt, you, onSeen, continueLabel, onContinue, waitingFor }: MatchPlayerProps) {
  const [skipped, setSkipped] = useState(false);
  const [viewIdx, setViewIdx] = useState<number | null>(null);
  const [burst, setBurst] = useState(0);
  const [flash, setFlash] = useState<{ text: string; sub: string; hue: number } | null>(null);
  const seen = useRef(false);

  const schedules = useMemo(() => fixtures.map((f) => playbackSchedule(f.result)), [fixtures]);
  const offsets = useMemo(() => {
    const o: number[] = [];
    let acc = 0;
    for (const s of schedules) {
      o.push(acc);
      acc += s.totalMs + GAP_MS;
    }
    return o;
  }, [schedules]);
  const total = offsets.length ? offsets[offsets.length - 1]! + schedules[schedules.length - 1]!.totalMs : 0;

  const allDoneLive = useRef(false);
  const now = useFrameClock(!skipped && !allDoneLive.current);
  const elapsed = skipped ? total : now - startAt;
  const finished = elapsed >= total;
  allDoneLive.current = finished;

  // which fixture is on right now
  let live = 0;
  for (let i = 0; i < fixtures.length; i++) if (elapsed >= offsets[i]!) live = i;
  const k = viewIdx ?? live;
  const fx = fixtures[k]!;
  const sch = schedules[k]!;
  const localT = viewIdx !== null || skipped ? sch.totalMs + 1 : elapsed - offsets[k]!;
  const countdown = elapsed < 0;

  const shown = sch.items.filter((it) => it.at <= localT);
  const fixtureDone = localT >= sch.totalMs;
  const minute = fixtureDone ? (fx.result.went === 'ft' ? 90 : 120) : minuteAt(sch.items, localT);
  const lastEv = shown[shown.length - 1]?.event;
  const liveScore = fixtureDone ? fx.result.score : ([...shown].reverse().find((s) => !s.event.type.startsWith('pen_') && s.event.type !== 'shootout')?.event.s ?? [0, 0]);
  const pens = shown.filter((s) => s.event.type === 'pen_goal' || s.event.type === 'pen_miss');
  const mySide = you(k);

  // sounds and flashes for newly revealed events
  const lastCount = useRef({ k, n: 0 });
  useEffect(() => {
    if (lastCount.current.k !== k) lastCount.current = { k, n: viewIdx !== null ? shown.length : 0 };
    const prev = lastCount.current.n;
    if (shown.length > prev && viewIdx === null && !skipped) {
      for (const s of shown.slice(prev)) {
        const e = s.event;
        if (e.type === 'goal') {
          const side = e.team === 0 ? fx.a : fx.b;
          sfx.goal();
          buzz(60);
          setBurst((b) => b + 1);
          setFlash({ text: 'GOAL!', sub: `${shortName(player(e.p!).name)} · ${e.t}'`, hue: side.hue });
          setTimeout(() => setFlash(null), 2300);
          announce(`Goal for ${side.name}. ${shortName(player(e.p!).name)}, minute ${e.t}.`);
        } else if (e.type === 'kickoff' || e.type === 'half' || e.type === 'full' || e.type === 'et') sfx.whistle();
        else if (e.type === 'red' || e.type === 'yellow') sfx.card();
        else if (e.type === 'pen_goal') sfx.pick();
        else if (e.type === 'pen_miss') sfx.error();
      }
    }
    lastCount.current = { k, n: shown.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.length, k, viewIdx, skipped]);

  // tell the server once we are done watching
  useEffect(() => {
    if (finished && !seen.current) {
      seen.current = true;
      onSeen();
      if (!skipped) sfx.win();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  const skip = () => {
    sfx.whistle();
    setSkipped(true);
    setViewIdx(null);
  };

  const stat = fx.result.stats;
  const pa = profile(fx.a.squad);
  const pb = profile(fx.b.squad);
  const w = fx.result.winner;

  return (
    <div className="match">
      {fixtures.length > 1 && (
        <div className="fxtabs" role="tablist" aria-label="Fixtures">
          {fixtures.map((f, i) => {
            const isLiveOrDone = skipped || elapsed >= offsets[i]!;
            return (
              <button key={i} role="tab" aria-selected={k === i} disabled={!isLiveOrDone} className={cx('fxtab', k === i && 'is-on', i === live && !finished && 'is-live')} onClick={() => setViewIdx(i === live && !finished ? null : i)}>
                {f.a.name} v {f.b.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="scoreboard">
        <div className={cx('sb__team', w === 0 && fixtureDone && 'is-win', mySide === 0 && 'is-me')}>
          <Avatar name={fx.a.name} hue={fx.a.hue} size={48} />
          <b>{fx.a.name}</b>
          <small>{FORMATIONS[fx.a.squad.formation].name} · {STYLES[fx.a.squad.style].name}</small>
        </div>
        <div className="sb__mid">
          <div className="sb__phase">{countdown ? 'Kick-off in…' : phaseLabel(lastEv, minute, fx.result.went)}</div>
          {countdown ? (
            <div className="sb__count">{Math.max(1, Math.ceil(-elapsed / 1000))}</div>
          ) : (
            <>
              <div className="sb__score" aria-live="off">{liveScore[0]}<span>–</span>{liveScore[1]}</div>
              <div className="sb__clock">{fixtureDone ? 'FT' : pens.length ? 'PEN' : `${minute}'`}</div>
            </>
          )}
          {fx.result.pens && pens.length > 0 && (
            <div className="sb__pens" aria-label="Penalty shootout">
              {[0, 1].map((t) => (
                <span key={t} className="pens">
                  {pens.filter((s) => s.event.team === t).map((s, i) => (
                    <i key={i} className={s.event.type === 'pen_goal' ? 'ok' : 'no'} />
                  ))}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className={cx('sb__team', w === 1 && fixtureDone && 'is-win', mySide === 1 && 'is-me')}>
          <Avatar name={fx.b.name} hue={fx.b.hue} size={48} />
          <b>{fx.b.name}</b>
          <small>{FORMATIONS[fx.b.squad.formation].name} · {STYLES[fx.b.squad.style].name}</small>
        </div>
      </div>

      {flash && (
        <div className="goalflash" aria-hidden="true">
          <b>{flash.text}</b>
          <span>{flash.sub}</span>
        </div>
      )}
      <Confetti burst={burst} count={30} />

      {countdown && (
        <section className="panel tape" aria-label="Tale of the tape">
          <h2 className="panel__title">Tale of the tape</h2>
          {([['Overall', pa.overall, pb.overall], ['Attack', pa.att, pb.att], ['Midfield', pa.mid, pb.mid], ['Defence', pa.def, pb.def], ['Keeper', pa.gk, pb.gk], ['Chemistry', pa.chem.score, pb.chem.score]] as Array<[string, number, number]>).map(([label, x, y]) => (
            <div className="tape__row" key={label}>
              <b className={x >= y ? 'lead' : ''}>{Number(x).toFixed(label === 'Overall' ? 1 : 0)}</b>
              <span>{label}</span>
              <b className={y >= x ? 'lead' : ''}>{Number(y).toFixed(label === 'Overall' ? 1 : 0)}</b>
            </div>
          ))}
        </section>
      )}

      {!countdown && (
        <div className="match__body">
          {fixtureDone && (
            <section className="panel fulltime">
              <p className="fulltime__head">{fx.result.headline}</p>
              <div className="statgrid">
                {([
                  ['Possession', `${stat.possession[0]}%`, `${stat.possession[1]}%`, stat.possession[0], stat.possession[1]],
                  ['Shots', stat.shots[0], stat.shots[1], stat.shots[0], stat.shots[1]],
                  ['On target', stat.onTarget[0], stat.onTarget[1], stat.onTarget[0], stat.onTarget[1]],
                  ['Expected goals', stat.xg[0].toFixed(2), stat.xg[1].toFixed(2), stat.xg[0], stat.xg[1]],
                  ['Cards', `${stat.yellows[0]}🟨 ${stat.reds[0]}🟥`, `${stat.yellows[1]}🟨 ${stat.reds[1]}🟥`, 0, 0],
                ] as Array<[string, string | number, string | number, number, number]>).map(([label, x, y, nx, ny]) => (
                  <div className="statrow" key={label}>
                    <b>{x}</b>
                    <div className="statrow__mid">
                      <span>{label}</span>
                      {(nx > 0 || ny > 0) && (
                        <div className="statrow__bar"><i style={{ width: `${(nx / (nx + ny || 1)) * 100}%` }} /></div>
                      )}
                    </div>
                    <b>{y}</b>
                  </div>
                ))}
              </div>
              <div className="motm">
                <PlayerCard id={fx.result.motm.player} mode="full" size="sm" />
                <div>
                  <small>Man of the match</small>
                  <b>{player(fx.result.motm.player).name}</b>
                  <span>{fx.result.motm.reason}</span>
                </div>
              </div>
            </section>
          )}
          <section className="feed" role="log" aria-label="Match events" tabIndex={0}>
            {[...shown].reverse().map((s, i) => {
              const e = s.event;
              const side = e.team === 0 ? fx.a : fx.b;
              const big = e.type === 'goal' || e.type === 'red';
              const mark = e.type === 'half' || e.type === 'full' || e.type === 'et' || e.type === 'etend' || e.type === 'shootout' || e.type === 'kickoff';
              return (
                <div key={`${k}-${s.at}-${i}`} className={cx('feed__row', big && 'is-big', mark && 'is-mark', `ev-${e.type}`)}>
                  <span className="feed__min">{e.t <= 120 && !mark ? `${e.t}'` : ''}</span>
                  <span className="feed__ico" aria-hidden="true">{ICON[e.type] ?? '•'}</span>
                  <span className="feed__txt">
                    {!mark && <i className="feed__dot" style={{ background: ['#ff5a3c', '#2f6bff', '#10a56a', '#a855f7'][side.hue % 4] }} />}
                    {e.text}
                  </span>
                </div>
              );
            })}
          </section>

        </div>
      )}

      <div className={cx('match__controls', finished && continueLabel && 'match__controls--final')}>
        {!finished && !countdown && (
          <Button variant="ghost" icon="skip" onClick={skip}>Skip to the end</Button>
        )}
        {finished && waitingFor && <span className="muted"><Icon name="clock" size={16} /> {waitingFor}</span>}
        {finished && continueLabel && onContinue && (
          <Button variant="primary" size="lg" icon="arrow" onClick={onContinue}>{continueLabel}</Button>
        )}
      </div>
    </div>
  );
}
