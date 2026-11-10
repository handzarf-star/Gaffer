import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BRAND } from '../../shared/brand';
import { BOT_LEVELS, type BotLevel } from '../../shared/bots';
import { COMPETITIONS, currentDay, isAlive, roundsInfo, type CompFixture, type CompetitionKind } from '../../shared/competition';
import { FORMAT_INFO, type DraftFormat, type RatingsMode } from '../../shared/draft';
import { FORMATIONS, FORMATION_IDS } from '../../shared/formations';
import { POOLS, player, type PoolId } from '../../shared/players';
import { EMOTES, MAX_SEATS, PICK_SECONDS, type ErrorCode, type RoomView, type Seat } from '../../shared/protocol';
import { HUB_SECONDS, SETUP_SECONDS } from '../../shared/room';
import type { Pace } from '../../shared/sim';
import { chemistry, profile } from '../../shared/squad';
import { ChampionBanner, CompetitionTables, FixtureRow, TeamName, compName, seatMap } from '../components/CompViews';
import { Confetti } from '../components/Confetti';
import { Pitch } from '../components/Pitch';
import { Timer } from '../components/Timer';
import { Avatar, Banner, Button, Icon, Seg, Spinner, copyText, cx, shareOrCopy } from '../components/ui';
import { seatColor } from '../lib/colors';
import { navigate, toast, useScrollTop } from '../lib/hooks';
import { useRoom, type RoomConnection } from '../lib/net';
import { sfx } from '../lib/sfx';
import { getIdentity, getName, setName } from '../lib/storage';
import { DraftScreen, type DraftLogRow, type Rival } from './DraftScreen';
import { MatchPlayer, type MatchFixture, type MatchSide } from './MatchPlayer';
import { SetupScreen } from './SetupScreen';

const FRIENDLY: Record<ErrorCode, string> = {
  bad_message: 'Something went wrong sending that. Try again.',
  no_room: 'That room does not exist.',
  room_full: 'This room is full.',
  in_progress: 'This game has already started.',
  bad_secret: 'That seat belongs to another device.',
  not_host: 'Only the host can do that.',
  wrong_phase: 'That is not possible right now.',
  not_your_turn: 'Not your turn yet.',
  stale_round: 'That round just ended.',
  bad_card: 'Somebody got that card first.',
  bad_slot: 'That spot is already taken.',
  need_players: 'You need at least two teams to start. Add CPU teams or invite a friend.',
  bad_settings: 'That combination does not work. Try a different number of teams.',
  rate_limited: 'Easy there. Slow down a little.',
  kicked: 'You were removed from the room.',
};

const FATAL_COPY: Record<string, { title: string; body: string }> = {
  no_room: { title: 'Room not found', body: 'Check the code, or ask your friend to create a fresh room.' },
  room_full: { title: 'This room is full', body: `Rooms hold up to ${MAX_SEATS} players.` },
  in_progress: { title: 'That game has already started', body: 'Ask the host to start a new room. If you were already playing, open the link on the device you started with.' },
  bad_secret: { title: 'That seat belongs to another device', body: 'Reload to join as a new player if the game has not started yet.' },
  kicked: { title: 'You were removed from the room', body: 'The host removed you. You can create your own room.' },
};

export function RoomPage({ code }: { code: string }) {
  const [name, setNameState] = useState(() => getIdentity(code)?.name || getName());
  const [exists, setExists] = useState<'unknown' | 'yes' | 'no'>('unknown');
  const ready = !!name;

  useEffect(() => {
    if (getIdentity(code)) return setExists('yes');
    let cancelled = false;
    fetch(`/api/rooms/${code}`)
      .then((r) => r.json() as Promise<{ exists: boolean }>)
      .then((d) => !cancelled && setExists(d.exists ? 'yes' : 'no'))
      .catch(() => !cancelled && setExists('yes')); // offline: let the socket layer retry
    return () => { cancelled = true; };
  }, [code]);

  if (exists === 'no') return <Fatal title={FATAL_COPY.no_room!.title} body={FATAL_COPY.no_room!.body} />;
  if (!ready) {
    return (
      <div className="gate panel">
        <h1>Join room <span className="mono">{code}</span></h1>
        <p>What should we call you?</p>
        <NameForm onSubmit={(n) => { setName(n); setNameState(n); }} cta="Join the room" />
      </div>
    );
  }
  return <Connected code={code} ready={exists !== 'unknown'} />;
}

function NameForm({ onSubmit, cta, initial = '' }: { onSubmit: (n: string) => void; cta: string; initial?: string }) {
  const [v, setV] = useState(initial);
  return (
    <form className="nameform" onSubmit={(e) => { e.preventDefault(); const n = v.trim(); if (n) onSubmit(n.slice(0, 16)); }}>
      <label className="sr-only" htmlFor="nm">Your name</label>
      <input id="nm" className="input" autoFocus autoComplete="nickname" maxLength={16} placeholder="Your name" value={v} onChange={(e) => setV(e.target.value)} />
      <Button type="submit" variant="primary" disabled={!v.trim()}>{cta}</Button>
    </form>
  );
}

