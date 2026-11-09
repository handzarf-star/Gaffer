import { useRef, useState } from 'react';
import { BRAND } from '../../shared/brand';
import { dailyLabel, dailySeed } from '../../shared/cup';
import { ROOM_CODE_RE } from '../../shared/protocol';
import { Button, Icon, cx } from '../components/ui';
import { navigate } from '../lib/hooks';
import { sfx } from '../lib/sfx';
import { getName, lastRoom, lsGet, setName } from '../lib/storage';

export function Home() {
  const [name, setNameState] = useState(getName());
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const last = lastRoom();
  const best = lsGet<{ wins: number; ovr: number } | null>('cup:best', null);
  const today = dailySeed();
  const daily = lsGet<{ status?: string; phase?: string; results?: Array<{ won: boolean }> } | null>(`daily:${today}`, null);

  const needName = (): boolean => {
    const n = name.trim();
    if (!n) {
      setErr('Add your name first so your mate knows who they are playing.');
      nameRef.current?.focus();
      return false;
    }
    setName(n);
    return true;
  };

  const create = async () => {
    setErr('');
    if (!needName()) return;
    setBusy(true);
    sfx.pick();
    try {
      const res = await fetch('/api/rooms', { method: 'POST' });
      if (!res.ok) throw new Error(String(res.status));
      const { code: c } = (await res.json()) as { code: string };
      navigate(`/r/${c}`);
    } catch {
      setErr('Could not create a room. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const join = (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    const c = code.trim().toUpperCase();
    if (!ROOM_CODE_RE.test(c)) return setErr('Room codes are 4 letters, like KQTM.');
    if (!needName()) return;
    navigate(`/r/${c}`);
  };

  return (
    <div className="home">
      <section className="hero">
        <p className="eyebrow">Free · No sign-up · 2 to 4 players</p>
        <h1 className="hero__title">{BRAND.tagline.split('. ').map((w, i) => <span key={i}>{w.replace('.', '')}<i>.</i> </span>)}</h1>
        <p className="hero__sub">{BRAND.blurb}</p>
        <div className="namefield">
          <label htmlFor="name">Your name</label>
          <input ref={nameRef} id="name" className="input" maxLength={16} autoComplete="nickname" placeholder="What do your mates call you?" value={name} onChange={(e) => { setNameState(e.target.value); setErr(''); }} />
        </div>
        {err && <p className="error" role="alert">{err}</p>}
      </section>

      {last && (
        <button className="resume" onClick={() => navigate(`/r/${last.code}`)}>
          <Icon name="refresh" size={18} />
          <span>You were in room <b>{last.code}</b>. Rejoin</span>
          <Icon name="arrow" size={18} />
        </button>
      )}

      <section className="modes" aria-label="Ways to play">
        <article className="mode mode--primary">
          <span className="mode__icon"><Icon name="users" size={26} /></span>
          <h2>Play a friend</h2>
          <p>Private room, one link. Take turns drafting from a shared board and steal each other's targets.</p>
          <Button variant="primary" size="lg" icon="plus" loading={busy} onClick={create} block>Create a room</Button>
          <form className="joinrow" onSubmit={join}>
            <label className="sr-only" htmlFor="code">Room code</label>
            <input id="code" className="input input--code" inputMode="text" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={4} placeholder="CODE" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '')); setErr(''); }} />
            <Button type="submit" variant="ink" disabled={code.length !== 4}>Join</Button>
          </form>
        </article>

        <article className="mode">
          <span className="mode__icon mode__icon--gold"><Icon name="trophy" size={26} /></span>
          <h2>Solo Cup</h2>
          <p>Draft an XI, then beat four AI sides in a row. No waiting for anyone.{best ? ` Best run: ${best.wins}/4 wins.` : ''}</p>
          <Button variant="ink" size="lg" block icon="play" onClick={() => navigate('/cup')}>Start a run</Button>
        </article>

        <article className="mode">
          <span className="mode__icon mode__icon--blue"><Icon name="calendar" size={26} /></span>
          <h2>Daily Draft</h2>
          <p>The same packs for everyone today ({dailyLabel(today)}). Compare scores with your friends.{daily?.phase === 'over' ? ` You finished: ${daily.status === 'champion' ? 'Champions' : `${(daily.results ?? []).filter((r) => r.won).length}/4 wins`}.` : ''}</p>
          <Button variant="soft" size="lg" block icon="bolt" onClick={() => navigate('/daily')}>{daily?.phase === 'over' ? 'See your result' : daily ? 'Continue' : 'Play today'}</Button>
        </article>
      </section>

      <section className="pillars" aria-label="What makes it different">
        {[
          ['Steal their pick', 'In a Duel draft the board is shared. Once a card is taken, it is gone.'],
          ['See how it fits', 'Every spot on the pitch shows how well a player suits it, in colour, icon and words.'],
          ['Never gets stuck', 'Drop your connection and your seat waits. If someone vanishes, the draft carries on.'],
          ['A story, not a number', 'Minute-by-minute match reports, penalties, cards and a man of the match.'],
        ].map(([t, d]) => (
          <div key={t} className={cx('pillar')}>
            <b>{t}</b>
            <span>{d}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
