import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BRAND } from '../../shared/brand';
import { BOT_LEVELS, type BotLevel } from '../../shared/bots';
import { COMPETITIONS, currentDay, isAlive, roundsInfo, type CompFixture, type CompetitionKind } from '../../shared/competition';
import { FORMAT_INFO, type DraftFormat, type RatingsMode } from '../../shared/draft';
import { FORMATIONS, FORMATION_IDS } from '../../shared/formations';
import type { Lang, TFn, TnFn } from '../../shared/i18n';
import { headlineText, motmReasonText } from '../../shared/i18n/commentary';
import { player } from '../../shared/players';
import { ERAS, ERA_IDS, POOLS, POOL_IDS, eraCounts, poolHealth, poolKey, type EraId } from '../../shared/pools';
import { EMOTES, MAX_SEATS, PICK_SECONDS, type ErrorCode, type RoomView, type Seat } from '../../shared/protocol';
import { HUB_SECONDS, SETUP_SECONDS } from '../../shared/room';
import type { Pace } from '../../shared/sim';
import { chemistry, profile } from '../../shared/squad';
import { ChampionBanner, CompetitionTables, FixtureRow, TeamName, compName, seatMap, stageLabel } from '../components/CompViews';
import { Confetti } from '../components/Confetti';
import { Pitch } from '../components/Pitch';
import { Timer } from '../components/Timer';
import { Avatar, Banner, Button, Icon, Seg, Spinner, copyText, cx, shareOrCopy } from '../components/ui';
import { seatColor } from '../lib/colors';
import { navigate, toast, useScrollTop } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { useRoom, type RoomConnection } from '../lib/net';
import { sfx } from '../lib/sfx';
import { getIdentity, getName, setName } from '../lib/storage';
import { DraftScreen, type DraftLogRow, type Rival } from './DraftScreen';
import { MatchPlayer, type MatchFixture, type MatchSide } from './MatchPlayer';
import { SetupScreen } from './SetupScreen';

/** What the player sees when the server refuses something. A code the client does not know yet falls back to the server's own (static) message. */
function friendly(code: ErrorCode, msg: string, t: TFn): string {
  switch (code) {
    case 'bad_message': return t('Something went wrong sending that. Try again.');
    case 'no_room': return t('That room does not exist.');
    case 'room_full': return t('This room is full.');
    case 'in_progress': return t('This game has already started.');
    case 'bad_secret': return t('That seat belongs to another device.');
    case 'not_host': return t('Only the host can do that.');
    case 'wrong_phase': return t('That is not possible right now.');
    case 'not_your_turn': return t('Not your turn yet.');
    case 'stale_round': return t('That round just ended.');
    case 'bad_card': return t('Somebody got that card first.');
    case 'bad_slot': return t('That spot is already taken.');
    case 'need_players': return t('You need at least two teams to start. Add CPU teams or invite a friend.');
    case 'bad_settings': return t('That combination does not work. Try a different number of teams.');
    case 'rate_limited': return t('Easy there. Slow down a little.');
    case 'internal': return t('Something went wrong on our side. That move was not applied; try again.');
    case 'kicked': return t('You were removed from the room.');
    default: return t(msg);
  }
}

function fatalCopy(code: string, t: TFn): { title: string; body: string } | undefined {
  switch (code) {
    case 'no_room': return { title: t('Room not found'), body: t('Check the code, or ask your friend to create a fresh room.') };
    case 'room_full': return { title: t('This room is full'), body: t('Rooms hold up to {n} players.', { n: MAX_SEATS }) };
    case 'in_progress': return { title: t('That game has already started'), body: t('Ask the host to start a new room. If you were already playing, open the link on the device you started with.') };
    case 'bad_secret': return { title: t('That seat belongs to another device'), body: t('Reload to join as a new player if the game has not started yet.') };
    case 'kicked': return { title: t('You were removed from the room'), body: t('The host removed you. You can create your own room.') };
    default: return undefined;
  }
}

