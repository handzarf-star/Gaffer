import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BRAND } from '../../shared/brand';
import { FORMAT_INFO, type DraftFormat, type RatingsMode } from '../../shared/draft';
import { FORMATIONS, FORMATION_IDS } from '../../shared/formations';
import { POOLS, player, shortName, type PoolId } from '../../shared/players';
import { EMOTES, MAX_SEATS, MIN_SEATS, PICK_SECONDS, type ErrorCode, type RoomView, type Seat } from '../../shared/protocol';
import { SETUP_SECONDS, standings } from '../../shared/room';
import { chemistry, profile } from '../../shared/squad';
import { Confetti } from '../components/Confetti';
import { Pitch } from '../components/Pitch';
import { Avatar, Banner, Button, Icon, Seg, Spinner, copyText, cx, shareOrCopy } from '../components/ui';
import { navigate, toast, useScrollTop } from '../lib/hooks';
import { useRoom, type RoomConnection } from '../lib/net';
import { sfx } from '../lib/sfx';
import { getIdentity, getName, setName } from '../lib/storage';
import { DraftScreen, type DraftLogRow, type Rival } from './DraftScreen';
import { MatchPlayer, type MatchFixture } from './MatchPlayer';
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
  need_players: 'You need at least two players to start.',
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
  useScrollTop(view.phase + view.game);
  switch (view.phase) {
    case 'lobby': return <Lobby conn={conn} view={view} />;
    case 'draft': return <DraftRoom conn={conn} view={view} offset={offset} />;
    case 'setup': return <SetupRoom conn={conn} view={view} offset={offset} />;
    case 'match': return <MatchRoom conn={conn} view={view} offset={offset} />;
    case 'result': return <ResultRoom conn={conn} view={view} />;
  }
}

/* ═════════════════════════════ Lobby ═════════════════════════════ */

