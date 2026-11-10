import type { MatchEvent, MatchResult } from '../sim';
import { interpolate, pluralIndex, type Lang, type Vars } from './index';
import { COMMENTARY_BS, FIXED_BS } from './commentary.bs';
import { HEADLINE_BS, REASON_BS } from './result.bs';

/** The commentary line for an event in the reader's language. Falls back to the English text the engine wrote. */
export function commentary(e: Pick<MatchEvent, 'text' | 'tk' | 'tv'>, lang: Lang): string {
  if (lang !== 'bs' || !e.tk) return e.text;
  const [group, idx] = e.tk.split(':') as [string, string | undefined];
  const tpl = idx === undefined ? FIXED_BS[group] : COMMENTARY_BS[group]?.[Number(idx)];
  if (!tpl) return e.text;
  return interpolate(tpl, e.tv ?? {});
}

/** a template filled in, or the English text if it is missing or a variable did not arrive (never a stray {placeholder} on screen) */
function render(tpl: string | undefined, vars: Vars | undefined, english: string): string {
  if (!tpl) return english;
  const out = interpolate(tpl, vars ?? {});
  return /\{\w+\}/.test(out) ? english : out;
}

/** The one-line headline of a match in the reader's language. Falls back to the English headline the engine wrote. */
export function headlineText(r: Pick<MatchResult, 'headline' | 'hk' | 'hv'>, lang: Lang): string {
  if (lang !== 'bs' || !r.hk) return r.headline;
  const [group, idx] = r.hk.split(':') as [string, string | undefined];
  return render(HEADLINE_BS[group!]?.[Number(idx)], r.hv, r.headline);
}

/** Why the man of the match was picked, in the reader's language. Falls back to the English reason the engine wrote. */
export function motmReasonText(r: { motm: Pick<MatchResult['motm'], 'reason' | 'rk' | 'rv'> }, lang: Lang): string {
  const { reason, rk, rv } = r.motm;
  if (lang !== 'bs' || !rk) return reason;
  const tpl = REASON_BS[rk];
  return render(typeof tpl === 'string' ? tpl : tpl?.[pluralIndex(lang, Number(rv?.n))], rv, reason);
}