/** The lobby's "too few players" warning is built by the pool code in English; rebuilt here from its numbers when the reader is not on English. */
function poolProblem(problem: string, lang: Lang, t: TFn, tn: TnFn): string {
  if (lang === 'en') return problem;
  const m = /^Only (\d+) players here(?:, and too few (.+))?, which is thin for (\d+) teams\. Add another era or choose a bigger pool\.$/.exec(problem);
  if (!m) return problem;
  const line = (w: string): string => {
    switch (w) {
      case 'goalkeepers': return t('goalkeepers');
      case 'defenders': return t('defenders');
      case 'midfielders': return t('midfielders');
      case 'attackers': return t('attackers');
      default: return w;
    }
  };
  const parts = [tn('Only {n} player here', 'Only {n} players here', Number(m[1])) + '.'];
  if (m[2]) {
    const lines = m[2].split(' and ').map(line);
    parts.push(t('Missing: {lines}.', { lines: lines.length > 1 ? t('{a} and {b}', { a: lines.slice(0, -1).join(', '), b: lines[lines.length - 1]! }) : lines[0]! }));
  }
  parts.push(tn('That is thin for {n} team.', 'That is thin for {n} teams.', Number(m[3])));
  parts.push(t('Add another era or choose a bigger pool.'));
  return parts.join(' ');
}

/** "Name 2-1 Name (5-4 pens)" and "Name won the league" are written by the room engine; only the words around the names are translated. */
function seriesSummary(summary: string, lang: Lang, t: TFn): string {
  if (lang === 'en') return summary;
  if (summary === 'No champion') return t('No champion');
  let m = /^(.*) \((\d+)-(\d+) pens\)$/.exec(summary);
  if (m) return `${m[1]} (${t('{a}-{b} pens', { a: m[2]!, b: m[3]! })})`;
  m = /^(.*) won the (single match|league|groups \+ knockout|knockout)$/.exec(summary);
  if (m) {
    const kind = (Object.keys(COMPETITIONS) as CompetitionKind[]).find((k) => COMPETITIONS[k].name.toLowerCase() === m![2]);
    if (kind) return t('{name} won the {comp}', { name: m[1]!, comp: t(COMPETITIONS[kind].name).toLowerCase() });
  }
  return summary;
}

export function RoomPage({ code }: { code: string }) {
  const { t } = useI18n();
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

  if (exists === 'no') {
    const c = fatalCopy('no_room', t)!;
    return <Fatal title={c.title} body={c.body} />;
  }
  if (!ready) {
    return (
      <div className="gate panel">
        <h1>{t('Join room')} <span className="mono">{code}</span></h1>
        <p>{t('What should we call you?')}</p>
        <NameForm onSubmit={(n) => { setName(n); setNameState(n); }} cta={t('Join the room')} />
      </div>
    );
  }
  return <Connected code={code} ready={exists !== 'unknown'} />;
}

function NameForm({ onSubmit, cta, initial = '' }: { onSubmit: (n: string) => void; cta: string; initial?: string }) {
  const { t } = useI18n();
  const [v, setV] = useState(initial);
  return (
    <form className="nameform" onSubmit={(e) => { e.preventDefault(); const n = v.trim(); if (n) onSubmit(n.slice(0, 16)); }}>
      <label className="sr-only" htmlFor="nm">{t('Your name')}</label>
      <input id="nm" className="input" autoFocus autoComplete="nickname" maxLength={16} placeholder={t('Your name')} value={v} onChange={(e) => setV(e.target.value)} />
      <Button type="submit" variant="primary" disabled={!v.trim()}>{cta}</Button>
    </form>
  );
}

function Fatal({ title, body }: { title: string; body: string }) {
  const { t } = useI18n();
  return (
    <div className="gate panel">
      <h1>{title}</h1>
      <p>{body}</p>
      <div className="row">
        <Button variant="primary" onClick={() => navigate('/')}>{t('Back to home')}</Button>
        <Button variant="ghost" onClick={() => location.reload()}>{t('Try again')}</Button>
      </div>
    </div>
  );
}

