import { useEffect, useRef, useState } from 'react';
import { api, type Me } from '../lib/api';
import { Button } from '../components/ui';
import { useI18n } from '../lib/i18n';
import { getName, setName } from '../lib/storage';

declare global {
  interface Window {
    google?: { accounts: { id: { initialize: (o: Record<string, unknown>) => void; renderButton: (el: HTMLElement, o: Record<string, unknown>) => void } } };
  }
}

/** Loads Google's sign-in script only when the server says Google sign-in is switched on. */
function GoogleButton({ clientId, onDone }: { clientId: string; onDone: (me: Me) => void }) {
  const { t, lang } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let dead = false;
    const start = async () => {
      const n = await api.nonce();
      if (dead || !n.ok || !box.current || !window.google) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        nonce: n.data.nonce,
        use_fedcm_for_prompt: true,
        callback: async (resp: { credential?: string }) => {
          if (!resp.credential) return;
          const r = await api.google(resp.credential);
          if (r.ok) onDone(r.data);
          else setErr(r.error.msg || t('Google sign-in did not work. Try again, or play as a guest.'));
        },
      });
      window.google.accounts.id.renderButton(box.current, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', locale: lang === 'bs' ? 'bs' : 'en', width: 280 });
    };
    if (window.google) void start();
    else {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => void start();
      s.onerror = () => setErr(t('Could not reach Google. You can still play as a guest.'));
      document.head.appendChild(s);
    }
    return () => { dead = true; };
  }, [clientId, lang, onDone, t]);
  return (
    <div className="gsi">
      <div ref={box} />
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}

export function SignIn({ googleClientId, onDone }: { googleClientId: string | null; onDone: (me: Me) => void }) {
  const { t } = useI18n();
  const [name, setNameState] = useState(getName());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const guest = async () => {
    setBusy(true); setErr('');
    const n = name.trim();
    if (n) setName(n);
    const r = await api.guest(n);
    setBusy(false);
    if (r.ok) onDone(r.data);
    else setErr(t('Could not sign you in. Check your connection and try again.'));
  };
  return (
    <div className="signin">
      {googleClientId && (
        <>
          <GoogleButton clientId={googleClientId} onDone={onDone} />
          <p className="muted small">{t('We never see your Google password. We keep only a private code made from your Google account, never your email.')}</p>
          <p className="signin__or"><span>{t('or')}</span></p>
        </>
      )}
      <label htmlFor="guestname">{t('Your name')}</label>
      <input id="guestname" className="input" maxLength={20} autoComplete="nickname" placeholder={t('What do your mates call you?')} value={name} onChange={(e) => setNameState(e.target.value)} />
      <Button variant="primary" size="lg" block loading={busy} onClick={guest}>{t('Play as a guest')}</Button>
      <p className="muted small">{t('A guest account lives in this browser. If you clear your browser data you lose your leagues, so use Google sign-in for a league you want to keep.')}</p>
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}
