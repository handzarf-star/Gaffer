import { useEffect, useRef } from 'react';
import { useTicker } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { sfx } from '../lib/sfx';
import { cx } from './ui';

/** Countdown ring driven by the SERVER's deadline (corrected for clock offset), so both players see the same time. */
export function Timer({ deadline, offset, totalMs, size = 52, label, tick = false }: {
  deadline: number | null;
  offset: number;
  totalMs: number;
  size?: number;
  label?: string;
  tick?: boolean;
}) {
  const { t, tn } = useI18n();
  const now = useTicker(200, deadline !== null);
  const lastWhole = useRef(-1);
  const remaining = deadline === null ? null : Math.max(0, deadline - (now + offset));
  const secs = remaining === null ? null : Math.ceil(remaining / 1000);

  useEffect(() => {
    if (!tick || secs === null) return;
    if (secs <= 5 && secs > 0 && secs !== lastWhole.current) sfx.tick();
    lastWhole.current = secs;
  }, [secs, tick]);

  if (remaining === null) {
    return (
      <span className="timer timer--off" style={{ width: size, height: size }} title={t('No timer')} aria-label={t('No time limit')}>
        ∞
      </span>
    );
  }
  const r = 20;
  const c = 2 * Math.PI * r;
  const pct = totalMs > 0 ? Math.min(1, remaining / totalMs) : 0;
  const urgent = secs !== null && secs <= 5;
  return (
    <span className={cx('timer', urgent && 'is-urgent')} style={{ width: size, height: size }} role="timer" aria-label={label ?? tn('{n} seconds left', '{n} seconds left', secs ?? 0)}>
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle className="timer__bg" cx="24" cy="24" r={r} />
        <circle className="timer__fg" cx="24" cy="24" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
      </svg>
      <span className="timer__n">{secs}</span>
    </span>
  );
}
