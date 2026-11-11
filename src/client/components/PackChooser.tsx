import { GLOW_TEXT, SCENT_TEXT, type PackClue, type Scent } from '../../shared/packs';
import type { RatingsMode } from '../../shared/draft';
import { useI18n } from '../lib/i18n';
import { cx } from './ui';

const SCENT_GLYPH: Record<Scent, string> = { goals: '⚽', grit: '🛡', engine: '⚙', gloves: '🧤' };

/**
 * Three sealed packs. Their names, glow, smell and rumour are hints, not promises: the person choosing reads the clues
 * and the squad they still need, and mostly gets lucky or unlucky. Watching your friend choose is half the fun.
 */
export function PackChooser({ packs, canPick, mode, onOpen, who, identical }: {
  packs: PackClue[];
  canPick: boolean;
  mode: RatingsMode;
  onOpen: (index: number) => void;
  who?: string;
  /** spotlight draft: this many packs with nothing to tell them apart (no name, no glow, no clue) */
  identical?: number;
}) {
  const { t } = useI18n();
  const label = canPick ? t('Choose a pack') : who != null ? t('{name} is choosing a pack', { name: who }) : t('Someone is choosing a pack');
  if (identical) {
    return (
      <div className="packs packs--same" role="group" aria-label={label}>
        {Array.from({ length: identical }, (_, i) => (
          <button key={i} type="button" className="pack pack--same" disabled={!canPick} onClick={() => onOpen(i)} data-pack={i}>
            <span className="pack__foil" aria-hidden="true" />
            <span className="pack__art" aria-hidden="true"><span className="pack__mark" data-g="?" /></span>
            {/* identical to the eye; a screen reader still needs to tell them apart */}
            <span className="sr-only">{t('Pack {n} of {total}', { n: i + 1, total: identical })}</span>
            <span className="pack__tap">{canPick ? t('Tap to open') : ''}</span>
          </button>
        ))}
      </div>
    );
  }
  // the clue texts come from the server in English (shared/packs.ts); they are translated here, where they are shown
  return (
    <div className="packs" role="group" aria-label={label}>
      {packs.map((c, i) => {
        const glow = mode === 'hidden' ? 'mystery' : c.glow;
        const glowText = mode === 'hidden' ? t('No telling') : t(GLOW_TEXT[c.glow]);
        return (
          <button
            key={`${c.name}-${i}`}
            type="button"
            className={cx('pack', `pack--${glow}`)}
            disabled={!canPick}
            onClick={() => onOpen(i)}
            data-pack={i}
          >
            <span className="pack__foil" aria-hidden="true" />
            <span className="pack__art" aria-hidden="true">
              <span className="pack__mark" data-g="?" />
            </span>
            <span className="pack__text">
              <b className="pack__name">{t(c.name)}</b>{' '}
              <span className="pack__chips">
                <span className="pack__chip" data-g="✨">{glowText}</span>{' '}
                <span className="pack__chip" data-g={SCENT_GLYPH[c.scent]}>{t(SCENT_TEXT[c.scent])}</span>
              </span>
              <i className="pack__rumour">{t(c.rumour)}</i>
            </span>
          </button>
        );
      })}
    </div>
  );
}
