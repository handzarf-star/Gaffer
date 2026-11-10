import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_LANG, LANGS, LANG_IDS, detectLang, makeT, type Lang, type TFn, type TnFn } from '../../shared/i18n';
import '../../shared/i18n/bs';
import { lsGet, lsSet } from './storage';

interface Ctx { lang: Lang; setLang: (l: Lang) => void; t: TFn; tn: TnFn }
const I18n = createContext<Ctx>({ lang: DEFAULT_LANG, setLang: () => {}, ...makeT(DEFAULT_LANG) });

const initial = (): Lang => detectLang(lsGet<string | null>('lang', null), typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : []);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);
  const setLang = useCallback((l: Lang) => { setLangState(l); lsSet('lang', l); }, []);
  useEffect(() => { document.documentElement.lang = LANGS[lang].tag; }, [lang]);
  const value = useMemo<Ctx>(() => ({ lang, setLang, ...makeT(lang) }), [lang, setLang]);
  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

export const useI18n = (): Ctx => useContext(I18n);

/** EN | BS switch for the top bar. */
export function LangToggle() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="langtoggle" role="group" aria-label={t('Language')}>
      {LANG_IDS.map((l) => (
        <button key={l} type="button" className={l === lang ? 'is-on' : ''} aria-pressed={l === lang} lang={LANGS[l].tag} onClick={() => setLang(l)} title={LANGS[l].native}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
