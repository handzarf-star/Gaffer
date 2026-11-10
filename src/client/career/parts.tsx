import { useEffect, useState, type ReactNode } from 'react';
import type { CareerView, News, Row } from '../../shared/career/engine';
import { basisOf, getWorld } from '../../shared/career/data';
import { lineOf, type Line } from '../../shared/career/world';
import { shortName } from '../../shared/players';
import { NationChip } from '../components/PlayerCard';
import { Badge } from './Badge';
import { cx } from '../components/ui';
import { useI18n } from '../lib/i18n';

export const W = getWorld();

export const clubName = (v: CareerView, id: string): string => v.clubs[id]?.name ?? W.clubs.find((c) => c.id === id)?.name ?? id;

export function ClubBadge({ v, id, size = 28 }: { v: CareerView; id: string; size?: number }) {
  const c = v.clubs[id];
  if (!c) return null;
  return <Badge badge={c.badge} initial={c.name} size={size} />;
}

export function ClubTag({ v, id, size = 24, mine }: { v: CareerView; id: string; size?: number; mine?: boolean }) {
  return (
    <span className={cx('clubtag', mine && 'is-mine')}>
      <ClubBadge v={v} id={id} size={size} />
      <span className="clubtag__name">{clubName(v, id)}</span>
    </span>
  );
}

export const ovrNow = (v: CareerView, id: string): number => v.ratings[id] ?? W.player(id).ovr;

