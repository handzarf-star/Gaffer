import { Component, type ReactNode } from 'react';
import { ROOM_CODE_RE } from '../shared/protocol';
import { Banner, SoundToggle, ThemeToggle, Toasts, Wordmark, Button } from './components/ui';
import { navigate, usePath } from './lib/hooks';
import { useEffect } from 'react';
import { useStaleBuild, watchBuild } from './lib/build';
import { CareerHome } from './career/CareerHome';
import { LeaguePage } from './career/League';
import { LangToggle, useI18n } from './lib/i18n';
import { CupPage } from './screens/Cup';
import { Home } from './screens/Home';
import { HowTo } from './screens/HowTo';
import { RoomPage } from './screens/RoomPage';

function Fallback({ onReset }: { onReset: () => void }) {
  const { t } = useI18n();
  return (
    <div className="gate panel">
      <h1>{t('Something tripped up')}</h1>
      <p>{t('The game hit an unexpected problem. Your seat in a room is saved, so reloading is safe.')}</p>
      <div className="row">
        <Button variant="primary" onClick={() => location.reload()}>{t('Reload')}</Button>
        <Button variant="ghost" onClick={() => { onReset(); navigate('/'); }}>{t('Go home')}</Button>
      </div>
    </div>
  );
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(err: unknown) {
    console.error(err);
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return <Fallback onReset={() => this.setState({ failed: false })} />;
  }
}

function Route({ path }: { path: string }) {
  const room = path.match(/^\/r\/([A-Za-z]{4})\/?$/) ?? path.match(/^\/([A-Za-z]{4})\/?$/);
  if (room) {
    const code = room[1]!.toUpperCase();
    if (ROOM_CODE_RE.test(code)) return <RoomPage key={code} code={code} />;
  }
  if (path === '/cup') return <CupPage key="cup" mode="cup" />;
  if (path === '/daily') return <CupPage key="daily" mode="daily" />;
  if (path === '/how-to-play') return <HowTo />;
  if (path === '/career') return <CareerHome />;
  const lg = path.match(/^\/c\/([A-Za-z]{4})\/?$/);
  if (lg && ROOM_CODE_RE.test(lg[1]!.toUpperCase())) return <LeaguePage key={lg[1]!.toUpperCase()} code={lg[1]!.toUpperCase()} />;
  return <Home />;
}

/** A page left open across a deploy keeps running old code against the new server. Never reload on its own (it could cost a draft): ask. */
function UpdateBanner() {
  const { t } = useI18n();
  const stale = useStaleBuild();
  if (!stale) return null;
  return (
    <Banner tone="info" icon="refresh">
      <span>{t('A new version is available.')}</span>
      <Button size="sm" variant="ink" onClick={() => location.reload()}>{t('Reload')}</Button>
    </Banner>
  );
}

export default function App() {
  const path = usePath();
  const { t } = useI18n();
  useEffect(() => watchBuild(), []);
  return (
    <div className="app">
      <div className="app__bg" aria-hidden="true"><i /><i /><i /></div>
      <a className="skip" href="#main">{t('Skip to content')}</a>
      <header className="topbar">
        <Wordmark onClick={() => navigate('/')} />
        <nav className="topbar__nav" aria-label={t('Main')}>
          <a href="/career" onClick={(e) => { e.preventDefault(); navigate('/career'); }}>{t('Career')}</a>
          <a href="/how-to-play" onClick={(e) => { e.preventDefault(); navigate('/how-to-play'); }}>{t('How to play')}</a>
          <span id="topbar-slot" className="topbar__slot" />
          <LangToggle />
          <ThemeToggle />
          <SoundToggle />
        </nav>
      </header>
      <main id="main" className="page">
        <UpdateBanner />
        <Boundary>
          <Route path={path} />
        </Boundary>
      </main>
      <footer className="foot">
        <span>{t('An independent fan game. Names only: no photos, badges or kits. Ratings are our own opinions.')}</span>
      </footer>
      <div id="live-region" className="sr-only" aria-live="polite" role="status" />
      <Toasts />
    </div>
  );
}