function Lobby({ conn, view }: { conn: RoomConnection; view: RoomView }) {
  const me = view.seats.find((s) => s.id === view.you)!;
  const isHost = view.hostId === view.you;
  const link = `${location.origin}/r/${view.code}`;
  const connected = view.seats.filter((s) => s.connected).length;
  const canStart = isHost && connected >= MIN_SEATS;
  const patch = (p: Partial<RoomView['settings']>) => conn.send({ t: 'settings', patch: p });
  const hostName = view.seats.find((s) => s.id === view.hostId)?.name ?? 'the host';
  const wins = view.series.wins;
  const [editName, setEditName] = useState(me.name);
  useEffect(() => setEditName(me.name), [me.name]);

  return (
    <div className="lobby">
      <section className="panel lobby__invite">
        <div>
          <p className="eyebrow">Room code</p>
          <div className="code" aria-label={`Room code ${view.code.split('').join(' ')}`}>
            {view.code.split('').map((c, i) => <span key={i} className="code__char">{c}</span>)}
          </div>
          <p className="muted">Send this link to your mate. It works on any phone or laptop.</p>
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
        <h2 className="panel__title">Players <span className="count">{view.seats.length}/{MAX_SEATS}</span></h2>
        <ul className="seats">
          {view.seats.map((s) => (
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
          {view.seats.length < MAX_SEATS && (
            <li className="seat seat--empty">
              <span className="seat__ghost"><Icon name="plus" /></span>
              <div className="seat__info"><b>Waiting for a friend…</b><span>Anyone with the link can join</span></div>
            </li>
          )}
        </ul>
      </section>

      <section className="panel settings">
        <h2 className="panel__title">Game settings {!isHost && <span className="muted tiny">{hostName} controls these</span>}</h2>
        <div className="setting">
          <label>Draft style</label>
          <div className="opts">
            {(['duel', 'packs'] as DraftFormat[]).map((f) => (
              <button key={f} disabled={!isHost} className={cx('opt', view.settings.format === f && 'is-on')} onClick={() => patch({ format: f })} aria-pressed={view.settings.format === f}>
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
              <button key={id} disabled={!isHost} className={cx('opt', view.settings.pool === id && 'is-on')} onClick={() => patch({ pool: id })} aria-pressed={view.settings.pool === id}>
                <b>{POOLS[id].name}</b>
                <span>{POOLS[id].blurb}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="setting setting--inline">
          <div>
            <label>Ratings on cards</label>
            <Seg<RatingsMode> label="Ratings on cards" disabled={!isHost} value={view.settings.ratings} onChange={(v) => patch({ ratings: v })} options={[
              { value: 'hidden', label: 'Hidden', hint: 'Pure football knowledge' },
              { value: 'tier', label: 'Stars', hint: 'Bronze to Icon tiers' },
              { value: 'full', label: 'Numbers', hint: 'Full ratings' },
            ]} />
          </div>
          <div>
            <label>Pick timer</label>
            <Seg<number> label="Pick timer" disabled={!isHost} value={view.settings.pickSeconds} onChange={(v) => patch({ pickSeconds: v as 0 | 15 | 25 | 40 })} options={PICK_SECONDS.map((s) => ({ value: s, label: s === 0 ? 'Off' : `${s}s` }))} />
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
            {canStart ? 'Start the draft' : 'Waiting for a second player…'}
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
  const seatOf = (id: string) => view.seats.find((s) => s.id === id);
  const turnId = d.shared ? d.order[d.turn] : undefined;
  const pending = !d.shared ? view.seats.filter((s) => !d.picked.includes(s.id) && s.id !== you) : [];
  const iPicked = d.picked.includes(you);

  const rivals: Rival[] = view.seats.filter((s) => s.id !== you).map((s) => ({
    id: s.id, name: s.name, hue: s.hue, squad: view.squads[s.id] ?? null, connected: s.connected,
    done: d.picked.includes(s.id), isTurn: turnId === s.id,
  }));

  const log: DraftLogRow[] = d.log.map((l, i) => {
    const s = seatOf(l.seat);
    return { key: `${l.round}-${l.seat}-${i}`, who: s?.name ?? '?', hue: s?.hue ?? 0, player: l.player, auto: l.auto, mine: l.seat === you };
  });

  let turn: 'me' | 'rival' | 'all';
  let turnName: string | undefined;
  let turnHue = 0;
  let canPick: boolean;
  if (d.shared) {
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
      deadline={d.deadline}
      offset={offset}
      pickMs={view.settings.pickSeconds * 1000}
      rivals={rivals}
      log={log}
      onPick={send}
      statusNote={!d.shared && iPicked ? `Locked in. Waiting for ${turnName}…` : undefined}
    />
  );
}

/* ═════════════════════════════ Setup ═════════════════════════════ */

function SetupRoom({ conn, view, offset }: PhaseProps) {
  const squad = view.squads[view.you]!;
  const st = view.setup!;
  return (
    <SetupScreen
      squad={squad}
      mode={view.settings.ratings}
      deadline={st.deadline}
      offset={offset}
      totalMs={SETUP_SECONDS * 1000}
      ready={!!st.ready[view.you]}
      rivals={view.seats.filter((s) => s.id !== view.you).map((s) => ({ id: s.id, name: s.name, hue: s.hue, ready: !!st.ready[s.id], connected: s.connected }))}
      onFormation={(f) => conn.send({ t: 'formation', formation: f })}
      onSwap={(a, b) => conn.send({ t: 'swap', a, b })}
      onArrange={() => conn.send({ t: 'arrange' })}
      onStyle={(s) => conn.send({ t: 'style', style: s })}
      onReady={(r) => conn.send({ t: 'ready', ready: r })}
      title="Set your lineup"
      subtitle="Choose a formation and style. Nobody sees your choices until kick-off."
      readyLabel="Lock in and kick off"
    />
  );
}

/* ═════════════════════════════ Match ═════════════════════════════ */

function fixturesOf(view: RoomView): MatchFixture[] {
  const m = view.match!;
  const hue = (id: string) => view.seats.find((s) => s.id === id)?.hue ?? 0;
  return m.fixtures.map((f) => ({
    a: { name: f.names[0], hue: hue(f.a), squad: view.squads[f.a]! },
    b: { name: f.names[1], hue: hue(f.b), squad: view.squads[f.b]! },
    result: f.result,
  }));
}

function MatchRoom({ conn, view, offset }: PhaseProps) {
  const m = view.match!;
  const fixtures = useMemo(() => fixturesOf(view), [view.match]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = !!m.seen[view.you];
  const waiting = view.seats.filter((s) => s.connected && !m.seen[s.id] && s.id !== view.you).map((s) => s.name);
  return (
    <MatchPlayer
      fixtures={fixtures}
      startAt={m.startedAt - offset}
      you={(i) => (m.fixtures[i]!.a === view.you ? 0 : m.fixtures[i]!.b === view.you ? 1 : null)}
      onSeen={() => undefined}
      continueLabel={done ? undefined : 'See the result'}
      onContinue={() => conn.send({ t: 'seen' })}
      waitingFor={done ? `Waiting for ${waiting.join(', ') || 'the others'} to finish watching…` : null}
    />
  );
}

/* ═════════════════════════════ Result ═════════════════════════════ */

function ResultRoom({ conn, view }: { conn: RoomConnection; view: RoomView }) {
  const m = view.match!;
  const you = view.you;
  const isHost = view.hostId === you;
  const [replay, setReplay] = useState(false);
  const [tab, setTab] = useState(you);
  const seatOf = (id: string) => view.seats.find((s) => s.id === id)!;
  const ids = view.seats.map((s) => s.id);
  const lastSeries = view.series.log[view.series.log.length - 1];
  const winnerId = lastSeries?.winner ?? null;
  const youWon = winnerId === you;
  const fixtures = useMemo(() => fixturesOf(view), [view.match]); // eslint-disable-line react-hooks/exhaustive-deps
  const table = useMemo(() => (m.knockout ? [] : standings(m.fixtures, ids)), [m, ids.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const f0 = m.fixtures[0]!;
  const want = !!view.rematch[you];
  const waiting = view.seats.filter((s) => s.connected && !view.rematch[s.id]);

  useEffect(() => {
    if (youWon) sfx.win();
  }, [youWon]);

  const shareText = useMemo(() => {
    const lines = [`${BRAND.name} · ${lastSeries?.summary ?? ''}`];
    const prof = profile(view.squads[you]!);
    lines.push(`My XI: ${FORMATIONS[view.squads[you]!.formation].name} · ${prof.overall.toFixed(1)} OVR · ${prof.chem.score}% chem`);
    if (view.series.games > 0 && ids.length === 2) lines.push(`Series: ${seatOf(ids[0]!).name} ${view.series.wins[ids[0]!] ?? 0}–${view.series.wins[ids[1]!] ?? 0} ${seatOf(ids[1]!).name}`);
    return lines.join('\n');
  }, [view, you, lastSeries, ids]); // eslint-disable-line react-hooks/exhaustive-deps

  if (replay) {
    return (
      <div>
        <MatchPlayer fixtures={fixtures} startAt={Date.now() + 1500} you={(i) => (m.fixtures[i]!.a === you ? 0 : m.fixtures[i]!.b === you ? 1 : null)} onSeen={() => undefined} continueLabel="Back to results" onContinue={() => setReplay(false)} />
      </div>
    );
  }

  const winnerName = winnerId ? seatOf(winnerId).name : null;
  const viewSquad = view.squads[tab]!;
  const viewChem = chemistry(viewSquad);

  return (
    <div className="result">
      {youWon && <Confetti burst="win" count={60} />}
      <section className={cx('panel winner', youWon && 'winner--you')}>
        <p className="eyebrow">{m.knockout ? 'Full time' : 'Table decided'}</p>
        <h1>{winnerName ? (youWon ? 'You win!' : `${winnerName} wins`) : 'All square'}</h1>
        <p className="winner__sum">{lastSeries?.summary}</p>
        {m.knockout && <p className="winner__head">“{f0.result.headline}”</p>}
        {ids.length === 2 ? (
          <div className="series" aria-label="Series score">
            <div className={cx('series__side', winnerId === ids[0] && 'is-win')}><Avatar name={seatOf(ids[0]!).name} hue={seatOf(ids[0]!).hue} size={40} /><span>{seatOf(ids[0]!).name}</span></div>
            <div className="series__score"><b>{view.series.wins[ids[0]!] ?? 0}</b><i>–</i><b>{view.series.wins[ids[1]!] ?? 0}</b><small>series · game {view.game}</small></div>
            <div className={cx('series__side', winnerId === ids[1] && 'is-win')}><Avatar name={seatOf(ids[1]!).name} hue={seatOf(ids[1]!).hue} size={40} /><span>{seatOf(ids[1]!).name}</span></div>
          </div>
        ) : (
          <table className="table" aria-label="League table">
            <thead><tr><th>#</th><th>Player</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead>
            <tbody>
              {table.map((r, i) => (
                <tr key={r.id} className={cx(i === 0 && 'is-top', r.id === you && 'is-me')}>
                  <td>{i + 1}</td><td><Avatar name={seatOf(r.id).name} hue={seatOf(r.id).hue} size={22} /> {seatOf(r.id).name}</td>
                  <td>{r.played}</td><td>{r.w}</td><td>{r.d}</td><td>{r.l}</td><td>{r.gf - r.ga > 0 ? '+' : ''}{r.gf - r.ga}</td><td><b>{r.pts}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="row row--center">
          <Button variant="primary" size="lg" icon="refresh" onClick={() => conn.send({ t: 'rematch', want: !want })} aria-pressed={want}>
            {want ? (waiting.length ? `Ready. Waiting for ${waiting.map((w) => w.name).join(', ')}…` : 'Starting…') : 'Play again'}
          </Button>
          <Button variant="soft" icon="play" onClick={() => setReplay(true)}>Watch again</Button>
          <Button variant="soft" icon="share" onClick={() => shareOrCopy({ title: BRAND.name, text: shareText, url: location.origin })}>Share result</Button>
          {isHost && <Button variant="ghost" onClick={() => conn.send({ t: 'lobby' })}>Change settings</Button>}
        </div>
      </section>

      <section className="panel">
        <h2 className="panel__title">Match report</h2>
        <div className="reports">
          {m.fixtures.map((f, i) => (
            <div className="report" key={i}>
              <div className="report__score">
                <span>{f.names[0]}</span>
                <b>{f.result.score[0]} – {f.result.score[1]}</b>
                <span>{f.names[1]}</span>
              </div>
              {f.result.pens && <small>{f.result.pens[0]}–{f.result.pens[1]} on penalties</small>}
              <div className="report__motm">
                <Icon name="crown" size={16} />
                <span>Man of the match: <b>{shortName(player(f.result.motm.player).name)}</b> ({f.result.motm.reason})</span>
              </div>
              <div className="goals">
                {f.result.events.filter((e) => e.type === 'goal').map((e, j) => (
                  <span key={j} className="goalchip" style={{ ['--t' as string]: e.team }}>⚽ {shortName(player(e.p!).name)} {e.t}'</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="tabs" role="tablist" aria-label="Squads">
          {view.seats.map((s) => (
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
