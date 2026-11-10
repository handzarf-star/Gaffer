import { useRef, useState } from 'react';
import { BRAND } from '../../shared/brand';
import { dailyLabel, dailySeed } from '../../shared/cup';
import { ROOM_CODE_RE } from '../../shared/protocol';
import { Button, Icon, cx } from '../components/ui';
import { navigate } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { sfx } from '../lib/sfx';
import { getName, lastRoom, lsGet, setName } from '../lib/storage';

export function Home() {
  const { t } = useI18n();
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
      setErr(t('Add your name first so your mate knows who they are playing.'));
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
      setErr(t('Could not create a room. Check your connection and try again.'));
    } finally {
      setBusy(false);
    }
  };

  const join = (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    const c = code.trim().toUpperCase();
    if (!ROOM_CODE_RE.test(c)) return setErr(t('Room codes are 4 letters, like KQTM.'));
    if (!needName()) return;
    navigate(`/r/${c}`);
  };

  return (
    <div className="home">
      <section className="hero">
        <p className="eyebrow">{t('Free · No sign-up · 2 to 4 players')}</p>
        <h1 className="hero__title">{t(BRAND.tagline).split('. ').map((w, i) => <span key={i}>{w.replace('.', '')}<i>.</i> </span>)}</h1>
        <p className="hero__sub">{t(BRAND.blurb)}</p>
        <div className="namefield">
          <label htmlFor="name">{t('Your name')}</label>
          <input ref={nameRef} id="name" className="input" maxLength={16} autoComplete="nickname" placeholder={t('What do your mates call you?')} value={name} onChange={(e) => { setNameState(e.target.value); setErr(''); }} />
        </div>
        {err && <p className="error" role="alert">{err}</p>}
      </section>

      {last && (
        <button className="resume" onClick={() => navigate(`/r/${last.code}`)}>
          <Icon name="refresh" size={18} />
          <span>{t('You were in room')} <b>{last.code}</b>. {t('Rejoin')}</span>
          <Icon name="arrow" size={18} />
        </button>
      )}

      <section className="modes" aria-label={t('Ways to play')}>
        <article className="mode mode--primary">
          <span className="mode__icon"><Icon name="users" size={26} /></span>
          <h2>{t('Play a friend')}</h2>
          <p>{t('Private room, one link. Take turns drafting from a shared board and steal each other\'s targets.')}</p>
          <Button variant="primary" size="lg" icon="plus" loading={busy} onClick={create} block>{t('Create a room')}</Button>
          <form className="joinrow" onSubmit={join}>
            <label className="sr-only" htmlFor="code">{t('Room code')}</label>
            <input id="code" className="input input--code" inputMode="text" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={4} placeholder="CODE" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '')); setErr(''); }} />
            <Button type="submit" variant="ink" disabled={code.length !== 4}>{t('Join')}</Button>
          </form>
        </article>

        <article className="mode">
          <span className="mode__icon mode__icon--gold"><Icon name="trophy" size={26} /></span>
          <h2>{t('Solo Cup')}</h2>
          <p>{t('Draft an XI, then beat four AI sides in a row. No waiting for anyone.')}{best ? ` ${t('Best run: {n}/4 wins.', { n: best.wins })}` : ''}</p>
          <Button variant="ink" size="lg" block icon="play" onClick={() => navigate('/cup')}>{t('Start a run')}</Button>
        </article>

        <article className="mode">
          <span className="mode__icon mode__icon--blue"><Icon name="calendar" size={26} /></span>
          <h2>{t('Daily Draft')}</h2>
          <p>{t('The same packs for everyone today ({date}). Compare scores with your friends.', { date: dailyLabel(today) })}{daily?.phase === 'over' ? ` ${t('You finished: {result}.', { result: daily.status === 'champion' ? t('Champions') : t('{n}/4 wins', { n: (daily.results ?? []).filter((r) => r.won).length }) })}` : ''}</p>
          <Button variant="soft" size="lg" block icon="bolt" onClick={() => navigate('/daily')}>{daily?.phase === 'over' ? t('See your result') : daily ? t('Continue') : t('Play today')}</Button>
        </article>

        <article className="mode">
          <span className="mode__icon mode__icon--blue"><Icon name="trophy" size={26} /></span>
          <h2>{t('Career mode')}</h2>
          <p>{t('Run a real Balkan club for seasons: draft from every squad, injuries, a bench, transfer windows, promotion and relegation.')}</p>
          <Button variant="soft" size="lg" block icon="play" onClick={() => navigate('/career')}>{t('Start a career')}</Button>
        </article>
      </section>

      <section className="pillars" aria-label={t('What makes it different')}>
        {[
          [t('Steal their pick'), t('In a Duel draft the board is shared. Once a card is taken, it is gone.')],
          [t('See how it fits'), t('Every spot on the pitch shows how well a player suits it, in colour, icon and words.')],
          [t('Never gets stuck'), t('Drop your connection and your seat waits. If someone vanishes, the draft carries on.')],
          [t('A story, not a number'), t('Minute-by-minute match reports, penalties, cards and a man of the match.')],
        ].map(([title, d]) => (
          <div key={title} className={cx('pillar')}>
            <b>{title}</b>
            <span>{d}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
