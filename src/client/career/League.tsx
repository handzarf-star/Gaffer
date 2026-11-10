import { useCallback, useState } from 'react';
import { Banner, Button, Spinner, copyText } from '../components/ui';
import { api, useLeague } from '../lib/api';
import { navigate } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { useMe } from './CareerHome';
import { useErrorText, type LeagueCtx } from './ctx';
import { DraftRoom } from './DraftRoom';
import { Lobby } from './Lobby';
import { Matchday } from './Matchday';
import { SignIn } from './SignIn';
import { Standings, Section } from './parts';
import { Watch } from './Watch';
import { Window } from './Window';

export function LeaguePage({ code }: { code: string }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const { view, state, apply } = useLeague(code);
  const { me, setMe } = useMe();
  const [watch, setWatch] = useState(false);
  const [copied, setCopied] = useState(false);

  const act = useCallback(async (msg: Record<string, unknown>): Promise<string | null> => {
    const r = await api.act(code, msg);
    if (r.ok) { apply(r.data.view); return null; }
    return errorText(r.error.code);
  }, [code, apply, errorText]);

  if (state === 'missing') return <div className="panel"><h1>{t('No such league')}</h1><p>{t('Check the code and try again.')}</p><Button variant="primary" onClick={() => navigate('/career')}>{t('Back to career mode')}</Button></div>;
  if (!view) return <div className="center" role="status">{state === 'offline' ? <p className="muted">{t('No connection. Trying again…')}</p> : <Spinner />}</div>;

  const signedIn = !!me?.user;
  const ctx: LeagueCtx = { code, v: view, act };
  const mine = view.me;
  const canJoin = view.phase === 'lobby' && !mine;

  return (
    <div className="career">
      <header className="career__bar">
        <button type="button" className="career__back" onClick={() => navigate('/career')}>← {t('Career')}</button>
        <span className="career__code">{t('League {code}', { code })}</span>
        <Button size="sm" variant="ghost" onClick={async () => { setCopied(await copyText(`${location.origin}/c/${code}`)); window.setTimeout(() => setCopied(false), 2000); }}>{copied ? t('Link copied') : t('Copy link')}</Button>
      </header>
      {state === 'offline' && <Banner tone="warn" icon="info">{t('No connection. Trying again…')}</Banner>}

      {canJoin && !signedIn ? (
        <Section title={t('Sign in to join')}><SignIn googleClientId={me?.googleClientId ?? null} onDone={setMe} /></Section>
      ) : view.phase === 'lobby' ? (
        <Lobby ctx={ctx} defaultName={me?.user?.name ?? ''} />
      ) : view.phase === 'draft' ? (
        <DraftRoom ctx={ctx} />
      ) : view.phase === 'window' ? (
        <Window key={`${view.season}-${view.window?.kind}`} ctx={ctx} />
      ) : mine ? (
        watch ? <Watch code={code} v={view} onClose={() => setWatch(false)} /> : <Matchday ctx={ctx} onWatch={() => setWatch(true)} />
      ) : (
        <>
          <Banner tone="info" icon="info">{t('You are watching this league.')}</Banner>
          <Section title={t('First League')}><Standings v={view} league={1} /></Section>
          <Section title={t('Second League')}><Standings v={view} league={2} /></Section>
        </>
      )}
    </div>
  );
}
