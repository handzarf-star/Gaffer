import '@fontsource-variable/bricolage-grotesque/index.css';
import '@fontsource-variable/inter/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import './styles/game.css';
import './styles/career.css';
import { LangProvider } from './lib/i18n';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <App />
    </LangProvider>
  </StrictMode>,
);
