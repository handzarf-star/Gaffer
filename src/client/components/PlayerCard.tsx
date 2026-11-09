import type { CSSProperties } from 'react';
import type { RatingsMode } from '../../shared/draft';
import { nation, nationGradient } from '../../shared/nations';
import { TIER_LABEL, player, shortName, tierOf, type Tier } from '../../shared/players';
import { hashSeed } from '../../shared/rng';
import { cx } from './ui';

export function initials(name: string): string {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function faceHue(id: string): number {
  return hashSeed(id) % 360;
}

export function NationChip({ code, compact }: { code: string; compact?: boolean }) {
  const n = nation(code);
  return (
    <span className={cx('nation', compact && 'nation--compact')} title={n.name}>
      <span className="nation__band" style={{ background: nationGradient(code) }} />
      <span className="nation__code">{code}</span>
    </span>
  );
}

const STARS: Record<Tier, number> = { bronze: 1, silver: 2, gold: 3, icon: 4 };

export function Stars({ tier }: { tier: Tier }) {
  return (
    <span className="stars" aria-label={`${TIER_LABEL[tier]} tier`}>
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
  const p = player(id);
  const tier = tierOf(p.ovr);
  const tierClass = mode === 'hidden' ? 'mystery' : tier;
  const n = nation(p.nat);
  const sn = shortName(p.name);
  const label = `${p.name}, ${p.pos}, ${n.name}${mode === 'full' ? `, rating ${p.ovr}` : mode === 'tier' ? `, ${TIER_LABEL[tier]} tier` : ''}`;
  const style = { '--i': index, '--hue': faceHue(id) } as CSSProperties;
  return (
    <button
      type="button"
      className={cx('pcard', `pcard--${tierClass}`, `pcard--${size}`, selected && 'is-selected', dim && 'is-dim', pending && 'is-pending', reveal && 'pcard--reveal')}
      style={style}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={selected}
      data-tier={tier}
    >
      <span className="pcard__cq">
        <span className="pcard__body">
        <span className="pcard__shine" aria-hidden="true" />
        <span className="pcard__top">
          {mode === 'full' ? <b className="pcard__rating">{p.ovr}</b> : mode === 'tier' ? <Stars tier={tier} /> : <span />}
          <span className="pcard__pos">{p.pos}</span>
        </span>
        <span className="pcard__face" aria-hidden="true">
          <span className="pcard__init">{initials(p.name)}</span>
        </span>
        <span className="pcard__name">{sn}</span>
        {size === 'md' && sn !== p.name && <span className="pcard__full">{p.name}</span>}
        <span className="pcard__foot">
          <NationChip code={p.nat} compact={size !== 'md'} />
          {mode !== 'hidden' && size === 'md' && <span className="pcard__tier">{TIER_LABEL[tier]}</span>}
        </span>
        </span>
      </span>
      {hotkey && <kbd className="pcard__key" aria-hidden="true">{hotkey}</kbd>}
    </button>
  );
}
