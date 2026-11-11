import { useRef, useState } from 'react';
import { BRAND } from '../../shared/brand';
import { dailyLabel, dailySeed } from '../../shared/cup';
import { ROOM_CODE_RE } from '../../shared/protocol';
import { Button, Icon } from '../components/ui';
import { navigate } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { sfx } from '../lib/sfx';
import { getName, lastRoom, lsGet, setName } from '../lib/storage';

/** One front door: start a league (or join one). The older ways to play are under "More". */
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
      setErr(t('Add your name first so your mates know who they are playing.'));
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
        <p className="eyebrow">{t('Free · 1 to 4 managers · CPU teams fill the league')}</p>
        <h1 className="hero__title">{t(BRAND.tagline).split('. ').map((w, i) => <span key={i}>{w.replace('.', '')}<i>.</i> </span>)}</h1>
        <p className="hero__sub">{t('Draft a squad from three mystery packs a turn, steal a rival\'s card, then play the league. Nobody sees your match before you do.')}</p>
      </section>

      {last && (
        <button className="resume" onClick={() => navigate(`/r/${last.code}`)}>
          <Icon name="refresh" size={18} />
          <span>{t('You were in room')} <b>{last.code}</b>. {t('Rejoin')}</span>
          <Icon name="arrow" size={18} />
        </button>
      )}

      <section className="start panel" aria-label={t('Start')}>
        <div className="namefield">
          <label htmlFor="name">{t('Your name')}</label>
          <input ref={nameRef} id="name" className="input" maxLength={16} autoComplete="nickname" placeholder={t('What do your mates call you?')} value={name} onChange={(e) => { setNameState(e.target.value); setErr(''); }} />
        </div>
        {err && <p className="error" role="alert">{err}</p>}
        <Button variant="primary" size="lg" icon="plus" loading={busy} onClick={create} block>{t('Start a league')}</Button>
        <p className="muted small start__note">{t('You get a link to send to your mates. Play it in one evening, or carry on over days.')}</p>
        <form className="joinrow" onSubmit={join}>
          <label className="sr-only" htmlFor="code">{t('Room code')}</label>
          <input id="code" className="input input--code" inputMode="text" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={4} placeholder="KQTM" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '')); setErr(''); }} />
          <Button type="submit" variant="ink" disabled={code.length !== 4}>{t('Join')}</Button>
        </form>
      </section>

      <details className="more more--home">
        <summary>{t('More ways to play')}</summary>
        <ul className="morelist">
          <li>
            <button type="button" onClick={() => navigate('/cup')}>
              <b>{t('Solo Cup')}</b>
              <span>{t('Draft an XI, then beat four AI sides in a row. No waiting for anyone.')}{best ? ` ${t('Best run: {n}/4 wins.', { n: best.wins })}` : ''}</span>
            </button>
          </li>
          <li>
            <button type="button" onClick={() => navigate('/daily')}>
              <b>{t('Daily Draft')}</b>
              <span>{t('The same packs for everyone today ({date}). Compare scores with your friends.', { date: dailyLabel(today) })}{daily?.phase === 'over' ? ` ${t('You finished: {result}.', { result: daily.status === 'champion' ? t('Champions') : t('{n}/4 wins', { n: (daily.results ?? []).filter((r) => r.won).length }) })}` : ''}</span>
            </button>
          </li>
          <li>
            <button type="button" onClick={() => navigate('/career')}>
              <b>{t('Career mode')}</b>
              <span>{t('Run a real Balkan club for seasons: draft from every squad, injuries, a bench, transfer windows, promotion and relegation.')}</span>
            </button>
          </li>
        </ul>
      </details>
    </div>
  );
}
