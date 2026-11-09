import type { CSSProperties } from 'react';
import type { RatingsMode } from '../../shared/draft';
import { FORMATIONS, fitKind, penalty, type FitKind, type FormationId, type Role } from '../../shared/formations';
import { TIER_LABEL, player, shortName, tierOf } from '../../shared/players';
import { initials, faceHue } from './PlayerCard';
import { cx } from './ui';

const ROLE_NAME: Record<Role, string> = {
  GK: 'Goalkeeper', LB: 'Left back', CB: 'Centre back', RB: 'Right back', LWB: 'Left wing-back', RWB: 'Right wing-back',
  CDM: 'Defensive midfield', CM: 'Central midfield', CAM: 'Attacking midfield', LM: 'Left midfield', RM: 'Right midfield',
  LW: 'Left wing', RW: 'Right wing', ST: 'Striker',
};

const FIT_ICON: Record<FitKind, string> = { natural: '✓', close: '≈', stretch: '!', poor: '✕' };
const FIT_WORD: Record<FitKind, string> = { natural: 'natural fit', close: 'close fit', stretch: 'a stretch', poor: 'out of position' };

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
  const f = FORMATIONS[formation];
  const pos = new Map(f.slots.map((s) => [s.id, s]));
  const heldPos = holding ? player(holding).pos : null;
  return (
    <div className={cx('pitch', compact && 'pitch--compact')} role="group" aria-label={label ?? `Pitch, ${f.name}`}>
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
        const tier = p ? tierOf(p.ovr) : null;
        const chem = pid ? (linkCount?.[s.id] ?? 0) : 0;
        const interactive = !!onSlot && (empty ? !!holding : true);
        const aria = p
          ? `${ROLE_NAME[s.role]}: ${p.name}${ratings === 'full' ? `, rating ${p.ovr}` : ratings === 'tier' ? `, ${TIER_LABEL[tier!]}` : ''}`
          : kind
            ? `${ROLE_NAME[s.role]}, empty. Placing here is ${FIT_WORD[kind]}${pen ? `, minus ${pen} rating` : ''}`
            : `${ROLE_NAME[s.role]}, empty`;
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
            title={kind ? `${ROLE_NAME[s.role]}: ${FIT_WORD[kind]}${pen ? ` (-${pen})` : ''}` : p ? p.name : ROLE_NAME[s.role]}
          >
            <span className="sr-only">{aria}</span>
            <span className={cx('slot__disc', tier && `tier-${ratings === 'hidden' ? 'mystery' : tier}`)} aria-hidden="true">
              {p ? <span className="slot__init">{initials(p.name)}</span> : <span className="slot__role">{s.role}</span>}
              {p && ratings === 'full' && <span className="slot__ovr">{p.ovr}</span>}
              {chem > 0 && <span className="slot__chem" title={`${chem} nation link${chem > 1 ? 's' : ''}`}>{'•'.repeat(Math.min(chem, 3))}</span>}
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
