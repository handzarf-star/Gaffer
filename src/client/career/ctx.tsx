import type { CareerView } from '../../shared/career/engine';
import { useI18n } from '../lib/i18n';

export interface LeagueCtx {
  code: string;
  v: CareerView;
  /** send an action; resolves to an error text to show, or null on success */
  act: (msg: Record<string, unknown>) => Promise<string | null>;
}

/** Server error codes to words in the player's language. Unknown codes fall back to a generic line, never a raw code. */
export function useErrorText() {
  const { t } = useI18n();
  return (code: string): string => {
    switch (code) {
      case 'started': return t('The league has already started.');
      case 'joined': return t('You are already in this league.');
      case 'full': return t('A league has room for four managers.');
      case 'name': return t('Enter your name.');
      case 'badge': return t('That badge is not valid.');
      case 'club': return t('That club is not available.');
      case 'taken': return t('That has already been taken.');
      case 'club_name': return t('Use 2 to 24 letters, numbers, spaces or . \' & - and a name nobody has used.');
      case 'phase': return t('That is not possible right now.');
      case 'turn': return t('It is not your pick yet.');
      case 'squad': return t('Your squad needs a balance: at least 2 keepers, 6 defenders, 6 midfielders and 3 forwards.');
      case 'max': return t('That is more changes than the window allows.');
      case 'out': case 'in': case 'dup': return t('That change is not possible. Check the players you picked.');
      case 'owner_only': return t('Only the person who made the league can do that.');
      case 'not_member': return t('Join this league first.');
      case 'rate_limited': return t('Slow down a little.');
      case 'signin': return t('Sign in to play.');
      case 'empty': return t('At least one manager has to join first.');
      case 'size': case 'pool': return t('The league cannot start yet.');
      case 'network': return t('No connection. Try again.');
      default: return t('Something went wrong. Try again.');
    }
  };
}
