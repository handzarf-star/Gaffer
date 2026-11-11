import type { CSSProperties } from 'react';
import type { TFn } from '../../shared/i18n';
import type { RatingsMode } from '../../shared/draft';
import { nation, nationGradient } from '../../shared/nations';
import { player, shortName, tierOf, type Tier } from '../../shared/players';
import { hashSeed } from '../../shared/rng';
import { useI18n } from '../lib/i18n';
import { useBands } from '../lib/tier';
import { cx } from './ui';

export function initials(name: string): string {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function faceHue(id: string): number {
  return hashSeed(id) % 360;
}

/** Tier names (Bronze/Silver/Gold/Icon) in the reader's language. The English names live in shared/players.ts. */
export function tierLabel(t: TFn, tier: Tier): string {
  switch (tier) {
    case 'bronze': return t('Bronze');
    case 'silver': return t('Silver');
    case 'gold': return t('Gold');
    default: return t('Icon');
  }
}

export function NationChip({ code, compact }: { code: string; compact?: boolean }) {
  const { t } = useI18n();
  const n = nation(code);
  return (
    <span className={cx('nation', compact && 'nation--compact')} title={t(n.name)}>
      <span className="nation__band" style={{ background: nationGradient(code) }} />
      <span className="nation__code">{code}</span>
    </span>
  );
}

const STARS: Record<Tier, number> = { bronze: 1, silver: 2, gold: 3, icon: 4 };

export function Stars({ tier }: { tier: Tier }) {
  const { t } = useI18n();
  return (
    <span className="stars" aria-label={t('{tier} tier', { tier: tierLabel(t, tier) })}>
      {[0, 1, 2, 3].map((i) => (
        <svg key={i} viewBox="0 0 20 20" width="12" height="12" className={cx('stars__s', i < STARS[tier] && 'is-on')} aria-hidden="true">
          <path d="M10 1.8l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L1.4 8.1l6-.8z" />
        </svg>
      ))}
    </span>
  );
}

interface Props {
  id: string;
  mode: RatingsMode;
  size?: 'md' | 'sm' | 'xs';
  selected?: boolean;
  dim?: boolean;
  pending?: boolean;
  disabled?: boolean;
  /** play the flip-in animation */
  reveal?: boolean;
  index?: number;
  onClick?: () => void;
  onDoubleClick?: () => void;
  hotkey?: string;
}

export function PlayerCard({ id, mode, size = 'md', selected, dim, pending, disabled, reveal, index = 0, onClick, onDoubleClick, hotkey }: Props) {
  const { t } = useI18n();
  const p = player(id);
  const tier = tierOf(p.ovr, useBands());
  const ovr = Math.round(p.ovr); // sourced ratings carry a decimal; a card shows a whole number
  const tierClass = mode === 'hidden' ? 'mystery' : tier;
  const n = nation(p.nat);
  const sn = shortName(p.name);
  const vars = { name: p.name, pos: p.pos, nation: t(n.name), rating: ovr, tier: tierLabel(t, tier) };
  const label = mode === 'full' ? t('{name}, {pos}, {nation}, rating {rating}', vars) : mode === 'tier' ? t('{name}, {pos}, {nation}, {tier} tier', vars) : t('{name}, {pos}, {nation}', vars);
  const style = { '--i': index, '--hue': faceHue(id) } as CSSProperties;
  return (
    <button
      type="button"
      className={cx('pcard', `pcard--${tierClass}`, `pcard--${size}`, selected && 'is-selected', dim && 'is-dim', pending && 'is-pending', reveal && 'pcard--reveal')}
      style={style}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      disabled={disabled}
      aria-pressed={selected}
      data-tier={tier}
    >
      <span className="sr-only">{label}</span>
      <span className="pcard__cq" aria-hidden="true">
        <span className="pcard__body">
        <span className="pcard__shine" aria-hidden="true" />
        <span className="pcard__top">
          {mode === 'full' ? <b className="pcard__rating">{ovr}</b> : mode === 'tier' ? <Stars tier={tier} /> : <span />}
          <span className="pcard__pos">{p.pos}</span>
        </span>
        <span className="pcard__face" aria-hidden="true">
          <span className="pcard__init">{initials(p.name)}</span>
        </span>
        <span className="pcard__name">{sn}</span>
        {size === 'md' && sn !== p.name && <span className="pcard__full">{p.name}</span>}
        <span className="pcard__foot">
          <NationChip code={p.nat} compact={size !== 'md'} />
          {mode !== 'hidden' && size === 'md' && <span className="pcard__tier">{tierLabel(t, tier)}</span>}
        </span>
        </span>
      </span>
      {hotkey && <kbd className="pcard__key" aria-hidden="true">{hotkey}</kbd>}
    </button>
  );
}
