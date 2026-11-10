import { useEffect, useMemo, useState } from 'react';
import type { CareerView } from '../../shared/career/engine';
import { hashSeed } from '../../shared/rng';
import { MatchPlayer, type MatchFixture } from '../screens/MatchPlayer';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { clubName } from './parts';
import type { MatchResult } from '../../shared/sim';
import type { Squad } from '../../shared/squad';

interface Loaded { a: string; b: string; result: MatchResult; squads: [Squad, Squad] }

/** Replays the manager's own last match on the live pitch, from the stored result and the line-ups that played. */
export function Watch({ code, v, onClose }: { code: string; v: CareerView; onClose: () => void }) {
  const { t } = useI18n();
  const [m, setM] = useState<Loaded | null | 'none'>(null);
  useEffect(() => {
    void api.match(code).then((r) => {
      if (r.ok && r.data.result && r.data.squads && r.data.a && r.data.b) setM({ a: r.data.a, b: r.data.b, result: r.data.result, squads: r.data.squads });
      else setM('none');
    });
  }, [code]);
  const startAt = useMemo(() => Date.now() + 1200, []);
  if (m === null) return <p className="muted" role="status">{t('Loading…')}</p>;
  if (m === 'none') return <div className="panel"><p>{t('There is no match to watch yet.')}</p><button className="btn btn--ghost" onClick={onClose}>{t('Back')}</button></div>;
  const side = (id: string, i: 0 | 1): MatchFixture['a'] => ({ name: clubName(v, id), hue: hashSeed(id) % 360, color: v.clubs[id]?.badge.c1 ?? '#2563eb', squad: m.squads[i] });
  const fx: MatchFixture = { a: side(m.a, 0), b: side(m.b, 1), result: m.result, label: t('Matchday {n}', { n: v.day }) };
  const me = v.me?.clubId;
  return <MatchPlayer fixtures={[fx]} startAt={startAt} you={() => (me === m.a ? 0 : me === m.b ? 1 : null)} onSeen={() => {}} continueLabel={t('Back to the league')} onContinue={onClose} />;
}