function Connected({ code, ready }: { code: string; ready: boolean }) {
  const { t } = useI18n();
  const { conn, state } = useRoom(code, ready);
  const [floaters, setFloaters] = useState<Array<{ id: number; e: string; name: string; x: number }>>([]);
  const idRef = useRef(1);

  useEffect(() => {
    conn.onError = (c, m) => {
      toast(friendly(c, m, t), 'error');
      sfx.error();
    };
    conn.onEmote = (from, e) => {
      const view = conn.getSnapshot().view;
      const seat = view?.seats.find((s) => s.id === from);
      const id = idRef.current++;
      setFloaters((f) => [...f.slice(-6), { id, e, name: seat?.name ?? '', x: 10 + Math.random() * 70 }]);
      setTimeout(() => setFloaters((f) => f.filter((x) => x.id !== id)), 2800);
    };
  }, [conn, t]);

  if (state.fatal) {
    const c = fatalCopy(state.fatal.code, t);
    return <Fatal title={c?.title ?? t('Could not join')} body={c?.body ?? t(state.fatal.msg)} />;
  }
  const view = state.view;
  if (!view) {
    return (
      <div className="gate gate--loading">
        <Spinner size={36} />
        <p>{state.status === 'reconnecting' ? t('Reconnecting…') : t('Joining room {code}…', { code })}</p>
        {state.attempt > 2 && <p className="muted">{t('Taking a while. Check your connection.')}</p>}
      </div>
    );
  }
  return (
    <>
      {state.status !== 'live' && (
        <Banner tone="warn" icon="wifioff">{t('Connection lost. Reconnecting… your seat is saved and you can keep the page open.')}</Banner>
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
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const slot = document.getElementById('topbar-slot');
  const ui = (
    <div className="emotes">
      <button type="button" className={cx('iconbtn', open && 'is-on')} onClick={() => setOpen((o) => !o)} aria-label={open ? t('Close reactions') : t('Send a reaction')} aria-expanded={open} title={t('Send a reaction')}>
        <span className="emotes__face" aria-hidden="true">🙂</span>
      </button>
      {open && (
        <div className="emotes__pop" role="menu" aria-label={t('Reactions')}>
          {EMOTES.map((e) => (
            <button key={e} role="menuitem" className="emote" onClick={() => { conn.send({ t: 'emote', e }); setOpen(false); }} aria-label={t('Send {e}', { e })}>{e}</button>
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
  const { t, tn, lang } = useI18n();
  const humans = humansOf(view);
  const me = view.seats.find((s) => s.id === view.you)!;
  const isHost = view.hostId === view.you;
  const link = `${location.origin}/r/${view.code}`;
  const connected = humans.filter((s) => s.connected).length;
  const set = view.settings;
  const cpus = Math.max(0, set.teams - humans.length);
  const depth = useMemo(() => poolHealth(poolKey(set.pool, set.eras ?? []), set.teams), [set.pool, set.eras, set.teams]);
  const eraTotals = useMemo(() => eraCounts(set.pool), [set.pool]);
  const toggleEra = (e: EraId) => {
    const cur = new Set<EraId>(set.eras.length ? set.eras : ERA_IDS);
    if (cur.has(e)) {
      if (cur.size === 1) return; // never leave the pool empty
      cur.delete(e);
    } else cur.add(e);
    patch({ eras: cur.size === ERA_IDS.length ? [] : ERA_IDS.filter((x) => cur.has(x)) });
  };
  const canStart = isHost && connected >= 1 && set.teams >= 2 && depth.ok;
  const patch = (p: Partial<RoomView['settings']>) => conn.send({ t: 'settings', patch: p });
  const hostName = view.seats.find((s) => s.id === view.hostId)?.name ?? t('the host');
  const wins = view.series.wins;
  const [editName, setEditName] = useState(me.name);
  useEffect(() => setEditName(me.name), [me.name]);
  const teamOptions = COMPETITIONS[set.competition].teamOptions.filter((n) => n >= humans.length);

  return (
    <div className="lobby">
      <section className="panel lobby__invite">
        <div>
          <p className="eyebrow">{t('Room code')}</p>
          <div className="code" aria-label={t('Room code {code}', { code: view.code.split('').join(' ') })}>
            {view.code.split('').map((c, i) => <span key={i} className="code__char">{c}</span>)}
          </div>
          <p className="muted">{t('Send this link to your mate. It works on any phone or laptop. Playing on one device? Just add CPU teams below.')}</p>
        </div>
        <div className="lobby__share">
          <input className="input input--link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label={t('Invite link')} />
          <div className="row">
            <Button variant="primary" icon="copy" onClick={() => copyText(link)}>{t('Copy link')}</Button>
            <Button variant="soft" icon="share" onClick={() => shareOrCopy({ title: t('Join my {brand} room', { brand: BRAND.name }), text: t('Join my {brand} room (code {code})', { brand: BRAND.name, code: view.code }), url: link })}>{t('Share')}</Button>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel__title">{t('Players')} <span className="count">{humans.length}/{MAX_SEATS}</span></h2>
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
                    aria-label={t('Your name')}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => { const n = editName.trim(); if (n && n !== me.name) { setName(n); conn.send({ t: 'name', name: n }); } else setEditName(me.name); }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
                  />
                ) : <b>{s.name}</b>}
                <span>
                  {s.id === view.hostId && <><Icon name="crown" size={13} /> {t('Host')} · </>}
                  {s.connected ? t('Connected') : t('Disconnected')}
                  {view.series.games > 0 && ` · ${tn('{n} win', '{n} wins', wins[s.id] ?? 0)}`}
                </span>
              </div>
              {isHost && s.id !== view.you && <Button size="sm" variant="ghost" onClick={() => conn.send({ t: 'kick', id: s.id })} aria-label={t('Remove {name}', { name: s.name })}>{t('Remove')}</Button>}
            </li>
          ))}
          {humans.length < MAX_SEATS && (
            <li className="seat seat--empty">
              <span className="seat__ghost"><Icon name="plus" /></span>
              <div className="seat__info"><b>{t('Waiting for a friend…')}</b><span>{t('Anyone with the link can join')}</span></div>
            </li>
          )}
          {cpus > 0 && (
            <li className="seat seat--cpu">
              <span className="seat__ghost seat__ghost--cpu"><Icon name="cpu" /></span>
              <div className="seat__info"><b>{tn('{n} CPU team', '{n} CPU teams', cpus)}</b><span>{t('{level} level. They draft after you and play the rest of the fixtures.', { level: t(BOT_LEVELS[set.botLevel].name) })}</span></div>
            </li>
          )}
        </ul>
      </section>

      <section className="panel settings">
        <h2 className="panel__title">{t('Competition')} {!isHost && <span className="muted tiny">{t('{host} controls these', { host: hostName })}</span>}</h2>
        <div className="setting">
          <label>{t('Format')}</label>
          <div className="opts">
            {(Object.keys(COMPETITIONS) as CompetitionKind[]).map((k) => (
              <button key={k} disabled={!isHost} className={cx('opt', set.competition === k && 'is-on')} onClick={() => patch({ competition: k })} aria-pressed={set.competition === k}>
                <b>{t(COMPETITIONS[k].name)}</b>
                <span>{t(COMPETITIONS[k].blurb)}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="setting setting--inline">
          <div>
            <label>{t('Teams')}</label>
            <Seg<number> label={t('Teams')} disabled={!isHost || teamOptions.length < 2} value={set.teams} onChange={(v) => patch({ teams: v })} options={teamOptions.map((n) => ({ value: n, label: String(n) }))} />
            <p className="muted tiny setting__note">{tn('{n} human', '{n} humans', humans.length)} + {cpus} CPU</p>
          </div>
          <div>
            <label>{t('CPU level')}</label>
            <Seg<BotLevel> label={t('CPU level')} disabled={!isHost || cpus === 0} value={set.botLevel} onChange={(v) => patch({ botLevel: v })} options={(Object.keys(BOT_LEVELS) as BotLevel[]).map((l) => ({ value: l, label: t(BOT_LEVELS[l].name), hint: t(BOT_LEVELS[l].blurb) }))} />
          </div>
        </div>
        <div className="setting setting--inline">
          <div>
            <label>{t('Match speed')}</label>
            <Seg<Pace> label={t('Match speed')} disabled={!isHost} value={set.pace} onChange={(v) => patch({ pace: v })} options={[{ value: 'quick', label: t('Quick'), hint: t('About 55 seconds a match') }, { value: 'normal', label: t('Normal'), hint: t('About 90 seconds a match') }]} />
          </div>
          {set.competition === 'league' && (
            <div>
              <label>{t('League length')}</label>
              <Seg<number> label={t('League length')} disabled={!isHost} value={set.legs} onChange={(v) => patch({ legs: v as 1 | 2 })} options={[{ value: 1, label: t('Play everyone once') }, { value: 2, label: t('Home and away') }]} />
            </div>
          )}
        </div>
        <p className="settings__tip"><Icon name="info" size={16} /> {t('You only watch matches a human plays in. CPU-versus-CPU games resolve instantly, and the table updates between matchdays.')}</p>
      </section>

      <section className="panel settings">
        <h2 className="panel__title">{t('Draft')}</h2>
        <div className="setting">
          <label>{t('Draft style')}</label>
          <div className="opts opts--3">
            {(['duel', 'packs', 'turns'] as DraftFormat[]).map((f) => (
              <button key={f} disabled={!isHost} className={cx('opt', set.format === f && 'is-on')} onClick={() => patch({ format: f })} aria-pressed={set.format === f}>
                <b>{t(FORMAT_INFO[f].name)}</b>
                <span>{t(FORMAT_INFO[f].blurb)}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="setting">
          <label>{t('Player pool')}</label>
          <div className="opts opts--3">
            {POOL_IDS.map((id) => (
              <button key={id} disabled={!isHost} className={cx('opt', set.pool === id && 'is-on')} onClick={() => patch({ pool: id, eras: [] })} aria-pressed={set.pool === id}>
                <b>{t(POOLS[id].name)}</b>
                <span>{t(POOLS[id].blurb)}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="setting">
          <label>{t('Eras')} <span className="muted tiny">{t('tap to leave one out; all are on by default')}</span></label>
          <div className="eras" role="group" aria-label={t('Eras')}>
            {ERA_IDS.map((e) => {
              const on = set.eras.length === 0 || set.eras.includes(e);
              return (
                <button key={e} type="button" disabled={!isHost || eraTotals[e] === 0} className={cx('era', on && eraTotals[e] > 0 && 'is-on')} aria-pressed={on && eraTotals[e] > 0} onClick={() => toggleEra(e)}>
                  {t(ERAS[e].name)} <small>{eraTotals[e]}</small>
                </button>
              );
            })}
          </div>
          <p className={cx('pool__note', !depth.ok && 'is-warn')} role={depth.ok ? undefined : 'alert'}>{depth.ok ? tn('{n} players in the mix.', '{n} players in the mix.', depth.players) : poolProblem(depth.problem ?? '', lang, t, tn)}</p>
        </div>
        <div className="setting setting--inline">
          <div>
            <label>{t('Ratings on cards')}</label>
            <Seg<RatingsMode> label={t('Ratings on cards')} disabled={!isHost} value={set.ratings} onChange={(v) => patch({ ratings: v })} options={[
              { value: 'hidden', label: t('Hidden'), hint: t('Pure football knowledge') },
              { value: 'tier', label: t('Stars'), hint: t('Bronze to Icon tiers') },
              { value: 'full', label: t('Numbers'), hint: t('Full ratings') },
            ]} />
          </div>
          <div>
            <label>{t('Pick timer')}</label>
            <Seg<number> label={t('Pick timer')} disabled={!isHost} value={set.pickSeconds} onChange={(v) => patch({ pickSeconds: v as 0 | 15 | 25 | 40 })} options={PICK_SECONDS.map((s) => ({ value: s, label: s === 0 ? t('Off') : `${s}s` }))} />
          </div>
        </div>
        <div className="setting">
          <label>{t('Your formation')}</label>
          <Seg<string> label={t('Your formation')} value={me.formation} onChange={(v) => conn.send({ t: 'formation', formation: v as Seat['formation'] })} options={FORMATION_IDS.map((id) => ({ value: id, label: FORMATIONS[id].name }))} />
          <p className="muted tiny">{t('You can change it again after the draft.')}</p>
        </div>
      </section>

      <div className="lobby__cta">
        {isHost ? (
          <Button variant="primary" size="lg" block icon="whistle" disabled={!canStart} onClick={() => { sfx.whistle(); conn.send({ t: 'start' }); }}>
            {!depth.ok ? t('Too few players: add an era') : !canStart ? t('Add a CPU team or invite a friend') : connected === 1 && cpus > 0 ? tn('Start: you vs {n} CPU team', 'Start: you vs {n} CPU teams', cpus) : t('Start the draft')}
          </Button>
        ) : (
          <div className="waitcard"><Spinner size={22} /> {t('Waiting for {host} to start…', { host: hostName })}</div>
        )}
      </div>
    </div>
  );
}

/* ═════════════════════════════ Draft ═════════════════════════════ */

function DraftRoom({ conn, view, offset }: PhaseProps) {
  const { t } = useI18n();
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
    const tseat = turnId ? seatOf(turnId) : undefined;
    turnName = tseat?.name;
    turnHue = tseat?.hue ?? 0;
    canPick = turnId === you;
  } else if (iPicked) {
    turn = 'rival';
    turnName = pending.map((s) => s.name).join(' & ') || t('everyone');
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
      packs={d.packs}
      opened={d.opened}
      onOpenPack={(i) => conn.send({ t: 'pack', round: d.round, index: i })}
      turns={turnsMode}
      watchId={turnsMode && turnId !== you ? turnId : undefined}
      deadline={d.deadline}
      offset={offset}
      pickMs={view.settings.pickSeconds * 1000}
      rivals={rivals}
      log={log}
      onPick={send}
      statusNote={!d.shared && !turnsMode && iPicked ? t('Locked in. Waiting for {who}…', { who: turnName ?? '' }) : undefined}
    />
  );
}

/* ═════════════════════════════ Setup ═════════════════════════════ */

function SetupRoom({ conn, view, offset }: PhaseProps) {
  const { t, tn } = useI18n();
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
      title={t('Set your lineup')}
      subtitle={cpus ? tn('{n} CPU team has drafted too. Choose a formation and tactics. Nobody sees yours until kick-off.', '{n} CPU teams have drafted too. Choose a formation and tactics. Nobody sees yours until kick-off.', cpus) : t('Choose a formation and style. Nobody sees your choices until kick-off.')}
      readyLabel={t('Lock in and kick off')}
    />
  );
}

/* ═════════════════════════════ Matchday ═════════════════════════════ */

function MatchRoom({ conn, view, offset }: PhaseProps) {
  const { t } = useI18n();
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
        continueLabel={done ? undefined : comp.kind === 'match' ? t('See the result') : t('Continue')}
        onContinue={() => conn.send({ t: 'seen' })}
        waitingFor={done ? t('Waiting for {who} to finish watching…', { who: waiting.join(', ') || t('the others') }) : null}
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
        continueLabel={t('Back')}
        onContinue={() => setSpectate(null)}
      />
    );
  }
  const alive = isAlive(comp, you);
  return (
    <div className="gate panel gate--wide">
      <h1>{alive ? t('No match for you this matchday') : t('You are out of the tournament')}</h1>
      <p className="muted">{alive ? t('You have a bye. Sit tight, the next matchday is coming.') : t('The tournament goes on. You can watch your friend live, or wait for the next screen.')}</p>
      {others.map((f) => (
        <div key={f.id} className="spec">
          <TeamName seat={seats.get(f.a)} you={you} /> <i>{t('v')}</i> <TeamName seat={seats.get(f.b)} you={you} />
          <Button variant="primary" icon="play" onClick={() => setSpectate(f.id)}>{t('Watch live')}</Button>
        </div>
      ))}
      <p className="muted"><Icon name="clock" size={16} /> {t('Waiting for {who}…', { who: waiting.join(', ') || t('the others') })}</p>
    </div>
  );
}

/* ═════════════════════════════ Hub (between matchdays) ═════════════════════════════ */

function HubRoom({ conn, view, offset }: PhaseProps) {
  const { t } = useI18n();
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
        <div className="hubtabs" role="tablist" aria-label={t('Between matchdays')}>
          <button role="tab" aria-selected={false} className="tab" onClick={() => setTab('table')}>{t('Table and results')}</button>
          <button role="tab" aria-selected className="tab is-on">{t('Lineup and tactics')}</button>
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
          title={t('Tweak your lineup')}
          subtitle={opp ? (oppProf ? t('Next up: {name} (overall {ovr}). Their tactics stay hidden until kick-off.', { name: opp.name, ovr: oppProf.overall.toFixed(1) }) : t('Next up: {name}. Their tactics stay hidden until kick-off.', { name: opp.name })) : t('Change formation, swap players or switch tactics before the next matchday.')}
          readyLabel={t('Ready for the next matchday')}
          opponent={opp && oppProf ? { name: opp.name, overall: oppProf.overall, stage: next?.label ? stageLabel(next.label, t) : t('Next') } : undefined}
        />
      </div>
    );
  }

  return (
    <div className="hub">
      <header className="setup__head">
        <div>
          <p className="eyebrow">{compName(comp.kind, t)}{info.total ? ` · ${t('round {n} of {total}', { n: Math.min(info.index, info.total), total: info.total })}` : ''}</p>
          <h1>{playedDays.length === 1 ? t('{label} complete', { label: stageLabel(playedDays[0]!.label, t) }) : t('Results are in')}</h1>
          <p className="muted">
            {alive ? t('Take a look at the table, tweak your lineup, then get ready.') : t('You are out, but the tournament carries on. Watch the table fill in.')}
          </p>
        </div>
        <Timer deadline={hub.deadline} offset={offset} totalMs={HUB_SECONDS * 1000} size={56} />
      </header>

      <div className="hubtabs" role="tablist" aria-label={t('Between matchdays')}>
        <button role="tab" aria-selected className="tab is-on">{t('Table and results')}</button>
        <button role="tab" aria-selected={false} className="tab" onClick={() => setTab('lineup')}>{t('Lineup and tactics')}</button>
      </div>

      <div className="hub__grid">
        <section className="panel">
          <h2 className="panel__title">{t('Your results')}</h2>
          <div className="fxlist">
            {humanFx.length ? humanFx.map((f) => <FixtureRow key={f.id} fx={f} seats={seats} you={you} />) : <p className="muted">{t('No match for you this round.')}</p>}
          </div>
          {cpuFx.length > 0 && (
            <>
              <h2 className="panel__title panel__title--sub"><Icon name="cpu" size={16} /> {t('CPU results')} <span className="count">{cpuFx.length}</span></h2>
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
          <h2 className="panel__title">{comp.kind === 'knockout' ? t('Bracket') : t('Standings')}</h2>
          <CompetitionTables comp={comp} seats={seats} you={you} />
        </section>
      </div>

      <section className="panel nextup">
        {opp && nextMine ? (
          <div>
            <p className="eyebrow">{t('Next: {label}', { label: next?.label ? stageLabel(next.label, t) : '' })}</p>
            <h2>{t('You')} {t('v')} <TeamName seat={opp} you={you} /></h2>
            <p className="muted">{oppProf ? t('Your overall {mine} · theirs {theirs}.', { mine: myProf.overall.toFixed(1), theirs: oppProf.overall.toFixed(1) }) : t('Your overall {mine}.', { mine: myProf.overall.toFixed(1) })} {opp.bot ? t('A CPU team.') : t('Your friend. Their lineup stays hidden.')}</p>
          </div>
        ) : (
          <div>
            <p className="eyebrow">{t('Next: {label}', { label: next?.label ? stageLabel(next.label, t) : '' })}</p>
            <h2>{alive ? t('A bye for you') : t('Watching on')}</h2>
            <p className="muted">{alive ? t('No match for you next matchday.') : t('Your friend plays on. You will see their match live if they are in this round.')}</p>
          </div>
        )}
        <div className="nextup__cta">
          {ready ? (
            <div className="readybar__row">
              <span className="readybar__wait"><Icon name="check" size={18} /> {waiting.length ? t('Ready. Waiting for {who}…', { who: waiting.map((w) => w.name).join(', ') }) : t('Ready. Here we go!')}</span>
              <Button variant="ghost" size="sm" onClick={() => conn.send({ t: 'ready', ready: false })}>{t('Not yet')}</Button>
            </div>
          ) : (
            <Button variant="primary" size="lg" icon="whistle" onClick={() => { sfx.whistle(); conn.send({ t: 'ready', ready: true }); }}>{t('Ready for the next matchday')}</Button>
          )}
        </div>
      </section>
    </div>
  );
}

/* ═════════════════════════════ Result ═════════════════════════════ */

function ResultRoom({ conn, view }: { conn: RoomConnection; view: RoomView }) {
  const { t, tn, lang } = useI18n();
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
    const lines = [`${BRAND.name} · ${compName(comp.kind, t)} · ${champSeat ? t('{name} won', { name: `${champSeat.name}${champSeat.bot ? ' (CPU)' : ''}` }) : t('no winner')}`];
    const prof = profile(view.squads[you]!);
    lines.push(t('My XI: {formation} · {ovr} OVR · {chem}% chem', { formation: FORMATIONS[view.squads[you]!.formation].name, ovr: prof.overall.toFixed(1), chem: prof.chem.score }));
    if (myFixtures.length) lines.push(myFixtures.map((f) => { const l = f.lite!; const w = l.winner === (f.a === you ? 0 : 1); return l.winner === null ? '🟨' : w ? '🟩' : '🟥'; }).join(''));
    return lines.join('\n');
  }, [view, you, champSeat, comp.kind, myFixtures, t]);

  const replayFx = useMemo(() => {
    if (!replay) return null;
    const f = comp.days.flatMap((d) => d.fixtures).find((x) => x.id === replay);
    return f?.result ? [fixtureFor(view, f)] : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay]);

  if (replayFx) {
    return (
      <MatchPlayer fixtures={replayFx} pace={view.settings.pace} startAt={Date.now() + 1500} you={() => null} onSeen={() => undefined} continueLabel={t('Back to results')} onContinue={() => setReplay(null)} />
    );
  }

  const viewSquad = view.squads[tab] ?? view.squads[you]!;
  const viewChem = chemistry(viewSquad);
  const replayable = comp.days.flatMap((d) => d.fixtures).filter((f) => f.result && (f.a === you || f.b === you || comp.kind === 'match'));

  return (
    <div className="result">
      {youWon && <Confetti burst="win" count={60} />}
      <section className={cx('panel winner', youWon && 'winner--you')}>
        <p className="eyebrow">{comp.kind === 'match' ? t('Full time') : compName(comp.kind, t)}</p>
        <h1>{youWon ? (comp.kind === 'match' ? t('You win!') : t('You are champion!')) : champSeat ? (comp.kind === 'match' ? t('{name} wins', { name: champSeat.name }) : t('{name} are champions', { name: champSeat.name })) : t('All square')}</h1>
        <p className="winner__sum">{last ? seriesSummary(last.summary, lang, t) : undefined}</p>
        {comp.kind !== 'match' && <ChampionBanner id={champ} seats={seats} you={you} />}
        {comp.kind === 'match' && finalFx.lite && <p className="winner__head">“{finalFx.result ? headlineText(finalFx.result, lang) : finalFx.lite.headline}”</p>}

        {humans.length === 2 ? (
          <div className="series" aria-label={t('Series score')}>
            <div className={cx('series__side', champ === humans[0]!.id && 'is-win')}><Avatar name={humans[0]!.name} hue={humans[0]!.hue} size={40} /><span>{humans[0]!.name}</span></div>
            <div className="series__score"><b>{view.series.wins[humans[0]!.id] ?? 0}</b><i>–</i><b>{view.series.wins[humans[1]!.id] ?? 0}</b><small>{t('series · game {n}', { n: view.game })}</small></div>
            <div className={cx('series__side', champ === humans[1]!.id && 'is-win')}><Avatar name={humans[1]!.name} hue={humans[1]!.hue} size={40} /><span>{humans[1]!.name}</span></div>
          </div>
        ) : (
          <div className="serieslist" aria-label={t('Series wins')}>
            {humans.map((h) => <span key={h.id} className={cx('chip', champ === h.id && 'chip--ok')}><Avatar name={h.name} hue={h.hue} size={18} /> {h.name}: {tn('{n} title', '{n} titles', view.series.wins[h.id] ?? 0)}</span>)}
          </div>
        )}

        <div className="row row--center">
          <Button variant="primary" size="lg" icon="refresh" onClick={() => conn.send({ t: 'rematch', want: !want })} aria-pressed={want}>
            {want ? (waiting.length ? t('Ready. Waiting for {who}…', { who: waiting.map((w) => w.name).join(', ') }) : t('Starting…')) : t('Play again')}
          </Button>
          {replayable.length > 0 && <Button variant="soft" icon="play" onClick={() => setReplay(replayable[replayable.length - 1]!.id)}>{comp.kind === 'match' ? t('Watch again') : t('Watch your last match')}</Button>}
          <Button variant="soft" icon="share" onClick={() => shareOrCopy({ title: BRAND.name, text: shareText, url: location.origin })}>{t('Share result')}</Button>
          {isHost && <Button variant="ghost" onClick={() => conn.send({ t: 'lobby' })}>{t('Change settings')}</Button>}
        </div>
      </section>

      {comp.kind !== 'match' && (
        <section className="panel">
          <h2 className="panel__title">{t('The tournament')}</h2>
          <CompetitionTables comp={comp} seats={seats} you={you} />
        </section>
      )}

      <section className="panel">
        <h2 className="panel__title">{comp.kind === 'match' ? t('Match report') : t('Your matches')}</h2>
        <div className="fxlist">
          {(comp.kind === 'match' ? [finalFx] : myFixtures).map((f) => <FixtureRow key={f.id} fx={f} seats={seats} you={you} />)}
          {comp.kind !== 'match' && myFixtures.length === 0 && <p className="muted">{t('You did not play a match this time.')}</p>}
        </div>
        {comp.kind === 'match' && finalFx.result && (
          <div className="report__motm">
            <Icon name="crown" size={16} />
            <span>{t('Man of the match')}: <b>{player(finalFx.result.motm.player).name}</b> ({motmReasonText(finalFx.result, lang)})</span>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="tabs" role="tablist" aria-label={t('Squads')}>
          {humans.map((s) => (
            <button key={s.id} role="tab" aria-selected={tab === s.id} className={cx('tab', tab === s.id && 'is-on')} onClick={() => setTab(s.id)}>
              <Avatar name={s.name} hue={s.hue} size={18} /> {s.id === you ? t('You') : s.name}
            </button>
          ))}
        </div>
        <div className="squadview">
          <Pitch formation={viewSquad.formation} slots={viewSquad.slots} links={viewChem.links} linkCount={viewChem.perSlot} ratings="full" label={t('Final lineup')} />
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