function Fatal({ title, body }: { title: string; body: string }) {
  return (
    <div className="gate panel">
      <h1>{title}</h1>
      <p>{body}</p>
      <div className="row">
        <Button variant="primary" onClick={() => navigate('/')}>Back to home</Button>
        <Button variant="ghost" onClick={() => location.reload()}>Try again</Button>
      </div>
    </div>
  );
}

function Connected({ code, ready }: { code: string; ready: boolean }) {
  const { conn, state } = useRoom(code, ready);
  const [floaters, setFloaters] = useState<Array<{ id: number; e: string; name: string; x: number }>>([]);
  const idRef = useRef(1);

  useEffect(() => {
    conn.onError = (c, m) => {
      toast(FRIENDLY[c] ?? m, 'error');
      sfx.error();
    };
    conn.onEmote = (from, e) => {
      const view = conn.getSnapshot().view;
      const seat = view?.seats.find((s) => s.id === from);
      const id = idRef.current++;
      setFloaters((f) => [...f.slice(-6), { id, e, name: seat?.name ?? '', x: 10 + Math.random() * 70 }]);
      setTimeout(() => setFloaters((f) => f.filter((x) => x.id !== id)), 2800);
    };
  }, [conn]);

  if (state.fatal) {
    const c = FATAL_COPY[state.fatal.code];
    return <Fatal title={c?.title ?? 'Could not join'} body={c?.body ?? state.fatal.msg} />;
  }
  const view = state.view;
  if (!view) {
    return (
      <div className="gate gate--loading">
        <Spinner size={36} />
        <p>{state.status === 'reconnecting' ? 'Reconnecting…' : `Joining room ${code}…`}</p>
        {state.attempt > 2 && <p className="muted">Taking a while. Check your connection.</p>}
      </div>
    );
  }
  return (
    <>
      {state.status !== 'live' && (
        <Banner tone="warn" icon="wifioff">Connection lost. Reconnecting… your seat is saved and you can keep the page open.</Banner>
      )}
      <Phase conn={conn} view={view} offset={state.offset} />
      <EmoteBar conn={conn} />
      <div className="floaters" aria-hidden="true">
        {floaters.map((f) => (
          <span key={f.id} className="floater" style={{ left: `${f.x}%` }}>
            <b>{f.e}</b>
            <small>{f.name}</small>
          </span>
        ))}
      </div>
    </>
  );
}

function EmoteBar({ conn }: { conn: RoomConnection }) {
  const [open, setOpen] = useState(false);
  const slot = document.getElementById('topbar-slot');
  const ui = (
    <div className="emotes">
      <button type="button" className={cx('iconbtn', open && 'is-on')} onClick={() => setOpen((o) => !o)} aria-label={open ? 'Close reactions' : 'Send a reaction'} aria-expanded={open} title="Send a reaction">
        <span className="emotes__face" aria-hidden="true">🙂</span>
      </button>
      {open && (
        <div className="emotes__pop" role="menu" aria-label="Reactions">
          {EMOTES.map((e) => (
            <button key={e} role="menuitem" className="emote" onClick={() => { conn.send({ t: 'emote', e }); setOpen(false); }} aria-label={`Send ${e}`}>{e}</button>
          ))}
        </div>
      )}
    </div>
  );
  return slot ? createPortal(ui, slot) : null;
}

interface PhaseProps {
  conn: RoomConnection;
  view: RoomView;
  offset: number;
}

function Phase({ conn, view, offset }: PhaseProps) {
  useScrollTop(view.phase + view.game + (view.comp?.day ?? ''));
  switch (view.phase) {
    case 'lobby': return <Lobby conn={conn} view={view} />;
    case 'draft': return <DraftRoom conn={conn} view={view} offset={offset} />;
    case 'setup': return <SetupRoom conn={conn} view={view} offset={offset} />;
    case 'match': return <MatchRoom conn={conn} view={view} offset={offset} />;
    case 'hub': return <HubRoom conn={conn} view={view} offset={offset} />;
    case 'result': return <ResultRoom conn={conn} view={view} />;
  }
}

const humansOf = (view: RoomView): Seat[] => view.seats.filter((s) => !s.bot);

function sideOf(view: RoomView, id: string): MatchSide {
  const seat = view.seats.find((s) => s.id === id)!;
  return { name: seat.name, hue: seat.hue, color: seatColor(seat), squad: view.squads[id]!, bot: seat.bot };
}

function fixtureFor(view: RoomView, f: CompFixture): MatchFixture {
  return { a: sideOf(view, f.a), b: sideOf(view, f.b), result: f.result!, label: f.stage };
}

/* ═════════════════════════════ Lobby ═════════════════════════════ */

