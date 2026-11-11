import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ROUNDS, openRoles, suggestSlot, type RatingsMode } from '../../shared/draft';
import type { TFn } from '../../shared/i18n';
import type { PackClue } from '../../shared/packs';
import type { DraftView } from '../../shared/protocol';
import { PackChooser } from '../components/PackChooser';
import { FORMATIONS, fitKind, penalty, type Role } from '../../shared/formations';
import { player, shortName, tierOf, type Tier } from '../../shared/players';
import { chemistry, profile, type Squad } from '../../shared/squad';
import { Confetti } from '../components/Confetti';
import { PlayerCard } from '../components/PlayerCard';
import { Pitch } from '../components/Pitch';
import { Timer } from '../components/Timer';
import { Avatar, Button, Icon, cx } from '../components/ui';
import { announce, prefersReducedMotion, toast } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { useBands } from '../lib/tier';
import { buzz, sfx } from '../lib/sfx';

export interface Rival {
  id: string;
  name: string;
  hue: number;
  squad: Squad | null;
  connected: boolean;
  /** has finished their pick for this round (packs) */
  done: boolean;
  isTurn: boolean;
}

export interface DraftLogRow {
  key: string;
  who: string;
  hue: number;
  player: string;
  auto: boolean;
  mine: boolean;
}

export interface DraftScreenProps {
  round: number;
  board: string[];
  mode: RatingsMode;
  squad: Squad;
  /** whose pick is it: 'me', a rival's name, or 'all' for simultaneous packs */
  turn: 'me' | 'rival' | 'all';
  turnName?: string;
  turnHue?: number;
  canPick: boolean;
  shared: boolean;
  /** take-turns format: one person drafts at a time and the others watch their pack and pitch live */
  turns?: boolean;
  /** while watching, whose pitch to show */
  watchId?: string;
  /** pick-a-pack: the clues on the three sealed packs, which one is open, and how to open one. Absent in Duel and the solo cup. */
  packs?: PackClue[];
  opened?: number | null;
  onOpenPack?: (index: number) => void;
  deadline: number | null;
  offset: number;
  pickMs: number;
  rivals: Rival[];
  log: DraftLogRow[];
  onPick: (card: string, slot: string) => void;
  /** a label like "Daily Draft" or room code */
  subtitle?: string;
  statusNote?: string;
  /** spotlight draft: one manager at a time opens one of three identical packs while everyone watches */
  spot?: NonNullable<DraftView['spot']>;
  onSteal?: (card: string) => void;
  /** a seat's display name, for "X stole Y" and "what X missed" */
  nameOf?: (id: string) => string;
  you?: string;
}

/** Milliseconds left until a server moment, ticking while it is in the future. */
function useLeft(until: number | null | undefined, offset: number): number {
  const [, force] = useState(0);
  const left = until == null ? 0 : Math.max(0, until - (Date.now() + offset));
  useEffect(() => {
    if (left <= 0) return;
    const id = setInterval(() => force((x) => x + 1), 100);
    return () => clearInterval(id);
  }, [left > 0, until]); // eslint-disable-line react-hooks/exhaustive-deps
  return left;
}

/** the short name of a role for the tooltip on a "still need" chip */
function roleWord(t: TFn, role: Role): string {
  switch (role) {
    case 'GK': return t('keeper');
    case 'CB': return t('centre-back');
    case 'LB': return t('left-back');
    case 'RB': return t('right-back');
    case 'LWB': return t('left wing-back');
    case 'RWB': return t('right wing-back');
    case 'CDM': return t('holding mid');
    case 'CM': return t('midfielder');
    case 'CAM': return t('playmaker');
    case 'LM': return t('left mid');
    case 'RM': return t('right mid');
    case 'LW': return t('left winger');
    case 'RW': return t('right winger');
    default: return t('striker');
  }
}

