import { useMemo, useState } from 'react';
import { BADGE_COLORS, BADGE_MARKS, BADGE_SHAPES, defaultBadge, type Badge as BadgeT } from '../../shared/career/world';
import { Button, Seg, cx, shareOrCopy } from '../components/ui';
import { useI18n } from '../lib/i18n';
import { Badge } from './Badge';
import type { LeagueCtx } from './ctx';
import { ClubTag, Section, W } from './parts';

function BadgeEditor({ value, onChange, initial }: { value: BadgeT; onChange: (b: BadgeT) => void; initial: string }) {
  const { t } = useI18n();
  const swatch = (key: 'c1' | 'c2', label: string) => (
    <div className="swatches" role="group" aria-label={label}>
      <span className="swatches__label">{label}</span>
      {BADGE_COLORS.map((c) => (
        <button key={c} type="button" className={cx('swatch', value[key] === c && 'is-on')} style={{ background: c }} aria-label={c} aria-pressed={value[key] === c} onClick={() => onChange({ ...value, [key]: c })} />
      ))}
    </div>
  );
  return (
    <div className="badgeedit">
      <Badge badge={value} initial={initial} size={72} title={t('Your badge')} />
      <div className="badgeedit__controls">
        <Seg label={t('Shape')} value={value.shape} onChange={(shape) => onChange({ ...value, shape })} options={BADGE_SHAPES.map((s) => ({ value: s, label: s === 'shield' ? t('Shield') : s === 'round' ? t('Round') : s === 'pennant' ? t('Pennant') : t('Diamond') }))} />
        <Seg label={t('Mark')} value={value.mark} onChange={(mark) => onChange({ ...value, mark })} options={BADGE_MARKS.map((m) => ({ value: m, label: m === 'initial' ? t('Letter') : m === 'stripes' ? t('Stripes') : m === 'star' ? t('Star') : t('Bar') }))} />
        {swatch('c1', t('Main colour'))}
        {swatch('c2', t('Second colour'))}
      </div>
    </div>
  );
}

function JoinForm({ ctx, defaultName }: { ctx: LeagueCtx; defaultName: string }) {
  const { t } = useI18n();
  const { v } = ctx;
  const [name, setName] = useState(defaultName);
  const [pick, setPick] = useState<string>('');
  const [custom, setCustom] = useState('');
  const [badge, setBadge] = useState<BadgeT | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const clubs = v.leagues['1'].clubs.map((id) => v.clubs[id]!).filter((c) => c.real);
  const isCustom = pick === '@custom';
  const shown = useMemo(() => {
    if (badge) return badge;
    if (isCustom) return defaultBadge(custom || 'New club');
    const w = W.clubs.find((c) => c.id === pick);
    return defaultBadge(w?.name ?? 'Club', w?.colors);
  }, [badge, isCustom, custom, pick]);

  const submit = async () => {
    setErr('');
    if (!pick) return setErr(t('Choose a club first.'));
    setBusy(true);
    const e = await ctx.act({ t: 'join', name: name.trim() || 'Manager', choice: isCustom ? { kind: 'custom', name: custom } : { kind: 'real', id: pick }, ...(badge ? { badge } : {}) });
    setBusy(false);
    if (e) setErr(e);
  };

  return (
    <Section title={t('Choose your club')}>
      <label htmlFor="mname">{t('Your name')}</label>
      <input id="mname" className="input" maxLength={20} value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" />
      <fieldset className="clubgrid">
        <legend className="sr-only">{t('Clubs')}</legend>
        {clubs.map((c) => {
          const taken = !!c.human;
          const who = taken ? v.members.find((m) => m.id === c.human)?.name : '';
          return (
            <label key={c.id} className={cx('clubpick', pick === c.id && 'is-on', taken && 'is-taken')}>
              <input type="radio" name="club" value={c.id} disabled={taken} checked={pick === c.id} onChange={() => { setPick(c.id); setBadge(null); }} />
              <Badge badge={c.badge} initial={c.name} size={36} />
              <span className="clubpick__name">{c.name}</span>
              {taken && <span className="muted small">{t('{who}\'s club', { who: who ?? '' })}</span>}
            </label>
          );
        })}
        <label className={cx('clubpick clubpick--custom', isCustom && 'is-on')}>
          <input type="radio" name="club" value="@custom" checked={isCustom} onChange={() => { setPick('@custom'); setBadge(null); }} />
          <span className="clubpick__plus" aria-hidden="true">＋</span>
          <span className="clubpick__name">{t('Invent a club')}</span>
          <span className="muted small">{t('It takes the place of the weakest club nobody has chosen.')}</span>
        </label>
      </fieldset>
      {isCustom && (
        <div className="stack">
          <label htmlFor="cname">{t('Club name')}</label>
          <input id="cname" className="input" maxLength={24} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={t('e.g. Sunday Rovers')} />
        </div>
      )}
      {pick && <BadgeEditor value={shown} onChange={setBadge} initial={isCustom ? custom || 'N' : W.clubs.find((c) => c.id === pick)?.name ?? 'C'} />}
      <p className="muted small">{t('Badges are drawn from a shape, two colours and a mark. They are never a real club crest.')}</p>
      {err && <p className="error" role="alert">{err}</p>}
      <Button variant="primary" size="lg" block loading={busy} disabled={!pick} onClick={submit}>{t('Join this league')}</Button>
    </Section>
  );
}

