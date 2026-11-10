import { useMemo, type CSSProperties } from 'react';
import { prefersReducedMotion } from '../lib/hooks';

const COLORS = ['#ffd54a', '#34d68c', '#5b7bff', '#ff6b57', '#ff8ad8', '#7ae7ff'];

/** A short burst of CSS confetti. Re-keyed by `burst` to replay. Renders nothing for reduced-motion users. */
export function Confetti({ burst, count = 36 }: { burst: number | string; count?: number }) {
  const pieces = useMemo(() => {
    let seed = typeof burst === 'number' ? burst + 7 : burst.length * 13 + 5;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    return Array.from({ length: count }, (_, i) => ({
      x: rnd() * 100,
      dx: (rnd() - 0.5) * 60,
      delay: rnd() * 0.25,
      dur: 1.4 + rnd() * 1.1,
      rot: rnd() * 720 - 360,
      color: COLORS[i % COLORS.length]!,
      w: 6 + rnd() * 6,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burst, count]);
  if (!burst || prefersReducedMotion()) return null;
  return (
    <div className="confetti" aria-hidden="true" key={String(burst)}>
      {pieces.map((p, i) => (
        <i
          key={i}
          style={{ left: `${p.x}%`, background: p.color, width: p.w, height: p.w * 0.5, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, '--dx': `${p.dx}vw`, '--rot': `${p.rot}deg` } as CSSProperties}
        />
      ))}
    </div>
  );
}