export function useCountdown(until: number | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [until]);
  if (until === null) return '';
  const ms = until - now;
  if (ms <= 0) return '0m';
  const m = Math.floor(ms / 60_000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${Math.max(1, m)}m`;
}

export function useLineLabel() {
  const { t } = useI18n();
  return (l: Line): string => (l === 'GK' ? t('Goalkeepers') : l === 'DF' ? t('Defenders') : l === 'MF' ? t('Midfielders') : t('Forwards'));
}

export function useInjuryLabel() {
  const { t } = useI18n();
  return (kind: string): string => {
    switch (kind) {
      case 'knock': return t('Knock');
      case 'muscle': return t('Muscle injury');
      case 'sprain': return t('Sprain');
      case 'fracture': return t('Fracture');
      case 'cruciate': return t('Cruciate ligament');
      default: return t('Injury');
    }
  };
}

/** One player in a list: position, name, nation, age, rating, and anything that keeps him out. */
export function PlayerRow({ v, id, right, onClick, selected, dim, note, children }: {
  v: CareerView; id: string; right?: ReactNode; onClick?: () => void; selected?: boolean; dim?: boolean; note?: ReactNode; children?: ReactNode;
}) {
  const { t, tn } = useI18n();
  const injuryLabel = useInjuryLabel();
  const p = W.player(id);
  const inj = v.injuries[id];
  const ban = v.susp[id];
  const age = v.ages[id] ?? p.age;
  const newcomer = v.mine?.newcomers[id];
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={cx('prow', selected && 'is-selected', dim && 'is-dim', !!(inj || ban) && 'is-out')} {...(onClick ? { type: 'button' as const, onClick } : {})}>
      <span className={cx('prow__pos', `pos-${lineOf(p.pos)}`)} title={p.pos}>{p.pos}</span>
      <span className="prow__main">
        <span className="prow__name">{shortName(p.name)}</span>
        <span className="prow__meta">
          <NationChip code={p.nat} compact />
          <span>{age !== null && age !== undefined ? t('{n} yrs', { n: age }) : t('age unknown')}</span>
          {inj && <span className="tag tag--bad">🩹 {injuryLabel(inj.kind)} · {tn('{n} match', '{n} matches', inj.left)}</span>}
          {ban ? <span className="tag tag--bad">🚫 {t('Suspended')} · {tn('{n} match', '{n} matches', ban)}</span> : null}
          {newcomer && <span className="tag tag--warn">⏳ {t('Settling in')}</span>}
          {note}
        </span>
        {children}
      </span>
      <span className="prow__ovr" aria-label={t('Rating {n}', { n: ovrNow(v, id) })}>{Math.round(ovrNow(v, id))}</span>
      {right}
    </Tag>
  );
}

/** Why this rating: shown to anybody who asks, because the ratings are estimates and should say how they were made. */
export function WhyRating({ id }: { id: string }) {
  const { t, tn } = useI18n();
  const [open, setOpen] = useState(false);
  const basis = basisOf(id);
  return (
    <span className="why">
      <button type="button" className="why__btn" aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>{t('Why this rating?')}</button>
      {open && basis && (
        <span className="why__box" role="note">
          {t('An estimate, not an official rating. It is built from {caps}, {apps}, and his place among his club\'s players (number {rank}).', {
            caps: tn('{n} senior cap', '{n} senior caps', basis.caps),
            apps: tn('{n} club appearance', '{n} club appearances', basis.apps),
            rank: basis.rank,
          })}
        </span>
      )}
    </span>
  );
}

export function Standings({ v, league, mineId }: { v: CareerView; league: 1 | 2; mineId?: string }) {
  const { t } = useI18n();
  const rows: Row[] = v.leagues[league === 1 ? '1' : '2'].table;
  return (
    <div className="tablewrap" role="region" tabIndex={0} aria-label={league === 1 ? t('First League table') : t('Second League table')}>
      <table className="league">
        <caption className="sr-only">{league === 1 ? t('First League table') : t('Second League table')}</caption>
        <thead>
          <tr><th scope="col">#</th><th scope="col">{t('Club')}</th><th scope="col" title={t('Played')}>{t('P')}</th><th scope="col" title={t('Won')}>{t('W')}</th><th scope="col" title={t('Drawn')}>{t('D')}</th><th scope="col" title={t('Lost')}>{t('L')}</th><th scope="col" title={t('Goal difference')}>{t('GD')}</th><th scope="col" title={t('Points')}>{t('Pts')}</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className={cx(r.id === mineId && 'is-mine', league === 1 && i >= rows.length - 2 && 'is-down', league === 2 && i < 2 && 'is-up')}>
              <td>{i + 1}</td>
              <th scope="row"><ClubTag v={v} id={r.id} size={20} mine={r.id === mineId} /></th>
              <td>{r.p}</td><td>{r.w}</td><td>{r.d}</td><td>{r.l}</td><td>{r.gf - r.ga > 0 ? '+' : ''}{r.gf - r.ga}</td><td><b>{r.pts}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">{league === 1 ? t('The bottom two go down at the end of the season.') : t('The top two go up at the end of the season.')}</p>
    </div>
  );
}

export function NewsLine({ v, n }: { v: CareerView; n: News }) {
  const { t, tn } = useI18n();
  const injuryLabel = useInjuryLabel();
  const club = n.club ? clubName(v, n.club) : '';
  const pname = n.player && W.has(n.player) ? shortName(W.player(n.player).name) : '';
  const other = n.other && W.has(n.other) ? shortName(W.player(n.other).name) : '';
  let text: string;
  switch (n.kind) {
    case 'joined': text = t('{who} took charge of {club}.', { who: n.text ?? '', club }); break;
    case 'draft_start': text = t('The draft has begun: every club picks from the whole pool.'); break;
    case 'draft_done': text = t('The draft is over. Squads are set.'); break;
    case 'season_start': text = t('Season {n} kicks off.', { n: n.n ?? 0 }); break;
    case 'injury': text = t('{p} ({club}) is injured: {kind}, out for {m}.', { p: pname, club, kind: injuryLabel(n.text ?? ''), m: tn('{n} match', '{n} matches', n.n ?? 1) }); break;
    case 'suspension': text = t('{p} ({club}) is banned for {m} after five yellow cards.', { p: pname, club, m: tn('{n} match', '{n} matches', n.n ?? 1) }); break;
    case 'red': text = t('{p} ({club}) was sent off and misses {m}.', { p: pname, club, m: tn('{n} match', '{n} matches', n.n ?? 1) }); break;
    case 'window_open': text = n.text === 'mid' ? t('The mid-season transfer window is open.') : t('The end-of-season transfer window is open.'); break;
    case 'window_done': text = t('The transfer window has closed.'); break;
    case 'swap': text = t('{club} signed {p} in place of {o}.', { club, p: pname, o: other }); break;
    case 'swap_failed': text = t('{club} missed out on {p}: somebody else got him first.', { club, p: pname }); break;
    case 'champion': text = t('{club} are champions!', { club }); break;
    case 'promoted': text = t('{club} are promoted to the First League.', { club }); break;
    case 'relegated': text = t('{club} are relegated to the Second League.', { club }); break;
    default: text = '';
  }
  return <li className="news__item"><span className="news__day">{t('S{s} · day {d}', { s: n.season, d: n.day })}</span> {text}</li>;
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="panel career__section">
      <div className="career__sectionhead"><h2 className="panel__title">{title}</h2>{aside}</div>
      {children}
    </section>
  );
}
