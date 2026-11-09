import { useEffect, useMemo, useRef, useState } from 'react';
import { ROUNDS, openRoles, suggestSlot, type RatingsMode } from '../../shared/draft';
import { FORMATIONS, fitKind, penalty, type Role } from '../../shared/formations';
import { player, shortName } from '../../shared/players';
import { chemistry, profile, type Squad } from '../../shared/squad';
import { Confetti } from '../components/Confetti';
import { PlayerCard } from '../components/PlayerCard';
import { Pitch } from '../components/Pitch';
import { Timer } from '../components/Timer';
import { Avatar, Button, Icon, cx } from '../components/ui';
import { announce, toast } from '../lib/hooks';
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
  deadline: number | null;
  offset: number;
  pickMs: number;
  rivals: Rival[];
  log: DraftLogRow[];
  onPick: (card: string, slot: string) => void;
  /** a label like "Daily Draft" or room code */
  subtitle?: string;
  statusNote?: string;
}

const ROLE_WORD: Partial<Record<Role, string>> = { GK: 'keeper', CB: 'centre-back', LB: 'left-back', RB: 'right-back', LWB: 'left wing-back', RWB: 'right wing-back', CDM: 'holding mid', CM: 'midfielder', CAM: 'playmaker', LM: 'left mid', RM: 'right mid', LW: 'left winger', RW: 'right winger', ST: 'striker' };

export function DraftScreen(p: DraftScreenProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [tab, setTab] = useState<string>('me');
  const [burst, setBurst] = useState(0);
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
        toast(`Stolen! ${taker.who} took ${shortName(player(selected).name)}`, 'error');
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
      announce(`Round ${p.round}. ${p.turn === 'all' ? 'Open your pack and pick a player.' : 'Your pick.'}`);
    } else {
      announce(`Round ${p.round}. ${p.turnName ?? 'Opponent'} is picking.`);
    }
  }, [p.round, p.turn, p.turnName]);

  const suggested = selected ? suggestSlot(p.squad, selected) : null;
  const heldPlayer = selected ? player(selected) : null;
  const suggestedRole = suggested ? FORMATIONS[p.squad.formation].slots.find((s) => s.id === suggested)?.role : undefined;

  const place = (slotId: string) => {
    if (!selected || !p.canPick || pending) return;
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
    if (pending) return;
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
    ? `Drop ${shortName(heldPlayer.name)} at ${suggestedRole}${penalty(heldPlayer.pos, suggestedRole) ? ` (-${penalty(heldPlayer.pos, suggestedRole)})` : ''}`
    : null;

  return (
    <div className="draft">
      <header className="drafthead">
        <div className="roundpill" aria-label={`Round ${p.round} of ${ROUNDS}`}>
          <span className="roundpill__n">{p.round}</span>
          <span className="roundpill__of">/ {ROUNDS}</span>
          <span className="roundpill__bar"><i style={{ width: `${((p.round - 1) / ROUNDS) * 100}%` }} /></span>
        </div>
        <div className={cx('turn', yourTurn && 'turn--you')} aria-live="off">
          {p.turn === 'rival' ? (
            <>
              <Avatar name={p.turnName ?? '?'} hue={p.turnHue ?? 0} size={34} />
              <div className="turn__text">
                <b>{p.turnName} is picking</b>
                <span>{p.shared ? 'Tap a card to plan your next move' : 'Waiting on them'}</span>
              </div>
            </>
          ) : (
            <>
              <span className="turn__badge"><Icon name="bolt" size={18} /></span>
              <div className="turn__text">
                <b>{p.turn === 'all' ? 'Your pack is open' : 'Your pick'}</b>
                <span>{selected ? 'Tap a green spot or press Enter' : 'Choose one card'}</span>
              </div>
            </>
          )}
        </div>
        <Timer deadline={p.deadline} offset={p.offset} totalMs={p.pickMs} tick={yourTurn} />
      </header>

      <section className="draft__board" aria-label={p.shared ? 'Shared board' : 'Your pack'}>
        <div className="board__title">
          <h2>{p.shared ? 'Shared board' : 'Your pack'}</h2>
          <span>{p.shared ? `${p.board.length} left. Once it's taken, it's gone.` : 'Pick 1 of 3'}</span>
        </div>
        <div className={cx('board', p.shared ? 'board--duel' : 'board--packs')}>
          {p.board.map((id, i) => (
            <PlayerCard
              key={`${p.round}-${id}`}
              id={id}
              mode={p.mode}
              index={i}
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
          ))}
          {p.board.length === 0 && <div className="board__empty">Dealing the next round…</div>}
        </div>

        <div className="needs" aria-label="Positions you still need">
          <span className="needs__label">Still need</span>
          {needs.length === 0 ? <span className="needs__done">All spots filled</span> : needs.map(([role, n]) => (
            <span key={role} className="chip chip--role" title={ROLE_WORD[role as Role]}>{role}{n > 1 ? ` ×${n}` : ''}</span>
          ))}
        </div>

        {p.log.length > 0 && (
          <ol className="picklog" aria-label="Recent picks">
            {p.log.slice(-4).reverse().map((l) => (
              <li key={l.key} className={cx(l.mine && 'is-mine')}>
                <Avatar name={l.who} hue={l.hue} size={20} />
                <span><b>{l.mine ? 'You' : l.who}</b> {l.auto ? 'auto-picked' : 'took'} <b>{shortName(player(l.player).name)}</b></span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <aside className="draft__side">
        {p.rivals.length > 0 && (
          <div className="tabs" role="tablist" aria-label="Whose squad">
            <button role="tab" aria-selected={tab === 'me'} className={cx('tab', tab === 'me' && 'is-on')} onClick={() => setTab('me')}>You</button>
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
            label={tab === 'me' ? 'Your pitch' : `${viewing?.name ?? ''} pitch`}
          />
          <Confetti burst={burst} count={14} />
        </div>
        <div className="strip">
          <div><span>Squad</span><b>{mine.filled}/11</b></div>
          <div><span>Rating</span><b>{mine.filled ? mine.prof.avg : '–'}</b></div>
          <div title="Adjacent players from the same nation"><span>Chemistry</span><b>{mine.chem.score}%</b></div>
        </div>
      </aside>

      <div className={cx('dock', selected && 'is-open')}>
        {selected && heldPlayer ? (
          <>
            <div className="dock__who">
              <b>{shortName(heldPlayer.name)}</b>
              <span>{heldPlayer.pos} · {hint ?? 'Choose a spot'}</span>
            </div>
            <Button variant="primary" icon={p.canPick ? 'check' : 'clock'} disabled={!p.canPick || !suggested || !!pending} loading={!!pending} onClick={() => suggested && place(suggested)}>
              {p.canPick ? (suggestedRole ? `Place at ${suggestedRole}` : 'Place') : `Waiting for ${p.turnName ?? 'turn'}`}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>Cancel</Button>
          </>
        ) : (
          <div className="dock__idle">
            {p.statusNote ?? (yourTurn ? 'Pick a card to see where it fits.' : `${p.turnName ?? 'They'} ${p.shared ? 'is choosing. You can plan ahead.' : 'is choosing.'}`)}
          </div>
        )}
      </div>
    </div>
  );
}
