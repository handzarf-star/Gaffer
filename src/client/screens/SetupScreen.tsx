import { useMemo, useState } from 'react';
import type { RatingsMode } from '../../shared/draft';
import type { TFn } from '../../shared/i18n';
import { FORMATIONS, FORMATION_IDS, fitKind, penalty, type FormationId } from '../../shared/formations';
import { player, shortName } from '../../shared/players';
import { STYLES, STYLE_IDS, profile, type Squad, type StyleId } from '../../shared/squad';
import { Pitch } from '../components/Pitch';
import { Timer } from '../components/Timer';
import { Avatar, Button, Icon, cx } from '../components/ui';
import { useI18n } from '../lib/i18n';
import { sfx } from '../lib/sfx';

export interface SetupRival {
  id: string;
  name: string;
  hue: number;
  ready: boolean;
  connected: boolean;
}

export interface SetupProps {
  squad: Squad;
  mode: RatingsMode;
  deadline: number | null;
  offset: number;
  totalMs: number;
  ready: boolean;
  rivals: SetupRival[];
  onFormation: (f: FormationId) => void;
  onSwap: (a: string, b: string) => void;
  onArrange: () => void;
  onStyle: (s: StyleId) => void;
  onReady: (r: boolean) => void;
  title: string;
  subtitle: string;
  readyLabel?: string;
  /** solo cup: who you are about to face */
  opponent?: { name: string; overall: number; stage: string };
}

type SectorKey = 'att' | 'mid' | 'def' | 'gk';
const SECTORS: Array<{ key: SectorKey }> = [{ key: 'att' }, { key: 'mid' }, { key: 'def' }, { key: 'gk' }];

function sectorLabel(t: TFn, key: SectorKey): string {
  switch (key) {
    case 'att': return t('Attack');
    case 'mid': return t('Midfield');
    case 'def': return t('Defence');
    default: return t('Keeper');
  }
}