export function Lobby({ ctx, defaultName }: { ctx: LeagueCtx; defaultName: string }) {
  const { t, tn } = useI18n();
  const { v } = ctx;
  const me = v.me;
  const owner = v.members[0]?.id === me?.memberId;
  const [err, setErr] = useState('');
  const s = v.settings;
  const set = async (patch: Record<string, unknown>) => { const e = await ctx.act({ t: 'settings', patch }); setErr(e ?? ''); };
  const start = async () => { setErr((await ctx.act({ t: 'start' })) ?? ''); };
  const link = `${location.origin}/c/${ctx.code}`;

  return (
    <div className="stack">
      <Section title={t('League {code}', { code: ctx.code })} aside={<Button variant="soft" size="sm" icon="share" onClick={() => shareOrCopy({ title: t('Join my league'), text: t('Join my career league {code}', { code: ctx.code }), url: link })}>{t('Invite')}</Button>}>
        <p className="muted">{t('Share the code {code} with up to three friends. Everyone picks a club, then the owner starts the draft.', { code: ctx.code })}</p>
        <ul className="members">
          {v.members.map((m) => (
            <li key={m.id}><ClubTag v={v} id={m.clubId} /><span className="muted small">{m.name}{m.id === v.members[0]?.id ? ` · ${t('owner')}` : ''}</span></li>
          ))}
          {v.members.length === 0 && <li className="muted">{t('Nobody has joined yet.')}</li>}
        </ul>
        <p className="muted small">{tn('{n} manager so far. The rest of the clubs are run by the computer.', '{n} managers so far. The rest of the clubs are run by the computer.', v.members.length)}</p>
      </Section>

      {!me && v.members.length < 4 && <JoinForm ctx={ctx} defaultName={defaultName} />}
      {!me && v.members.length >= 4 && <p className="panel">{t('This league is full.')}</p>}

      {me && owner && (
        <Section title={t('Pace')}>
          <p className="muted">{t('Playing together? Everyone taps Ready and the matchday plays straight away. Playing apart? A matchday waits for the slowest manager up to the time below, then plays their saved line-up. Nobody has to wait to watch.')}</p>
          <div className="stack">
            <span id="p1">{t('A matchday waits up to')}</span>
            <Seg label={t('Matchday deadline')} value={s.dayHours} onChange={(dayHours) => set({ dayHours })} options={[4, 12, 24, 48].map((h) => ({ value: h, label: t('{n} h', { n: h }) }))} />
            <span>{t('Each draft pick waits up to')}</span>
            <Seg label={t('Pick clock')} value={s.pickHours} onChange={(pickHours) => set({ pickHours })} options={[1, 4, 12].map((h) => ({ value: h, label: t('{n} h', { n: h }) }))} />
            <span>{t('The transfer window stays open up to')}</span>
            <Seg label={t('Window length')} value={s.windowHours} onChange={(windowHours) => set({ windowHours })} options={[12, 24, 48].map((h) => ({ value: h, label: t('{n} h', { n: h }) }))} />
            <span>{t('Computer clubs')}</span>
            <Seg label={t('Computer difficulty')} value={s.bot} onChange={(bot) => set({ bot })} options={[{ value: 'easy', label: t('Easy') }, { value: 'normal', label: t('Normal') }, { value: 'hard', label: t('Hard') }]} />
          </div>
          {err && <p className="error" role="alert">{err}</p>}
          <Button variant="primary" size="lg" block onClick={start}>{t('Start the draft')}</Button>
        </Section>
      )}
      {me && !owner && <p className="panel muted" role="status">{t('Waiting for the owner to start the draft.')}</p>}
    </div>
  );
}
