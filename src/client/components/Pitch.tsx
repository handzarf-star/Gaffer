import type { CSSProperties } from 'react';
import type { TFn } from '../../shared/i18n';
import type { RatingsMode } from '../../shared/draft';
import { FORMATIONS, fitKind, penalty, type FitKind, type FormationId, type Role } from '../../shared/formations';
import { player, shortName, tierOf } from '../../shared/players';
import { useI18n } from '../lib/i18n';
import { useBands } from '../lib/tier';
import { initials, faceHue, tierLabel } from './PlayerCard';
import { cx } from './ui';

function roleName(t: TFn, role: Role): string {
  switch (role) {
    case 'GK': return t('Goalkeeper');
    case 'LB': return t('Left back');
    case 'CB': return t('Centre back');
    case 'RB': return t('Right back');
    case 'LWB': return t('Left wing-back');
    case 'RWB': return t('Right wing-back');
    case 'CDM': return t('Defensive midfield');
    case 'CM': return t('Central midfield');
    case 'CAM': return t('Attacking midfield');
    case 'LM': return t('Left midfield');
    case 'RM': return t('Right midfield');
    case 'LW': return t('Left wing');
    case 'RW': return t('Right wing');
    default: return t('Striker');
  }
}

const FIT_ICON: Record<FitKind, string> = { natural: '✓', close: '≈', stretch: '!', poor: '✕' };
function fitWord(t: TFn, kind: FitKind): string {
  switch (kind) {
    case 'natural': return t('natural fit');
    case 'close': return t('close fit');
    case 'stretch': return t('a stretch');
    default: return t('out of position');
  }
}

export interface PitchProps {
  formation: FormationId;
  slots: Record<string, string | null>;
  /** same-nation links to draw, as slot id pairs */
  links?: Array<[string, string]>;
  /** while a card is held: how well it fits each open slot */
  holding?: string | null;
  suggested?: string | null;
  selected?: string | null;
  onSlot?: (slotId: string) => void;
  ratings?: RatingsMode;
  compact?: boolean;
  /** slots that just received a player (for the pop animation) */
  fresh?: string | null;
  linkCount?: Record<string, number>;
  label?: string;
}

export function Pitch({ formation, slots, links = [], holding, suggested, selected, onSlot, ratings = 'tier', compact, fresh, linkCount, label }: PitchProps) {
  const { t, tn } = useI18n();
  const bands = useBands();
  const f = FORMATIONS[formation];
  const pos = new Map(f.slots.map((s) => [s.id, s]));
  const heldPos = holding ? player(holding).pos : null;
  return (
    <div className={cx('pitch', compact && 'pitch--compact')} role="group" aria-label={label ?? t('Pitch, {formation}', { formation: f.name })}>
      <svg className="pitch__lines" viewBox="0 0 68 100" preserveAspectRatio="none" aria-hidden="true">
        <rect x="2" y="2" width="64" height="96" rx="1.2" />
        <path d="M2 50h64" />
        <circle cx="34" cy="50" r="8.6" />
        <circle cx="34" cy="50" r=".6" className="dot" />
        <rect x="14" y="2" width="40" height="15.5" />
        <rect x="24" y="2" width="20" height="5.5" />
        <path d="M27.5 17.5a8.2 8.2 0 0 0 13 0" />
        <rect x="14" y="82.5" width="40" height="15.5" />
        <rect x="24" y="92.5" width="20" height="5.5" />
        <path d="M27.5 82.5a8.2 8.2 0 0 1 13 0" />
      </svg>
      <svg className="pitch__links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {links.map(([a, b]) => {
          const sa = pos.get(a);
          const sb = pos.get(b);
          if (!sa || !sb) return null;
          return <line key={a + b} x1={sa.x} y1={sa.y} x2={sb.x} y2={sb.y} vectorEffect="non-scaling-stroke" />;
        })}
      </svg>
      {f.slots.map((s) => {
        const pid = slots[s.id] ?? null;
        const p = pid ? player(pid) : null;
        const empty = !p;
        const kind: FitKind | null = empty && heldPos ? fitKind(heldPos, s.role) : null;
        const pen = empty && heldPos ? penalty(heldPos, s.role) : 0;
        const tier = p ? tierOf(p.ovr, bands) : null;
        const chem = pid ? (linkCount?.[s.id] ?? 0) : 0;
        const interactive = !!onSlot && (empty ? !!holding : true);
        const role = roleName(t, s.role);
        const fit = kind ? fitWord(t, kind) : '';
        const aria = p
          ? ratings === 'full'
            ? t('{role}: {name}, rating {rating}', { role, name: p.name, rating: Math.round(p.ovr) })
            : ratings === 'tier'
              ? t('{role}: {name}, {tier}', { role, name: p.name, tier: tierLabel(t, tier!) })
              : t('{role}: {name}', { role, name: p.name })
          : kind
            ? pen
              ? t('{role}, empty. Placing here is {fit}, minus {pen} rating', { role, fit, pen })
              : t('{role}, empty. Placing here is {fit}', { role, fit })
            : t('{role}, empty', { role });
        return (
          <button
            key={s.id}
            type="button"
            className={cx(
              'slot',
              empty ? 'slot--empty' : 'slot--filled',
              kind && `slot--${kind}`,
              suggested === s.id && 'is-suggested',
              selected === s.id && 'is-selected',
              fresh === s.id && 'is-fresh',
              !interactive && 'is-static',
            )}
            style={{ left: `${s.x}%`, top: `${s.y}%`, '--hue': pid ? faceHue(pid) : 0 } as CSSProperties}
            onClick={() => onSlot?.(s.id)}
            disabled={!onSlot}
            title={kind ? `${t('{role}: {fit}', { role, fit })}${pen ? ` (-${pen})` : ''}` : p ? p.name : role}
          >
            <span className="sr-only">{aria}</span>
            <span className={cx('slot__disc', tier && `tier-${ratings === 'hidden' ? 'mystery' : tier}`)} aria-hidden="true">
              {p ? <span className="slot__init">{initials(p.name)}</span> : <span className="slot__role">{s.role}</span>}
              {p && ratings === 'full' && <span className="slot__ovr">{Math.round(p.ovr)}</span>}
              {chem > 0 && <span className="slot__chem" title={tn('{n} nation link', '{n} nation links', chem)}>{'•'.repeat(Math.min(chem, 3))}</span>}
              {kind && <span className={cx('slot__fit', `slot__fit--${kind}`)} aria-hidden="true">{FIT_ICON[kind]}</span>}
            </span>
            {p && (
              <span className="slot__name" aria-hidden="true">{shortName(p.name)}</span>
            )}
            {!p && kind && pen > 0 && !compact && <span className="slot__pen" aria-hidden="true">-{pen}</span>}
            {p && <span className="slot__pos" aria-hidden="true">{s.role}</span>}
          </button>
        );
      })}
    </div>
  );
}
