import { Component, type ReactNode } from 'react';
import { ROOM_CODE_RE } from '../shared/protocol';
import { SoundToggle, ThemeToggle, Toasts, Wordmark, Button } from './components/ui';
import { navigate, usePath } from './lib/hooks';
import { CupPage } from './screens/Cup';
import { Home } from './screens/Home';
import { HowTo } from './screens/HowTo';
import { RoomPage } from './screens/RoomPage';

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
    return (
      <div className="gate panel">
        <h1>Something tripped up</h1>
        <p>The game hit an unexpected problem. Your seat in a room is saved, so reloading is safe.</p>
        <div className="row">
          <Button variant="primary" onClick={() => location.reload()}>Reload</Button>
          <Button variant="ghost" onClick={() => { this.setState({ failed: false }); navigate('/'); }}>Go home</Button>
        </div>
      </div>
    );
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
  return <Home />;
}

export default function App() {
  const path = usePath();
  return (
    <div className="app">
      <div className="app__bg" aria-hidden="true"><i /><i /><i /></div>
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <Wordmark onClick={() => navigate('/')} />
        <nav className="topbar__nav" aria-label="Main">
          <a href="/how-to-play" onClick={(e) => { e.preventDefault(); navigate('/how-to-play'); }}>How to play</a>
          <span id="topbar-slot" className="topbar__slot" />
          <ThemeToggle />
          <SoundToggle />
        </nav>
      </header>
      <main id="main" className="page">
        <Boundary>
          <Route path={path} />
        </Boundary>
      </main>
      <footer className="foot">
        <span>An independent fan game. Names only: no photos, badges or kits. Ratings are our own opinions.</span>
      </footer>
      <div id="live-region" className="sr-only" aria-live="polite" role="status" />
      <Toasts />
    </div>
  );
}
