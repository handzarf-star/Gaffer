import { GLOW_TEXT, SCENT_TEXT, type PackClue, type Scent } from '../../shared/packs';
import type { RatingsMode } from '../../shared/draft';
import { cx } from './ui';

const SCENT_GLYPH: Record<Scent, string> = { goals: '⚽', grit: '🛡', engine: '⚙', gloves: '🧤' };

/**
 * Three sealed packs. Their names, glow, smell and rumour are hints, not promises: the person choosing reads the clues
 * and the squad they still need, and mostly gets lucky or unlucky. Watching your friend choose is half the fun.
 */
export function PackChooser({ packs, canPick, mode, onOpen, who }: {
  packs: PackClue[];
  canPick: boolean;
  mode: RatingsMode;
  onOpen: (index: number) => void;
  who?: string;
}) {
  return (
    <div className="packs" role="group" aria-label={canPick ? 'Choose a pack' : `${who ?? 'Someone'} is choosing a pack`}>
      {packs.map((c, i) => {
        const glow = mode === 'hidden' ? 'mystery' : c.glow;
        const glowText = mode === 'hidden' ? 'No telling' : GLOW_TEXT[c.glow];
        return (
          <button
            key={`${c.name}-${i}`}
            type="button"
            className={cx('pack', `pack--${glow}`)}
            disabled={!canPick}
            onClick={() => onOpen(i)}
            aria-label={`${c.name}. ${glowText}. ${SCENT_TEXT[c.scent]}. ${c.rumour}`}
            data-pack={i}
          >
            <span className="pack__foil" aria-hidden="true" />
            <span className="pack__art" aria-hidden="true">
              <span className="pack__mark">?</span>
            </span>
            <span className="pack__text">
              <b className="pack__name">{c.name}</b>
              <span className="pack__chips">
                <span className="pack__chip"><span aria-hidden="true">✨</span> {glowText}</span>
                <span className="pack__chip"><span aria-hidden="true">{SCENT_GLYPH[c.scent]}</span> {SCENT_TEXT[c.scent]}</span>
              </span>
              <i className="pack__rumour">{c.rumour}</i>
            </span>
          </button>
        );
      })}
    </div>
  );
}