export function SetupScreen(p: SetupProps) {
  const { t } = useI18n();
  const [sel, setSel] = useState<string | null>(null);
  const prof = useMemo(() => profile(p.squad), [p.squad]);
  const f = FORMATIONS[p.squad.formation];

  const problems = useMemo(() => {
    const out: Array<{ slot: string; role: string; name: string; pen: number }> = [];
    for (const s of f.slots) {
      const id = p.squad.slots[s.id];
      if (!id) continue;
      const pl = player(id);
      const k = fitKind(pl.pos, s.role);
      if (k !== 'natural') out.push({ slot: s.id, role: s.role, name: shortName(pl.name), pen: penalty(pl.pos, s.role) });
    }
    return out.filter((x) => x.pen >= 6);
  }, [p.squad, f]);

  const onSlot = (id: string) => {
    sfx.select();
    if (!sel) return setSel(id);
    if (sel === id) return setSel(null);
    p.onSwap(sel, id);
    setSel(null);
    sfx.pick();
  };

  const waiting = p.rivals.filter((r) => !r.ready && r.connected);

  return (
    <div className="setup">
      <header className="setup__head">
        <div>
          <h1>{p.title}</h1>
          <p>{p.subtitle}</p>
        </div>
        <Timer deadline={p.deadline} offset={p.offset} totalMs={p.totalMs} size={56} />
      </header>

      {p.opponent && (
        <div className="opp">
          <Icon name="trophy" size={18} />
          <span><b>{p.opponent.stage}</b> {t('vs')} <b>{p.opponent.name}</b></span>
          <span className="opp__ovr">{t('OVR {value}', { value: p.opponent.overall.toFixed(1) })}</span>
        </div>
      )}

      <div className="setup__grid">
        <section className="panel setup__pitch">
          <div className="formations" role="radiogroup" aria-label={t('Formation')}>
            {FORMATION_IDS.map((id) => (
              <button
                key={id}
                role="radio"
                aria-checked={p.squad.formation === id}
                className={cx('fpill', p.squad.formation === id && 'is-on')}
                onClick={() => { sfx.select(); p.onFormation(id); setSel(null); }}
              >
                {FORMATIONS[id].name}
              </button>
            ))}
          </div>
          <Pitch
            formation={p.squad.formation}
            slots={p.squad.slots}
            links={prof.chem.links}
            linkCount={prof.chem.perSlot}
            selected={sel}
            onSlot={onSlot}
            ratings={p.mode === 'hidden' ? 'tier' : p.mode}
            label={t('Your lineup. Tap two players to swap them.')}
          />
          <p className="hint"><Icon name="swap" size={16} /> {t('Tap two players to swap them. Chemistry lines connect teammates from the same nation.')}</p>
        </section>

        <section className="setup__side">
          <div className="panel overall">
            <div className="overall__big">
              <span>{t('Overall')}</span>
              <b>{prof.overall.toFixed(1)}</b>
            </div>
            <div className="meters">
              {SECTORS.map((s) => {
                const v = prof[s.key];
                const base = prof.base[s.key];
                const delta = Math.round((v - base) * 10) / 10;
                const label = sectorLabel(t, s.key);
                return (
                  <div className="meter" key={s.key}>
                    <div className="meter__row">
                      <span>{label}</span>
                      <b>{v.toFixed(0)}{delta !== 0 && <em className={delta > 0 ? 'up' : 'down'}>{delta > 0 ? '+' : ''}{delta}</em>}</b>
                    </div>
                    <div className="meter__bar" role="img" aria-label={`${label} ${v.toFixed(0)}`}><i style={{ width: `${Math.max(4, Math.min(100, ((v - 50) / 50) * 100))}%` }} /></div>
                  </div>
                );
              })}
              <div className="meter">
                <div className="meter__row"><span>{t('Chemistry')}</span><b>{prof.chem.score}%</b></div>
                <div className="meter__bar meter__bar--chem" role="img" aria-label={t('Chemistry {score} percent', { score: prof.chem.score })}><i style={{ width: `${Math.max(3, prof.chem.score)}%` }} /></div>
              </div>
            </div>
            {problems.length > 0 && (
              <div className="problems">
                <Icon name="info" size={16} />
                <span>{t('{n} out of position: {list}', { n: problems.length, list: problems.slice(0, 3).map((x) => t('{name} at {role} (-{pen})', { name: x.name, role: x.role, pen: x.pen })).join(', ') })}{problems.length > 3 ? '…' : ''}</span>
                <Button size="sm" variant="soft" icon="refresh" onClick={() => { p.onArrange(); setSel(null); }}>{t('Auto-arrange')}</Button>
              </div>
            )}
          </div>

          <div className="panel">
            <h2 className="panel__title">{t('Tactics')}</h2>
            <div className="styles" role="radiogroup" aria-label={t('Tactics')}>
              {STYLE_IDS.map((id) => {
                const s = STYLES[id];
                return (
                  <button key={id} role="radio" aria-checked={p.squad.style === id} className={cx('style', p.squad.style === id && 'is-on')} onClick={() => { sfx.select(); p.onStyle(id); }}>
                    <b>{t(s.name)}</b>
                    <span>{t(s.blurb)}</span>
                    <small>{t(s.tradeoff)}</small>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="panel readybar">
            {p.rivals.length > 0 && (
              <div className="readybar__who">
                {p.rivals.map((r) => (
                  <span key={r.id} className={cx('chip', r.ready && 'chip--ok')}>
                    <Avatar name={r.name} hue={r.hue} size={18} connected={r.connected} />
                    {r.ready ? t('{name} is ready', { name: r.name }) : r.connected ? t('{name} is setting up', { name: r.name }) : t('{name} is away', { name: r.name })}
                  </span>
                ))}
              </div>
            )}
            {p.ready ? (
              <div className="readybar__row">
                <span className="readybar__wait"><Icon name="check" size={18} /> {waiting.length ? t('Locked in. Waiting for {names}…', { names: waiting.map((w) => w.name).join(', ') }) : t('Locked in. Kick-off!')}</span>
                <Button variant="ghost" size="sm" onClick={() => p.onReady(false)}>{t('Change something')}</Button>
              </div>
            ) : (
              <Button variant="primary" size="lg" block icon="whistle" onClick={() => { sfx.whistle(); p.onReady(true); }}>
                {p.readyLabel ?? t('Lock in lineup')}
              </Button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