function Lobby({ conn, view }: { conn: RoomConnection; view: RoomView }) {
  const humans = humansOf(view);
  const me = view.seats.find((s) => s.id === view.you)!;
  const isHost = view.hostId === view.you;
  const link = `${location.origin}/r/${view.code}`;
  const connected = humans.filter((s) => s.connected).length;
  const set = view.settings;
  const cpus = Math.max(0, set.teams - humans.length);
  const canStart = isHost && connected >= 1 && set.teams >= 2;
  const patch = (p: Partial<RoomView['settings']>) => conn.send({ t: 'settings', patch: p });
  const hostName = view.seats.find((s) => s.id === view.hostId)?.name ?? 'the host';
  const wins = view.series.wins;
  const [editName, setEditName] = useState(me.name);
  useEffect(() => setEditName(me.name), [me.name]);
  const teamOptions = COMPETITIONS[set.competition].teamOptions.filter((n) => n >= humans.length);

  return (
    <div className="lobby">
      <section className="panel lobby__invite">
        <div>
          <p className="eyebrow">Room code</p>
          <div className="code" aria-label={`Room code ${view.code.split('').join(' ')}`}>
            {view.code.split('').map((c, i) => <span key={i} className="code__char">{c}</span>)}
          </div>
          <p className="muted">Send this link to your mate. It works on any phone or laptop. Playing on one device? Just add CPU teams below.</p>
        </div>
        <div className="lobby__share">
          <input className="input input--link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
          <div className="row">
            <Button variant="primary" icon="copy" onClick={() => copyText(link)}>Copy link</Button>
            <Button variant="soft" icon="share" onClick={() => shareOrCopy({ title: `Join my ${BRAND.name} room`, text: `Join my ${BRAND.name} room (code ${view.code})`, url: link })}>Share</Button>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel__title">Players <span className="count">{humans.length}/{MAX_SEATS}</span></h2>
        <ul className="seats">
          {humans.map((s) => (
            <li key={s.id} className={cx('seat', s.id === view.you && 'is-me')}>
              <Avatar name={s.name} hue={s.hue} size={44} connected={s.connected} />
              <div className="seat__info">
                {s.id === view.you ? (
                  <input
                    className="seat__name-input"
                    value={editName}
                    maxLength={16}
                    aria-label="Your name"
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => { const n = editName.trim(); if (n && n !== me.name) { setName(n); conn.send({ t: 'name', name: n }); } else setEditName(me.name); }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
                  />
                ) : <b>{s.name}</b>}
                <span>
                  {s.id === view.hostId && <><Icon name="crown" size={13} /> Host · </>}
                  {s.connected ? 'Connected' : 'Disconnected'}
                  {view.series.games > 0 && ` · ${wins[s.id] ?? 0} win${(wins[s.id] ?? 0) === 1 ? '' : 's'}`}
                </span>
              </div>
              {isHost && s.id !== view.you && <Button size="sm" variant="ghost" onClick={() => conn.send({ t: 'kick', id: s.id })} aria-label={`Remove ${s.name}`}>Remove</Button>}
            </li>
          ))}
          {humans.length < MAX_SEATS && (
            <li className="seat seat--empty">
              <span className="seat__ghost"><Icon name="plus" /></span>
              <div className="seat__info"><b>Waiting for a friend…</b><span>Anyone with the link can join</span></div>
            </li>
          )}
          {cpus > 0 && (
            <li className="seat seat--cpu">
              <span className="seat__ghost seat__ghost--cpu"><Icon name="cpu" /></span>
              <div className="seat__info"><b>{cpus} CPU team{cpus === 1 ? '' : 's'}</b><span>{BOT_LEVELS[set.botLevel].name} level. They draft after you and play the rest of the fixtures.</span></div>
            </li>
          )}
        </ul>
      </section>

      <section className="panel settings">
        <h2 className="panel__title">Competition {!isHost && <span className="muted tiny">{hostName} controls these</span>}</h2>
        <div className="setting">
          <label>Format</label>
          <div className="opts">
            {(Object.keys(COMPETITIONS) as CompetitionKind[]).map((k) => (
              <button key={k} disabled={!isHost} className={cx('opt', set.competition === k && 'is-on')} onClick={() => patch({ competition: k })} aria-pressed={set.competition === k}>
                <b>{COMPETITIONS[k].name}</b>
                <span>{COMPETITIONS[k].blurb}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="setting setting--inline">
          <div>
            <label>Teams</label>
            <Seg<number> label="Teams" disabled={!isHost || teamOptions.length < 2} value={set.teams} onChange={(v) => patch({ teams: v })} options={teamOptions.map((n) => ({ value: n, label: String(n) }))} />
            <p className="muted tiny setting__note">{humans.length} human{humans.length === 1 ? '' : 's'} + {cpus} CPU</p>
          </div>
          <div>
            <label>CPU level</label>
            <Seg<BotLevel> label="CPU level" disabled={!isHost || cpus === 0} value={set.botLevel} onChange={(v) => patch({ botLevel: v })} options={(Object.keys(BOT_LEVELS) as BotLevel[]).map((l) => ({ value: l, label: BOT_LEVELS[l].name, hint: BOT_LEVELS[l].blurb }))} />
          </div>
        </div>
        <div className="setting setting--inline">
          <div>
            <label>Match speed</label>
            <Seg<Pace> label="Match speed" disabled={!isHost} value={set.pace} onChange={(v) => patch({ pace: v })} options={[{ value: 'quick', label: 'Quick', hint: 'About 55 seconds a match' }, { value: 'normal', label: 'Normal', hint: 'About 90 seconds a match' }]} />
          </div>
          {set.competition === 'league' && (
            <div>
              <label>League length</label>
              <Seg<number> label="League length" disabled={!isHost} value={set.legs} onChange={(v) => patch({ legs: v as 1 | 2 })} options={[{ value: 1, label: 'Play everyone once' }, { value: 2, label: 'Home and away' }]} />
            </div>
          )}
        </div>
        <p className="settings__tip"><Icon name="info" size={16} /> You only watch matches a human plays in. CPU-versus-CPU games resolve instantly, and the table updates between matchdays.</p>
      </section>

      <section className="panel settings">
        <h2 className="panel__title">Draft</h2>
        <div className="setting">
          <label>Draft style</label>
          <div className="opts opts--3">
            {(['duel', 'packs', 'turns'] as DraftFormat[]).map((f) => (
              <button key={f} disabled={!isHost} className={cx('opt', set.format === f && 'is-on')} onClick={() => patch({ format: f })} aria-pressed={set.format === f}>
                <b>{FORMAT_INFO[f].name}</b>
                <span>{FORMAT_INFO[f].blurb}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="setting">
          <label>Player pool</label>
          <div className="opts opts--3">
            {(Object.keys(POOLS) as PoolId[]).map((id) => (
              <button key={id} disabled={!isHost} className={cx('opt', set.pool === id && 'is-on')} onClick={() => patch({ pool: id })} aria-pressed={set.pool === id}>
                <b>{POOLS[id].name}</b>
                <span>{POOLS[id].blurb}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="setting setting--inline">
          <div>
            <label>Ratings on cards</label>
            <Seg<RatingsMode> label="Ratings on cards" disabled={!isHost} value={set.ratings} onChange={(v) => patch({ ratings: v })} options={[
              { value: 'hidden', label: 'Hidden', hint: 'Pure football knowledge' },
              { value: 'tier', label: 'Stars', hint: 'Bronze to Icon tiers' },
              { value: 'full', label: 'Numbers', hint: 'Full ratings' },
            ]} />
          </div>
          <div>
            <label>Pick timer</label>
            <Seg<number> label="Pick timer" disabled={!isHost} value={set.pickSeconds} onChange={(v) => patch({ pickSeconds: v as 0 | 15 | 25 | 40 })} options={PICK_SECONDS.map((s) => ({ value: s, label: s === 0 ? 'Off' : `${s}s` }))} />
          </div>
        </div>
        <div className="setting">
          <label>Your formation</label>
          <Seg<string> label="Your formation" value={me.formation} onChange={(v) => conn.send({ t: 'formation', formation: v as Seat['formation'] })} options={FORMATION_IDS.map((id) => ({ value: id, label: FORMATIONS[id].name }))} />
          <p className="muted tiny">You can change it again after the draft.</p>
        </div>
      </section>

      <div className="lobby__cta">
        {isHost ? (
          <Button variant="primary" size="lg" block icon="whistle" disabled={!canStart} onClick={() => { sfx.whistle(); conn.send({ t: 'start' }); }}>
            {!canStart ? 'Add a CPU team or invite a friend' : connected === 1 && cpus > 0 ? `Start: you vs ${cpus} CPU team${cpus === 1 ? '' : 's'}` : 'Start the draft'}
          </Button>
        ) : (
          <div className="waitcard"><Spinner size={22} /> Waiting for {hostName} to start…</div>
        )}
      </div>
    </div>
  );
}

/* ═════════════════════════════ Draft ═════════════════════════════ */

function DraftRoom({ conn, view, offset }: PhaseProps) {
  const d = view.draft!;
  const you = view.you;
  const mySquad = view.squads[you]!;
  const humans = humansOf(view);
  const seatOf = (id: string) => view.seats.find((s) => s.id === id);
  const turnsMode = !!d.turns;
  const turnId = d.shared || turnsMode ? d.order[d.turn] : undefined;
  const pending = !d.shared && !turnsMode ? humans.filter((s) => !d.picked.includes(s.id) && s.id !== you) : [];
  const iPicked = d.picked.includes(you);

  const rivals: Rival[] = humans.filter((s) => s.id !== you).map((s) => ({
    id: s.id, name: s.name, hue: s.hue, squad: view.squads[s.id] ?? null, connected: s.connected,
    done: turnsMode ? Object.values(view.squads[s.id]?.slots ?? {}).filter(Boolean).length >= 11 : d.picked.includes(s.id), isTurn: turnId === s.id,
  }));

  const log: DraftLogRow[] = d.log.map((l, i) => {
    const s = seatOf(l.seat);
    return { key: `${l.round}-${l.seat}-${i}`, who: s?.name ?? '?', hue: s?.hue ?? 0, player: l.player, auto: l.auto, mine: l.seat === you };
  });

  let turn: 'me' | 'rival' | 'all';
  let turnName: string | undefined;
  let turnHue = 0;
  let canPick: boolean;
  if (d.shared || turnsMode) {
    turn = turnId === you ? 'me' : 'rival';
    const t = turnId ? seatOf(turnId) : undefined;
    turnName = t?.name;
    turnHue = t?.hue ?? 0;
    canPick = turnId === you;
  } else if (iPicked) {
    turn = 'rival';
    turnName = pending.map((s) => s.name).join(' & ') || 'everyone';
    turnHue = pending[0]?.hue ?? 0;
    canPick = false;
  } else {
    turn = 'all';
    canPick = true;
  }

  const send = useCallback((card: string, slot: string) => conn.send({ t: 'pick', round: d.round, card, slot }), [conn, d.round]);

  return (
    <DraftScreen
      round={d.round}
      board={d.board}
      mode={view.settings.ratings}
      squad={mySquad}
      turn={turn}
      turnName={turnName}
      turnHue={turnHue}
      canPick={canPick}
      shared={d.shared}
      turns={turnsMode}
      watchId={turnsMode && turnId !== you ? turnId : undefined}
      deadline={d.deadline}
      offset={offset}
      pickMs={view.settings.pickSeconds * 1000}
      rivals={rivals}
      log={log}
      onPick={send}
      statusNote={!d.shared && !turnsMode && iPicked ? `Locked in. Waiting for ${turnName}…` : undefined}
    />
  );
}

/* ═════════════════════════════ Setup ═════════════════════════════ */

function SetupRoom({ conn, view, offset }: PhaseProps) {
  const squad = view.squads[view.you]!;
  const st = view.setup!;
  const cpus = view.seats.filter((s) => s.bot).length;
  return (
    <SetupScreen
      squad={squad}
      mode={view.settings.ratings}
      deadline={st.deadline}
      offset={offset}
      totalMs={SETUP_SECONDS * 1000}
      ready={!!st.ready[view.you]}
      rivals={humansOf(view).filter((s) => s.id !== view.you).map((s) => ({ id: s.id, name: s.name, hue: s.hue, ready: !!st.ready[s.id], connected: s.connected }))}
      onFormation={(f) => conn.send({ t: 'formation', formation: f })}
      onSwap={(a, b) => conn.send({ t: 'swap', a, b })}
      onArrange={() => conn.send({ t: 'arrange' })}
      onStyle={(s) => conn.send({ t: 'style', style: s })}
      onReady={(r) => conn.send({ t: 'ready', ready: r })}
      title="Set your lineup"
      subtitle={cpus ? `${cpus} CPU team${cpus === 1 ? ' has' : 's have'} drafted too. Choose a formation and tactics. Nobody sees yours until kick-off.` : 'Choose a formation and style. Nobody sees your choices until kick-off.'}
      readyLabel="Lock in and kick off"
    />
  );
}

/* ═════════════════════════════ Matchday ═════════════════════════════ */

function MatchRoom({ conn, view, offset }: PhaseProps) {
  const comp = view.comp!;
  const day = view.day!;
  const you = view.you;
  const today = currentDay(comp);
  const seats = useMemo(() => seatMap(view.seats), [view.seats]);
  const mine = today.fixtures.find((f) => f.humans.includes(you));
  const done = !!day.seen[you];
  const waiting = humansOf(view).filter((s) => s.connected && !day.seen[s.id] && s.id !== you).map((s) => s.name);
  const [spectate, setSpectate] = useState<string | null>(null);

  const mineFx = useMemo(
    () => (mine?.result ? [fixtureFor(view, mine)] : null),
    // the result never changes during a matchday; the key avoids rebuilding the whole movie on every state message
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [day.startedAt, mine?.id],
  );
  const watchFx = useMemo(() => {
    const f = spectate ? today.fixtures.find((x) => x.id === spectate) : null;
    return f?.result ? [fixtureFor(view, f)] : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day.startedAt, spectate]);

  if (mine && mineFx) {
    return (
      <MatchPlayer
        key={`${comp.day}-${mine.id}`}
        fixtures={mineFx}
        pace={view.settings.pace}
        startAt={day.startedAt - offset}
        you={() => (mine.a === you ? 0 : 1)}
        onSeen={() => undefined}
        continueLabel={done ? undefined : comp.kind === 'match' ? 'See the result' : 'Continue'}
        onContinue={() => conn.send({ t: 'seen' })}
        waitingFor={done ? `Waiting for ${waiting.join(', ') || 'the others'} to finish watching…` : null}
      />
    );
  }

  // no fixture for me today: knocked out, or a bye
  const others = today.fixtures.filter((f) => f.humans.length > 0 && f.result);
  if (watchFx) {
    return (
      <MatchPlayer
        key={`spec-${spectate}`}
        fixtures={watchFx}
        pace={view.settings.pace}
        startAt={day.startedAt - offset}
        you={() => null}
        onSeen={() => undefined}
        continueLabel="Back"
        onContinue={() => setSpectate(null)}
      />
    );
  }
  const alive = isAlive(comp, you);
  return (
    <div className="gate panel gate--wide">
      <h1>{alive ? 'No match for you this matchday' : 'You are out of the tournament'}</h1>
      <p className="muted">{alive ? 'You have a bye. Sit tight, the next matchday is coming.' : 'The tournament goes on. You can watch your friend live, or wait for the next screen.'}</p>
      {others.map((f) => (
        <div key={f.id} className="spec">
          <TeamName seat={seats.get(f.a)} you={you} /> <i>v</i> <TeamName seat={seats.get(f.b)} you={you} />
          <Button variant="primary" icon="play" onClick={() => setSpectate(f.id)}>Watch live</Button>
        </div>
      ))}
      <p className="muted"><Icon name="clock" size={16} /> Waiting for {waiting.join(', ') || 'the others'}…</p>
    </div>
  );
}

/* ═════════════════════════════ Hub (between matchdays) ═════════════════════════════ */

function HubRoom({ conn, view, offset }: PhaseProps) {
  const comp = view.comp!;
  const hub = view.hub!;
  const you = view.you;
  const seats = useMemo(() => seatMap(view.seats), [view.seats]);
  const [tab, setTab] = useState<'table' | 'lineup'>('table');
  const squad = view.squads[you]!;
  const playedDays = hub.played.map((i) => comp.days[i]).filter((d): d is NonNullable<typeof d> => !!d);
  const next = comp.days[comp.day];
  const nextMine = next?.fixtures.find((f) => f.humans.includes(you));
  const oppId = nextMine ? (nextMine.a === you ? nextMine.b : nextMine.a) : null;
  const opp = oppId ? seats.get(oppId) : undefined;
  const oppProf = oppId && view.squads[oppId] ? profile(view.squads[oppId]!) : null;
  const myProf = profile(squad);
  const info = roundsInfo(comp);
  const ready = !!hub.ready[you];
  const alive = isAlive(comp, you);
  const waiting = humansOf(view).filter((s) => s.connected && !hub.ready[s.id] && s.id !== you);
  const cpuFx = playedDays.flatMap((d) => d.fixtures).filter((f) => !f.humans.length);
  const humanFx = playedDays.flatMap((d) => d.fixtures).filter((f) => f.humans.length);

  if (tab === 'lineup') {
    return (
      <div>
        <div className="hubtabs" role="tablist" aria-label="Between matchdays">
          <button role="tab" aria-selected={false} className="tab" onClick={() => setTab('table')}>Table and results</button>
          <button role="tab" aria-selected className="tab is-on">Lineup and tactics</button>
        </div>
        <SetupScreen
          squad={squad}
          mode={view.settings.ratings}
          deadline={hub.deadline}
          offset={offset}
          totalMs={HUB_SECONDS * 1000}
          ready={ready}
          rivals={humansOf(view).filter((s) => s.id !== you).map((s) => ({ id: s.id, name: s.name, hue: s.hue, ready: !!hub.ready[s.id], connected: s.connected }))}
          onFormation={(f) => conn.send({ t: 'formation', formation: f })}
          onSwap={(a, b) => conn.send({ t: 'swap', a, b })}
          onArrange={() => conn.send({ t: 'arrange' })}
          onStyle={(s) => conn.send({ t: 'style', style: s })}
          onReady={(r) => conn.send({ t: 'ready', ready: r })}
          title="Tweak your lineup"
          subtitle={opp ? `Next up: ${opp.name}${oppProf ? ` (overall ${oppProf.overall.toFixed(1)})` : ''}. Their tactics stay hidden until kick-off.` : 'Change formation, swap players or switch tactics before the next matchday.'}
          readyLabel="Ready for the next matchday"
          opponent={opp && oppProf ? { name: opp.name, overall: oppProf.overall, stage: next?.label ?? 'Next' } : undefined}
        />
      </div>
    );
  }

  return (
    <div className="hub">
      <header className="setup__head">
        <div>
          <p className="eyebrow">{compName(comp.kind)}{info.total ? ` · round ${Math.min(info.index, info.total)} of ${info.total}` : ''}</p>
          <h1>{playedDays.length === 1 ? `${playedDays[0]!.label} complete` : 'Results are in'}</h1>
          <p className="muted">
            {alive ? 'Take a look at the table, tweak your lineup, then get ready.' : 'You are out, but the tournament carries on. Watch the table fill in.'}
          </p>
        </div>
        <Timer deadline={hub.deadline} offset={offset} totalMs={HUB_SECONDS * 1000} size={56} />
      </header>

      <div className="hubtabs" role="tablist" aria-label="Between matchdays">
        <button role="tab" aria-selected className="tab is-on">Table and results</button>
        <button role="tab" aria-selected={false} className="tab" onClick={() => setTab('lineup')}>Lineup and tactics</button>
      </div>

      <div className="hub__grid">
        <section className="panel">
          <h2 className="panel__title">Your results</h2>
          <div className="fxlist">
            {humanFx.length ? humanFx.map((f) => <FixtureRow key={f.id} fx={f} seats={seats} you={you} />) : <p className="muted">No match for you this round.</p>}
          </div>
          {cpuFx.length > 0 && (
            <>
              <h2 className="panel__title panel__title--sub"><Icon name="cpu" size={16} /> CPU results <span className="count">{cpuFx.length}</span></h2>
              <div className="fxlist fxlist--cpu">
                {cpuFx.map((f, i) => (
                  <div key={f.id} className="fxlist__item" style={{ animationDelay: `${Math.min(i, 12) * 70}ms` }}>
                    <FixtureRow fx={f} seats={seats} you={you} showScorers={false} />
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="panel">
          <h2 className="panel__title">{comp.kind === 'knockout' ? 'Bracket' : 'Standings'}</h2>
          <CompetitionTables comp={comp} seats={seats} you={you} />
        </section>
      </div>

      <section className="panel nextup">
        {opp && nextMine ? (
          <div>
            <p className="eyebrow">Next: {next?.label}</p>
            <h2>You v <TeamName seat={opp} you={you} /></h2>
            <p className="muted">Your overall {myProf.overall.toFixed(1)}{oppProf ? ` · theirs ${oppProf.overall.toFixed(1)}` : ''}. {opp.bot ? 'A CPU team.' : 'Your friend. Their lineup stays hidden.'}</p>
          </div>
        ) : (
          <div>
            <p className="eyebrow">Next: {next?.label}</p>
            <h2>{alive ? 'A bye for you' : 'Watching on'}</h2>
            <p className="muted">{alive ? 'No match for you next matchday.' : 'Your friend plays on. You will see their match live if they are in this round.'}</p>
          </div>
        )}
        <div className="nextup__cta">
          {ready ? (
            <div className="readybar__row">
              <span className="readybar__wait"><Icon name="check" size={18} /> {waiting.length ? `Ready. Waiting for ${waiting.map((w) => w.name).join(', ')}…` : 'Ready. Here we go!'}</span>
              <Button variant="ghost" size="sm" onClick={() => conn.send({ t: 'ready', ready: false })}>Not yet</Button>
            </div>
          ) : (
            <Button variant="primary" size="lg" icon="whistle" onClick={() => { sfx.whistle(); conn.send({ t: 'ready', ready: true }); }}>Ready for the next matchday</Button>
          )}
        </div>
      </section>
    </div>
  );
}

/* ═════════════════════════════ Result ═════════════════════════════ */

function ResultRoom({ conn, view }: { conn: RoomConnection; view: RoomView }) {
  const comp = view.comp!;
  const you = view.you;
  const isHost = view.hostId === you;
  const seats = useMemo(() => seatMap(view.seats), [view.seats]);
  const humans = humansOf(view);
  const [replay, setReplay] = useState<string | null>(null);
  const [tab, setTab] = useState(you);
  const champ = comp.champion;
  const youWon = champ === you;
  const champSeat = champ ? seats.get(champ) : undefined;
  const last = view.series.log[view.series.log.length - 1];
  const want = !!view.rematch[you];
  const waiting = humans.filter((s) => s.connected && !view.rematch[s.id]);
  const lastDay = comp.days[comp.days.length - 1]!;
  const finalFx = lastDay.fixtures[0]!;
  const myFixtures = comp.days.flatMap((d) => d.fixtures).filter((f) => f.humans.includes(you) && f.lite);

  useEffect(() => {
    if (youWon) sfx.win();
  }, [youWon]);

  const shareText = useMemo(() => {
    const lines = [`${BRAND.name} · ${compName(comp.kind)} · ${champSeat ? `${champSeat.name}${champSeat.bot ? ' (CPU)' : ''} won` : 'no winner'}`];
    const prof = profile(view.squads[you]!);
    lines.push(`My XI: ${FORMATIONS[view.squads[you]!.formation].name} · ${prof.overall.toFixed(1)} OVR · ${prof.chem.score}% chem`);
    if (myFixtures.length) lines.push(myFixtures.map((f) => { const l = f.lite!; const w = l.winner === (f.a === you ? 0 : 1); return l.winner === null ? '🟨' : w ? '🟩' : '🟥'; }).join(''));
    return lines.join('\n');
  }, [view, you, champSeat, comp.kind, myFixtures]);

  const replayFx = useMemo(() => {
    if (!replay) return null;
    const f = comp.days.flatMap((d) => d.fixtures).find((x) => x.id === replay);
    return f?.result ? [fixtureFor(view, f)] : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay]);

  if (replayFx) {
    return (
      <MatchPlayer fixtures={replayFx} pace={view.settings.pace} startAt={Date.now() + 1500} you={() => null} onSeen={() => undefined} continueLabel="Back to results" onContinue={() => setReplay(null)} />
    );
  }

  const viewSquad = view.squads[tab] ?? view.squads[you]!;
  const viewChem = chemistry(viewSquad);
  const replayable = comp.days.flatMap((d) => d.fixtures).filter((f) => f.result && (f.a === you || f.b === you || comp.kind === 'match'));

  return (
    <div className="result">
      {youWon && <Confetti burst="win" count={60} />}
      <section className={cx('panel winner', youWon && 'winner--you')}>
        <p className="eyebrow">{comp.kind === 'match' ? 'Full time' : compName(comp.kind)}</p>
        <h1>{youWon ? (comp.kind === 'match' ? 'You win!' : 'You are champion!') : champSeat ? `${champSeat.name} ${comp.kind === 'match' ? 'wins' : 'are champions'}` : 'All square'}</h1>
        <p className="winner__sum">{last?.summary}</p>
        {comp.kind !== 'match' && <ChampionBanner id={champ} seats={seats} you={you} />}
        {comp.kind === 'match' && finalFx.lite && <p className="winner__head">“{finalFx.lite.headline}”</p>}

        {humans.length === 2 ? (
          <div className="series" aria-label="Series score">
            <div className={cx('series__side', champ === humans[0]!.id && 'is-win')}><Avatar name={humans[0]!.name} hue={humans[0]!.hue} size={40} /><span>{humans[0]!.name}</span></div>
            <div className="series__score"><b>{view.series.wins[humans[0]!.id] ?? 0}</b><i>–</i><b>{view.series.wins[humans[1]!.id] ?? 0}</b><small>series · game {view.game}</small></div>
            <div className={cx('series__side', champ === humans[1]!.id && 'is-win')}><Avatar name={humans[1]!.name} hue={humans[1]!.hue} size={40} /><span>{humans[1]!.name}</span></div>
          </div>
        ) : (
          <div className="serieslist" aria-label="Series wins">
            {humans.map((h) => <span key={h.id} className={cx('chip', champ === h.id && 'chip--ok')}><Avatar name={h.name} hue={h.hue} size={18} /> {h.name}: {view.series.wins[h.id] ?? 0} title{(view.series.wins[h.id] ?? 0) === 1 ? '' : 's'}</span>)}
          </div>
        )}

        <div className="row row--center">
          <Button variant="primary" size="lg" icon="refresh" onClick={() => conn.send({ t: 'rematch', want: !want })} aria-pressed={want}>
            {want ? (waiting.length ? `Ready. Waiting for ${waiting.map((w) => w.name).join(', ')}…` : 'Starting…') : 'Play again'}
          </Button>
          {replayable.length > 0 && <Button variant="soft" icon="play" onClick={() => setReplay(replayable[replayable.length - 1]!.id)}>{comp.kind === 'match' ? 'Watch again' : 'Watch your last match'}</Button>}
          <Button variant="soft" icon="share" onClick={() => shareOrCopy({ title: BRAND.name, text: shareText, url: location.origin })}>Share result</Button>
          {isHost && <Button variant="ghost" onClick={() => conn.send({ t: 'lobby' })}>Change settings</Button>}
        </div>
      </section>

      {comp.kind !== 'match' && (
        <section className="panel">
          <h2 className="panel__title">The tournament</h2>
          <CompetitionTables comp={comp} seats={seats} you={you} />
        </section>
      )}

      <section className="panel">
        <h2 className="panel__title">{comp.kind === 'match' ? 'Match report' : 'Your matches'}</h2>
        <div className="fxlist">
          {(comp.kind === 'match' ? [finalFx] : myFixtures).map((f) => <FixtureRow key={f.id} fx={f} seats={seats} you={you} />)}
          {comp.kind !== 'match' && myFixtures.length === 0 && <p className="muted">You did not play a match this time.</p>}
        </div>
        {comp.kind === 'match' && finalFx.result && (
          <div className="report__motm">
            <Icon name="crown" size={16} />
            <span>Man of the match: <b>{player(finalFx.result.motm.player).name}</b> ({finalFx.result.motm.reason})</span>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="tabs" role="tablist" aria-label="Squads">
          {humans.map((s) => (
            <button key={s.id} role="tab" aria-selected={tab === s.id} className={cx('tab', tab === s.id && 'is-on')} onClick={() => setTab(s.id)}>
              <Avatar name={s.name} hue={s.hue} size={18} /> {s.id === you ? 'You' : s.name}
            </button>
          ))}
        </div>
        <div className="squadview">
          <Pitch formation={viewSquad.formation} slots={viewSquad.slots} links={viewChem.links} linkCount={viewChem.perSlot} ratings="full" label="Final lineup" />
          <ul className="roster">
            {Object.entries(viewSquad.slots).map(([slot, pid]) => {
              if (!pid) return null;
              const role = FORMATIONS[viewSquad.formation].slots.find((s) => s.id === slot)!.role;
              const p = player(pid);
              return <li key={slot}><b className="roster__ovr">{p.ovr}</b><span>{p.name}</span><i>{role}</i></li>;
            })}
          </ul>
        </div>
      </section>
    </div>
  );
}
