import { useEffect, useState, useSyncExternalStore, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { BRAND } from '../../shared/brand';
import { SEAT_HUES } from '../../shared/protocol';
import { toast, useTheme, useToasts } from '../lib/hooks';
import { sfx } from '../lib/sfx';

export const cx = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(' ');

/* ───────────── icons (24px, stroke) ───────────── */

const PATHS: Record<string, ReactNode> = {
  sun: (<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  auto: (<><circle cx="12" cy="12" r="9" /><path d="M12 3v18" /><path d="M12 7a5 5 0 0 1 0 10z" fill="currentColor" /></>),
  volume: (<><path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" /></>),
  mute: (<><path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z" /><path d="M16 9.5l5 5M21 9.5l-5 5" /></>),
  copy: (<><rect x="8" y="8" width="12" height="12" rx="3" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>),
  share: (<><path d="M12 3v12M7.5 7.5L12 3l4.5 4.5" /><path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></>),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  users: (<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2A6.5 6.5 0 0 1 21.5 20" /></>),
  trophy: (<><path d="M8 4h8v6a4 4 0 0 1-8 0z" /><path d="M8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4" /><path d="M12 14v4M8.5 20h7" /></>),
  calendar: (<><rect x="3.5" y="5" width="17" height="15" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>),
  bolt: <path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12z" />,
  clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  refresh: (<><path d="M20 11a8 8 0 0 0-14.5-4M4 13a8 8 0 0 0 14.5 4" /><path d="M5.5 3v4h4M18.5 21v-4h-4" /></>),
  link: (<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1" /></>),
  swap: <path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />,
  info: (<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>),
  crown: <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />,
  wifioff: (<><path d="M2 8.8a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16.2a5 5 0 0 1 6 0" /><path d="M3 3l18 18" /></>),
  play: <path d="M7 4.5v15l12-7.5z" />,
  skip: <path d="M5 4.5v15l10-7.5zM18 5v14" />,
  ball: (<><circle cx="12" cy="12" r="9" /><path d="M12 8l3.5 2.5-1.3 4.1H9.8L8.5 10.5z" /><path d="M12 3v5M20.5 9.5l-5 1M17.5 19l-3.3-4.4M6.5 19l3.3-4.4M3.5 9.5l5 1" /></>),
  plus: <path d="M12 5v14M5 12h14" />,
  chev: <path d="M9 6l6 6-6 6" />,
  card: (<><rect x="5" y="3" width="14" height="18" rx="3" /><path d="M9 14h6M9 17h3" /><circle cx="12" cy="9" r="2" /></>),
  cpu: (<><rect x="6" y="6" width="12" height="12" rx="2.5" /><rect x="9.5" y="9.5" width="5" height="5" rx="1" /><path d="M9 2.5v3.5M15 2.5v3.5M9 18v3.5M15 18v3.5M2.5 9h3.5M2.5 15h3.5M18 9h3.5M18 15h3.5" /></>),
  whistle: (<><circle cx="9" cy="14" r="5" /><path d="M13.5 11.5L21 8v3l-6 2" /><circle cx="9" cy="14" r="1.4" /></>),
};

export function Icon({ name, size = 20, className }: { name: keyof typeof PATHS | string; size?: number; className?: string }) {
  return (
    <svg
      className={cx('icon', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

/* ───────────── brand ───────────── */

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="logo">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#15b877" />
          <stop offset="1" stopColor="#075f3d" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#lg)" />
      <g fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" opacity=".95">
        <path d="M10 32h44" />
        <circle cx="32" cy="32" r="10" />
      </g>
      <circle cx="32" cy="32" r="3.6" fill="#ffd54a" />
    </svg>
  );
}

export function Wordmark({ onClick }: { onClick?: () => void }) {
  return (
    <a
      className="brand"
      href="/"
      onClick={(e) => {
        if (onClick) {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={`${BRAND.name} home`}
    >
      <Logo />
      <span className="brand__name">{BRAND.name}</span>
    </a>
  );
}

/* ───────────── primitives ───────────── */

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ink' | 'ghost' | 'danger' | 'soft';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  loading?: boolean;
  icon?: string;
}

export function Button({ variant = 'ink', size = 'md', block, loading, icon, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      type={rest.type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx('btn', `btn--${variant}`, `btn--${size}`, block && 'btn--block', loading && 'is-loading', className)}
    >
      {loading ? <span className="spinner spinner--sm" aria-hidden="true" /> : icon ? <Icon name={icon} size={size === 'lg' ? 22 : 18} /> : null}
      <span>{children}</span>
    </button>
  );
}

export function IconButton({ icon, label, onClick, active }: { icon: string; label: string; onClick?: () => void; active?: boolean }) {
  return (
    <button type="button" className={cx('iconbtn', active && 'is-on')} onClick={onClick} aria-label={label} title={label}>
      <Icon name={icon} />
    </button>
  );
}

export function Spinner({ size = 28 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} role="status" aria-label="Loading" />;
}

export function Avatar({ name, hue, size = 36, connected, color: colorProp }: { name: string; hue: number; size?: number; connected?: boolean; color?: string }) {
  const color = colorProp ?? SEAT_HUES[hue % SEAT_HUES.length]!;
  return (
    <span className="avatar" style={{ width: size, height: size, background: color, fontSize: size * 0.44 }} aria-hidden="true">
      {(name.trim()[0] ?? '?').toUpperCase()}
      {connected !== undefined && <span className={cx('avatar__dot', connected ? 'is-on' : 'is-off')} />}
    </span>
  );
}

export function Seg<T extends string | number>({
  value, options, onChange, label, disabled,
}: {
  value: T;
  options: Array<{ value: T; label: string; hint?: string }>;
  onChange: (v: T) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={disabled}
          className={cx('seg__btn', o.value === value && 'is-on')}
          onClick={() => onChange(o.value)}
          title={o.hint}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toasts() {
  const items = useToasts();
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={cx('toast', `toast--${t.kind}`)} role="status">
          {t.text}
        </div>
      ))}
    </div>
  );
}

/* ───────────── global toggles ───────────── */

export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
  const icon = theme === 'system' ? 'auto' : theme === 'light' ? 'sun' : 'moon';
  return <IconButton icon={icon} label={`Theme: ${theme}. Switch to ${next}`} onClick={() => setTheme(next)} />;
}

export function SoundToggle() {
  const on = useSyncExternalStore(sfx.subscribe, sfx.isOn, sfx.isOn);
  return <IconButton icon={on ? 'volume' : 'mute'} label={on ? 'Mute sounds' : 'Turn sounds on'} onClick={() => sfx.set(!on)} />;
}

export function Banner({ tone = 'warn', icon, children }: { tone?: 'warn' | 'info' | 'bad'; icon?: string; children: ReactNode }) {
  return (
    <div className={cx('banner', `banner--${tone}`)} role="status">
      {icon && <Icon name={icon} size={18} />}
      <span>{children}</span>
    </div>
  );
}

/** Copies text, with a graceful fallback for browsers that block the clipboard API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied', 'good');
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      toast(ok ? 'Copied' : 'Copy failed. Select the text and copy it manually.', ok ? 'good' : 'error');
      return ok;
    } catch {
      toast('Copy failed. Select the text and copy it manually.', 'error');
      return false;
    }
  }
}

export async function shareOrCopy(data: { title: string; text: string; url?: string }): Promise<void> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share(data);
      return;
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return;
    }
  }
  await copyText(data.url ? `${data.text}\n${data.url}` : data.text);
}

/** Delay mounting of heavy children by one frame so the first paint is instant. */
export function useMounted(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}
