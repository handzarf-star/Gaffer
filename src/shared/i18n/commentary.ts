import type { MatchEvent } from '../sim';
import { interpolate, type Lang } from './index';
import { COMMENTARY_BS, FIXED_BS } from './commentary.bs';

/** The commentary line for an event in the reader's language. Falls back to the English text the engine wrote. */
export function commentary(e: Pick<MatchEvent, 'text' | 'tk' | 'tv'>, lang: Lang): string {
  if (lang !== 'bs' || !e.tk) return e.text;
  const [group, idx] = e.tk.split(':') as [string, string | undefined];
  const tpl = idx === undefined ? FIXED_BS[group] : COMMENTARY_BS[group]?.[Number(idx)];
  if (!tpl) return e.text;
  return interpolate(tpl, e.tv ?? {});
}