export function DraftScreen(p: DraftScreenProps) {
  const { t } = useI18n();
  const bands = useBands();
  const spot = p.spot;
  const [rip, setRip] = useState<number | null>(null);
  const stealLeft = useLeft(spot?.stage === 'open' ? spot.stealUntil : null, p.offset);
  /** watching someone else's pack (take-turns or spotlight): look, do not touch */
  const watching = (!!p.turns || !!spot) && !p.canPick;
  /** my pack is open but rivals may still steal from it: I pick when the window has closed */
  const locked = !!spot && p.canPick && stealLeft > 0;
  const canStealNow = !!spot && spot.canSteal && stealLeft > 0;
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [tab, setTab] = useState<string>('me');
  const [burst, setBurst] = useState(0);
  // watching someone's draft: show their pitch filling up; when it is my turn, show mine
  useEffect(() => { setTab(p.watchId ?? 'me'); }, [p.watchId]);
  const [opened, setOpened] = useState(0);
  const prevBoard = useRef<string[]>(p.board);
  const prevTurn = useRef<string>('');

  // reset per-round state when the board changes
  const boardKey = p.board.join(',');
  useEffect(() => {
    const old = prevBoard.current;
    // a card I was eyeing vanished from a shared board: it was stolen
    if (selected && p.shared && old.includes(selected) && !p.board.includes(selected)) {
      const taker = p.log.find((l) => l.player === selected && !l.mine);
      if (taker) {
        toast(t('Stolen! {who} took {name}', { who: taker.who, name: shortName(player(selected).name) }), 'error');
        sfx.error();
      }
    }
    prevBoard.current = p.board;
    setPending(null);
    if (selected && !p.board.includes(selected)) setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardKey, p.round]);

  // a short, friendly turn cue and a screen-reader announcement
  useEffect(() => {
    const key = `${p.round}:${p.turn}:${p.turnName ?? ''}`;
    if (key === prevTurn.current) return;
    prevTurn.current = key;
    if (p.turn === 'me' || p.turn === 'all') {
      sfx.turn();
      buzz(18);
      announce(p.turn === 'all' ? t('Round {round}. Open your pack and pick a player.', { round: p.round }) : t('Round {round}. Your pick.', { round: p.round }));
    } else {
      announce(t('Round {round}. {name} is picking.', { round: p.round, name: p.turnName ?? t('Opponent') }));
    }
  }, [p.round, p.turn, p.turnName, t]);

  // Packs format: the pack starts sealed. Its glow hints at the best card inside; tap to open (or it opens by itself).
  // (the single sealed pack is the solo cup's; rooms with packs choose between three instead)
  const choosing = spot ? spot.stage === 'choose' : !!p.packs?.length && p.board.length === 0 && !p.shared;
  const sealed = !spot && !p.packs && !p.shared && !p.turns && p.canPick && p.board.length > 0 && opened !== p.round;
  const bestTier: Tier | 'mystery' = useMemo(() => {
    if (p.mode === 'hidden') return 'mystery';
    const order: Tier[] = ['bronze', 'silver', 'gold', 'icon'];
    return p.board.reduce<Tier>((best, id) => (order.indexOf(tierOf(player(id).ovr, bands)) > order.indexOf(best) ? tierOf(player(id).ovr, bands) : best), 'bronze');
  }, [p.board, p.mode, bands]);

  // Spotlight: the pack opens for everyone at once. The weakest card turns first and the best one last; a gold or an icon gets its own sound.
  const revealRank = useMemo(() => {
    const sorted = [...p.board].sort((a, b) => player(a).ovr - player(b).ovr);
    return new Map(sorted.map((id, i) => [id, i]));
  }, [p.board]);
  const openKey = spot ? `${spot.done}:${spot.opened ?? '-'}` : '';
  useEffect(() => {
    if (!spot || spot.stage !== 'open') return;
    setRip(null);
    sfx.reveal(bestTier === 'mystery' ? 'silver' : bestTier);
    buzz(bestTier === 'icon' ? 60 : bestTier === 'gold' ? 40 : 20);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey]);
  // a steal: everyone hears about it, the victim loudest
  const stolenCard = spot?.stolen?.card;
  useEffect(() => {
    if (!spot?.stolen) return;
    const thief = p.nameOf?.(spot.stolen.by) ?? '';
    const name = shortName(player(spot.stolen.card).name);
    if (spot.stolen.by === p.you) { toast(t('You stole {name}!', { name })); sfx.pick(); }
    else if (spot.seat === p.you) { toast(t('Stolen! {who} took {name}', { who: thief, name }), 'error'); sfx.error(); buzz(60); }
    else toast(t('{who} stole {name}', { who: thief, name }));
    if (selected === spot.stolen.card) setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stolenCard]);
  const ripOpen = (i: number) => {
    if (rip !== null) return;
    sfx.select();
    buzz(18);
    if (prefersReducedMotion()) return p.onOpenPack?.(i);
    setRip(i);
    setTimeout(() => p.onOpenPack?.(i), 480);
    setTimeout(() => setRip(null), 2500); // never leave the packs stuck if the reply is lost
  };
  useEffect(() => {
    if (!sealed) return;
    const t = setTimeout(() => { setOpened(p.round); sfx.reveal(bestTier === 'mystery' ? 'silver' : bestTier); }, prefersReducedMotion() ? 0 : 2200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sealed, p.round]);
  const openPack = () => { setOpened(p.round); sfx.reveal(bestTier === 'mystery' ? 'silver' : bestTier); buzz(30); };

  const suggested = selected ? suggestSlot(p.squad, selected) : null;
  const heldPlayer = selected ? player(selected) : null;
  const suggestedRole = suggested ? FORMATIONS[p.squad.formation].slots.find((s) => s.id === suggested)?.role : undefined;

  const place = (slotId: string) => {
    if (!selected || !p.canPick || pending || locked) return;
    const slot = FORMATIONS[p.squad.formation].slots.find((s) => s.id === slotId);
    if (!slot || p.squad.slots[slotId]) return;
    setPending(selected);
    setFresh(slotId);
    setBurst((b) => b + 1);
    sfx.pick();
    buzz(24);
    p.onPick(selected, slotId);
    setSelected(null);
    // never leave the UI stuck waiting for a reply
    setTimeout(() => setPending(null), 3500);
  };

  const choose = (id: string) => {
    if (pending || watching) return; // watching someone else's draft: look, don't touch
    // tapping the card you have already chosen signs him at the spot the pitch is showing
    if (selected === id && p.canPick && !locked) {
      const s = suggestSlot(p.squad, id);
      if (s) return place(s);
    }
    sfx.select();
    setSelected((cur) => (cur === id ? null : id));
  };

  // keyboard: 1-9 choose a card, Enter places at the suggested slot, Escape clears
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= p.board.length) {
        choose(p.board[n - 1]!);
        e.preventDefault();
      } else if (e.key === 'Enter' && selected && suggested && p.canPick) {
        place(suggested);
        e.preventDefault();
      } else if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const mine = useMemo(() => {
    const filled = Object.values(p.squad.slots).filter(Boolean).length;
    const prof = profile(p.squad);
    const chem = chemistry(p.squad);
    return { filled, prof, chem };
  }, [p.squad]);

  const needs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of openRoles(p.squad)) counts.set(o.role, (counts.get(o.role) ?? 0) + 1);
    return [...counts.entries()];
  }, [p.squad]);

  const viewing = tab === 'me' ? null : p.rivals.find((r) => r.id === tab);
  const viewSquad = viewing?.squad ?? p.squad;
  const viewChem = useMemo(() => chemistry(viewSquad), [viewSquad]);
  const linkCount = viewChem.perSlot;

  const yourTurn = p.turn === 'me' || p.turn === 'all';
  const hint = selected && heldPlayer && suggestedRole
    ? `${t('Drop {name} at {role}', { name: shortName(heldPlayer.name), role: suggestedRole })}${penalty(heldPlayer.pos, suggestedRole) ? ` (-${penalty(heldPlayer.pos, suggestedRole)})` : ''}`
    : null;
  // "<name> is choosing" for the board title and the idle dock (the English fallback keeps its original wording)
  const choosingText = p.turnName != null ? t('{name} is choosing', { name: p.turnName }) : t('They is choosing');
  // one log line, translated as a sentence so the verb can agree with the subject; the names stay bold
  const pickLine = (l: DraftLogRow): ReactNode => {
    const vals: Record<string, string> = { you: t('You'), who: l.who, name: shortName(player(l.player).name) };
    const keep = { you: '{you}', who: '{who}', name: '{name}' };
    const text = l.mine
      ? (l.auto ? t('{you} auto-picked {name}', keep) : t('{you} took {name}', keep))
      : (l.auto ? t('{who} auto-picked {name}', keep) : t('{who} took {name}', keep));
    return text.split(/(\{you\}|\{who\}|\{name\})/).map((part, i) => {
      const m = /^\{(you|who|name)\}$/.exec(part);
      return m ? <b key={i}>{vals[m[1]!]}</b> : part;
    });
  };

  return (
    <div className="draft">
      <header className="drafthead">
        <div className="roundpill" aria-label={t('Round {n} of {total}', { n: p.round, total: ROUNDS })}>
          <span className="roundpill__n">{p.round}</span>
          <span className="roundpill__of">/ {ROUNDS}</span>
          <span className="roundpill__bar"><i style={{ width: `${((p.round - 1) / ROUNDS) * 100}%` }} /></span>
        </div>
        <div className={cx('turn', yourTurn && 'turn--you')} aria-live="off">
          {p.turn === 'rival' ? (
            <>
              <Avatar name={p.turnName ?? '?'} hue={p.turnHue ?? 0} size={34} />
              <div className="turn__text">
                <b>{spot && choosing ? t('{name} is choosing a pack', { name: p.turnName ?? '' }) : t('{name} is picking', { name: p.turnName ?? '' })}</b>
                <span>{spot ? (canStealNow ? t('Want one of these? Steal it now.') : t('Watching live')) : p.shared ? t('Tap a card to plan your next move') : p.turns ? t('Watch them build their squad. You are up next.') : t('Waiting on them')}</span>
              </div>
            </>
          ) : (
            <>
              <span className="turn__badge"><Icon name="bolt" size={18} /></span>
              <div className="turn__text">
                <b>{choosing ? t('Choose a pack') : sealed ? t('Open your pack') : p.turn === 'all' ? t('Your pack is open') : t('Your pick')}</b>
                <span>{choosing ? (spot ? t('They all look the same. Pick one.') : t('Read the clues. They are rumours, not promises')) : sealed ? t('Tap it. The glow hints at what is inside') : locked ? t('Hold on: a rival may steal one') : selected ? t('Tap the card again to sign him') : t('Choose one card')}</span>
              </div>
            </>
          )}
        </div>
        <Timer deadline={p.deadline} offset={p.offset} totalMs={p.pickMs} tick={yourTurn} />
      </header>

      <section className="draft__board" aria-label={p.shared ? t('Shared board') : watching ? t("{name}'s pack", { name: p.turnName ?? '' }) : t('Your pack')}>
        <div className="board__title">
          <h2>{p.shared ? t('Shared board') : choosing ? (p.canPick ? t('Three sealed packs') : choosingText) : watching ? t("{name}'s pack", { name: p.turnName ?? '' }) : p.packs && p.opened != null && p.packs[p.opened] ? t(p.packs[p.opened]!.name) : t('Your pack')}</h2>
          <span>{p.shared ? t("{n} left. Once it's taken, it's gone.", { n: p.board.length }) : choosing ? (p.canPick ? t('Pick one to open') : t('Watching live')) : watching ? t('Watching live') : t('Pick 1 of 3')}</span>
        </div>
        {spot && stealLeft > 0 && (
          <p className={cx('stealbar', canStealNow && 'stealbar--go')} role="status">
            <Icon name="bolt" size={16} />
            <span>{p.canPick ? t('Rivals can steal one card') : canStealNow ? t('Steal one card? It replaces your next pack.') : t('Steal window')}</span>
            <b>{Math.ceil(stealLeft / 1000)}</b>
            <i style={{ width: `${Math.min(100, (stealLeft / 3500) * 100)}%` }} aria-hidden="true" />
          </p>
        )}
        {choosing && spot ? (
          <div className={cx(rip !== null && 'is-ripping')} data-rip={rip ?? undefined}>
            <PackChooser packs={[]} identical={spot.packs} canPick={p.canPick && rip === null} mode={p.mode} who={p.turnName} onOpen={ripOpen} />
          </div>
        ) : choosing ? (
          <PackChooser packs={p.packs!} canPick={p.canPick} mode={p.mode} who={p.turnName} onOpen={(i) => { sfx.reveal('silver'); buzz(30); p.onOpenPack?.(i); }} />
        ) : sealed ? (
          <button type="button" className={cx('sealed', `sealed--${bestTier}`)} onClick={openPack}>
            <span className="sealed__foil" aria-hidden="true" />
            <span className="sealed__mark" aria-hidden="true"><Icon name="ball" size={46} /></span>
            <b>{t('Tap to open')}</b>
            <small>{bestTier === 'icon' ? t('Something special is in there') : bestTier === 'gold' ? t('This one is glowing') : t('Pick 1 of 3')}</small>
          </button>
        ) : (
        <div className={cx('board', p.shared ? 'board--duel' : 'board--packs', spot && 'board--spot', locked && 'is-locked')}>
          {p.board.map((id, i) => (
            <div key={`${p.round}-${spot?.done ?? ''}-${id}`} className={cx('cardcol', spot && `cardcol--${tierOf(player(id).ovr, bands)}`)}>
            <PlayerCard
              id={id}
              mode={p.mode}
              index={spot ? revealRank.get(id) ?? i : i}
              reveal
              selected={selected === id}
              dim={!!selected && selected !== id}
              pending={pending === id}
              disabled={!!pending}
              onClick={() => choose(id)}
              onDoubleClick={() => {
                if (!p.canPick) return;
                const s = suggestSlot(p.squad, id);
                if (s) {
                  setSelected(id);
                  setPending(id);
                  setFresh(s);
                  setBurst((b) => b + 1);
                  sfx.pick();
                  buzz(24);
                  p.onPick(id, s);
                  setSelected(null);
                  setTimeout(() => setPending(null), 3500);
                }
              }}
              hotkey={String(i + 1)}
            />
            {canStealNow && <Button size="sm" variant="primary" icon="bolt" className="stealbtn" onClick={() => { buzz(30); p.onSteal?.(id); }}>{t('Steal')}</Button>}
            </div>
          ))}
          {p.board.length === 0 && <div className="board__empty">{t('Dealing the next round…')}</div>}
        </div>
        )}

        {spot?.missed && (
          <div className="missed" aria-label={t('What was left behind')}>
            <b className="missed__title">{spot.missed.seat === p.you ? t('What you missed') : t('What {name} missed', { name: p.nameOf?.(spot.missed.seat) ?? '' })}</b>
            <div className="missed__row">
              {[spot.missed.left, ...spot.missed.others].map((pack, k) => (
                <div key={k} className="missed__pack">
                  <span className="missed__label">{k === 0 ? t('Same pack') : t('Pack left sealed')}</span>
                  <div className="missed__cards">{pack.map((id) => <PlayerCard key={id} id={id} mode={p.mode} size="xs" disabled />)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!watching && (
          <div className="needs" aria-label={t('Positions you still need')}>
            <span className="needs__label">{t('Still need')}</span>
            {needs.length === 0 ? <span className="needs__done">{t('All spots filled')}</span> : needs.map(([role, n]) => (
              <span key={role} className="chip chip--role" title={roleWord(t, role as Role)}>{role}{n > 1 ? ` ×${n}` : ''}</span>
            ))}
          </div>
        )}

        {p.log.length > 0 && (
          <ol className="picklog" aria-label={t('Recent picks')}>
            {p.log.slice(-4).reverse().map((l) => (
              <li key={l.key} className={cx(l.mine && 'is-mine')}>
                <Avatar name={l.who} hue={l.hue} size={20} />
                <span>{pickLine(l)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <aside className="draft__side">
        {p.rivals.length > 0 && (
          <div className="tabs" role="tablist" aria-label={t('Whose squad')}>
            <button role="tab" aria-selected={tab === 'me'} className={cx('tab', tab === 'me' && 'is-on')} onClick={() => setTab('me')}>{t('You')}</button>
            {p.rivals.map((r) => (
              <button key={r.id} role="tab" aria-selected={tab === r.id} className={cx('tab', tab === r.id && 'is-on')} onClick={() => setTab(r.id)}>
                <Avatar name={r.name} hue={r.hue} size={18} connected={r.connected} />
                {r.name}
                {r.done && <Icon name="check" size={14} />}
              </button>
            ))}
          </div>
        )}
        <div className="pitchwrap">
          <Pitch
            formation={viewSquad.formation}
            slots={viewSquad.slots}
            links={viewChem.links}
            linkCount={linkCount}
            holding={tab === 'me' ? selected : null}
            suggested={tab === 'me' ? suggested : null}
            fresh={tab === 'me' ? fresh : null}
            onSlot={tab === 'me' ? place : undefined}
            ratings={p.mode}
            label={tab === 'me' ? t('Your pitch') : t('{name} pitch', { name: viewing?.name ?? '' })}
          />
          <Confetti burst={burst} count={14} />
        </div>
        <div className="strip">
          <div><span>{t('Squad')}</span><b>{mine.filled}/11</b></div>
          <div><span>{t('Rating')}</span><b>{mine.filled ? mine.prof.avg : '–'}</b></div>
          <div title={t('Adjacent players from the same nation')}><span>{t('Chemistry')}</span><b>{mine.chem.score}%</b></div>
        </div>
      </aside>

      <div className={cx('dock', selected && 'is-open')}>
        {selected && heldPlayer ? (
          <>
            <div className="dock__who">
              <b>{shortName(heldPlayer.name)}</b>
              <span>{heldPlayer.pos} · {hint ?? t('Choose a spot')}</span>
            </div>
            <Button variant="primary" icon={p.canPick ? 'check' : 'clock'} disabled={!p.canPick || !suggested || !!pending || locked} loading={!!pending} onClick={() => suggested && place(suggested)}>
              {p.canPick ? (suggestedRole ? t('Place at {role}', { role: suggestedRole }) : t('Place')) : (p.turnName != null ? t('Waiting for {name}', { name: p.turnName }) : t('Waiting for turn'))}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>{t('Cancel')}</Button>
          </>
        ) : (
          <div className="dock__idle">
            {p.statusNote ?? (yourTurn ? t('Pick a card to see where it fits.') : `${choosingText}.${p.shared ? ` ${t('You can plan ahead.')}` : ''}`)}
          </div>
        )}
      </div>
    </div>
  );
}
