import { useCallback, useEffect, useState } from 'react';
import { ROOM_CODE_RE } from '../../shared/protocol';
import { Button } from '../components/ui';
import { api, type Me, type MyCareer } from '../lib/api';
import { navigate } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { SignIn } from './SignIn';
import { W } from './parts';

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { void api.me().then((r) => { if (r.ok) setMe(r.data); setLoading(false); }); }, []);
  return { me, setMe, loading };
}

export function CareerHome() {
  const { t, tn } = useI18n();
  const { me, setMe, loading } = useMe();
  const [mine, setMine] = useState<MyCareer[]>([]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const signedIn = !!me?.user;

  useEffect(() => { if (signedIn) void api.mine().then((r) => { if (r.ok) setMine(r.data.careers); }); }, [signedIn]);

  const create = useCallback(async () => {
    setBusy(true); setErr('');
    const r = await api.create();
    setBusy(false);
    if (r.ok) navigate(`/c/${r.data.code}`);
    else setErr(t('Could not create a league. Try again.'));
  }, [t]);

  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!ROOM_CODE_RE.test(c)) return setErr(t('League codes are 4 letters, like KQTM.'));
    navigate(`/c/${c}`);
  };
  const logout = async () => { await api.logout(); setMe((m) => (m ? { ...m, user: null } : m)); setMine([]); };

  if (loading) return <p className="muted" role="status">{t('Loading…')}</p>;

  return (
    <div className="career">
      <section className="hero career__hero">
        <p className="eyebrow">{t('Career mode · 1 to 4 managers')}</p>
        <h1 className="hero__title career__title">{t('Run a real Balkan club.')}</h1>
        <p className="hero__sub">{t('Pick a club, draft from every squad in the league, then manage it season after season: injuries, bans, a bench, a mid-season transfer window, promotion and relegation.')}</p>
      </section>

      {!signedIn ? (
        <section className="panel career__section">
          <h2 className="panel__title">{t('Sign in to play')}</h2>
          <SignIn googleClientId={me?.googleClientId ?? null} onDone={setMe} />
        </section>
      ) : (
        <>
          <section className="panel career__section">
            <div className="career__sectionhead">
              <h2 className="panel__title">{t('Hi, {name}', { name: me!.user!.name })}</h2>
              <Button variant="ghost" size="sm" onClick={logout}>{t('Sign out')}</Button>
            </div>
            <div className="career__actions">
              <Button variant="primary" size="lg" icon="plus" loading={busy} onClick={create}>{t('Create a league')}</Button>
              <form className="joinrow" onSubmit={join}>
                <label className="sr-only" htmlFor="lcode">{t('League code')}</label>
                <input id="lcode" className="input input--code" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={4} placeholder="CODE" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setErr(''); }} />
                <Button type="submit" variant="ink" disabled={code.length !== 4}>{t('Join')}</Button>
              </form>
            </div>
            {err && <p className="error" role="alert">{err}</p>}
          </section>

          {mine.length > 0 && (
            <section className="panel career__section">
              <h2 className="panel__title">{t('Your leagues')}</h2>
              <ul className="leaguelist">
                {mine.map((c) => (
                  <li key={c.code}>
                    <button type="button" className="leaguelist__item" onClick={() => navigate(`/c/${c.code}`)}>
                      <b>{c.code}</b>
                      <span>{W.clubs.find((x) => x.id === c.club)?.name ?? t('Your own club')}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="muted small">{tn('{n} league on this account', '{n} leagues on this account', mine.length)}</p>
            </section>
          )}
        </>
      )}

      <section className="panel career__section career__how">
        <h2 className="panel__title">{t('How a career works')}</h2>
        <ol>
          <li>{t('The draft: every club, yours and the computer\'s, picks 20 real players from the whole First League pool in a snake order.')}</li>
          <li>{t('30 matchdays. Set your line-up and tap Ready. The day plays when everyone is ready, or at the deadline with your saved line-up.')}</li>
          <li>{t('Players get injured and banned. Keep a deep bench.')}</li>
          <li>{t('After matchday 15 the transfer window opens. Up to 3 changes are free. More than that and your new players need time to settle, and the whole team loses sharpness. Never points.')}</li>
          <li>{t('At the end of the season the bottom two go down, the top two of the Second League come up, players age, and the window opens again.')}</li>
        </ol>
        <p className="muted small">{t('Ratings are estimates built from public facts (national-team caps, appearances, club level). They are not official ratings.')}</p>
      </section>
    </div>
  );
}
