import { useId } from 'react';
import type { Badge as BadgeT } from '../../shared/career/world';

const SHAPES: Record<BadgeT['shape'], string> = {
  shield: 'M32 4 L58 12 V32 C58 46 47 56 32 62 C17 56 6 46 6 32 V12 Z',
  round: 'M32 4 A28 28 0 1 1 31.99 4 Z',
  pennant: 'M8 6 H56 V34 L32 60 L8 34 Z',
  diamond: 'M32 3 L61 32 L32 61 L3 32 Z',
};

/** A badge drawn from a few simple parts. Never a real crest: just a shape, two colours and a mark. */
export function Badge({ badge, initial, size = 44, title }: { badge: BadgeT; initial: string; size?: number; title?: string }) {
  const id = useId().replace(/:/g, '');
  const ink = luminance(badge.c1) > 0.5 ? '#111111' : '#ffffff';
  const ink2 = luminance(badge.c2) > 0.5 ? '#111111' : '#ffffff';
  return (
    <svg className="badge" width={size} height={size} viewBox="0 0 64 64" role={title ? 'img' : 'presentation'} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs><clipPath id={`c${id}`}><path d={SHAPES[badge.shape]} /></clipPath></defs>
      <path d={SHAPES[badge.shape]} fill={badge.c1} />
      <g clipPath={`url(#c${id})`}>
        {badge.mark === 'stripes' && [0, 1, 2].map((i) => <rect key={i} x={6 + i * 20} y="0" width="10" height="64" fill={badge.c2} />)}
        {badge.mark === 'bar' && <rect x="0" y="26" width="64" height="12" fill={badge.c2} />}
        {badge.mark === 'star' && <path d="M32 14 l5.3 10.8 11.9 1.7 -8.6 8.4 2 11.8 -10.6 -5.6 -10.6 5.6 2 -11.8 -8.6 -8.4 11.9 -1.7 z" fill={badge.c2} />}
        {badge.mark === 'initial' && <text x="32" y="43" textAnchor="middle" fontSize="30" fontWeight="800" fontFamily="var(--font-display)" fill={ink2 === ink ? ink : badge.c2}>{initial.slice(0, 1).toUpperCase()}</text>}
      </g>
      <path d={SHAPES[badge.shape]} fill="none" stroke={ink} strokeOpacity=".55" strokeWidth="2.5" />
    </svg>
  );
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
