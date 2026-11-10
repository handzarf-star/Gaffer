import { useMemo, useState } from 'react';
import { ROSTER, SETTLE, SHARP, legalAfter, type Swap } from '../../shared/career/engine';
import { lineOf, type Line } from '../../shared/career/world';
import { Button, Seg } from '../components/ui';
import { useI18n } from '../lib/i18n';
import type { LeagueCtx } from './ctx';
import { ClubTag, PlayerRow, Section, W, WhyRating, clubName, ovrNow, useCountdown } from './parts';

const LINES: Line[] = ['GK', 'DF', 'MF', 'FW'];

export function Window({ ctx }: { ctx: LeagueCtx }) {
  const { t, tn } = useI18n();
  const { v } = ctx;
  const win = v.window!;
  const me = v.me;
  const mine = v.mine;
  const left = useCountdown(win.deadline);
  const [plan, setPlan] = useState<Swap[]>(win.plan);
  const [out, setOut] = useState<string | null>(null);
  const [line, setLine] = useState<'ALL' | Line>('ALL');
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(true);
  const end = win.kind === 'end';
  const last = v.history[v.history.length - 1];

  const extra = Math.max(0, plan.length - win.free);
  const sharpHit = Math.min(SHARP.cap, SHARP.perExtraSwap * extra);
  const outs = new Set(plan.map((s) => s.out));
  const ins = new Set(plan.map((s) => s.in));
  const after = useMemo(() => [...(mine?.roster ?? []).filter((id) => !outs.has(id)), ...plan.map((s) => s.in)], [mine, plan]); // eslint-disable-line react-hooks/exhaustive-deps
  const balanced = after.length === ROSTER && legalAfter(W, after);

  const pool = useMemo(() => win.pool.filter((id) => !ins.has(id) && (line === 'ALL' || lineOf(W.player(id).pos) === line)).sort((a, b) => ovrNow(v, b) - ovrNow(v, a)).slice(0, 80), [win.pool, line, ins, v]);

  const choose = (id: string) => {
    if (!out || plan.length >= win.max) return;
    setPlan([...plan, { out, in: id }]); setOut(null); setSaved(false);
  };
  const remove = (i: number) => { setPlan(plan.filter((_, j) => j !== i)); setSaved(false); };
  const save = async () => { const e = await ctx.act({ t: 'plan', swaps: plan }); setErr(e ?? ''); if (!e) setSaved(true); return !e; };
  const ready = async () => {
    if (!saved && !(await save())) return;
    setErr((await ctx.act({ t: 'windowReady', ready: !win.ready })) ?? '');
  };

  return (
    <div className="stack">
      {end && last && (
        <section className="panel career__section seasonend">
          <p className="eyebrow">{t('Season {n} is over', { n: last.season })}</p>
          <h2 className="panel__title">{t('{club} are First League champions', { club: clubName(v, last.champion['1']) })}</h2>
          <p>{t('Second League champions: {club}.', { club: clubName(v, last.champion['2']) })}</p>
          <p>{t('Promoted: {a}. Relegated: {b}.', { a: last.promoted.map((id) => clubName(v, id)).join(', '), b: last.relegated.map((id) => clubName(v, id)).join(', ') })}</p>
          {me && last.humans[me.clubId] && <p><b>{t('You finished {pos} in the {league}.', { pos: last.humans[me.clubId]!.pos, league: last.humans[me.clubId]!.league === 1 ? t('First League') : t('Second League') })}</b></p>}
          {last.topScorer && W.has(last.topScorer.player) && <p className="muted">{t('Top scorer: {p} with {n}.', { p: W.player(last.topScorer.player).name, n: last.topScorer.goals })}</p>}
          <p className="muted small">{t('Everyone is a year older. Young players improve, older ones decline. Check your squad.')}</p>
        </section>
      )}

      <section className="panel career__section">
        <p className="eyebrow">{end ? t('End-of-season window') : t('Mid-season transfer window')}</p>
        <h2 className="panel__title">{t('Change your squad')}</h2>
        <p className="muted">{t('The window closes when everyone is ready, or in {time}. Free agents are the players no club owns. If two managers want the same player, the club lower in the table gets him.', { time: left })}</p>
        <div className="rulebox" role="note">
          <b>{tn('{n} change is free.', '{n} changes are free.', win.free)}</b>{' '}
          {t('Each extra change (up to {max} in all) has a cost, but never in points: your new signings need up to {m} matches to settle in (they play {a} rating points below their level at first), and the whole team loses up to {cap} rating points of sharpness, fading over {k} matches.', { max: win.max, m: SETTLE.heavy.matches, a: SETTLE.heavy.hit, cap: SHARP.cap, k: SHARP.matches })}
        </div>
      </section>

      {me && mine ? (
        <>
          <Section title={t('Your changes')} aside={<span className="muted small">{t('{n} of {max}', { n: plan.length, max: win.max })}</span>}>
            {plan.length === 0 && <p className="muted">{t('No changes yet. Tap a player to release, then choose his replacement below.')}</p>}
            <ul className="swaps">
              {plan.map((s, i) => (
                <li key={s.in} className={i >= win.free ? 'is-costly' : ''}>
                  <span>{t('Out:')} <b>{W.player(s.out).name}</b> <span className="muted small">{W.player(s.out).pos} · {Math.round(ovrNow(v, s.out))}</span></span>
                  <span>{t('In:')} <b>{W.player(s.in).name}</b> <span className="muted small">{W.player(s.in).pos} · {Math.round(ovrNow(v, s.in))}</span></span>
                  {i >= win.free && <span className="tag tag--warn">{t('slow to settle')}</span>}
                  <Button size="sm" variant="ghost" onClick={() => remove(i)} aria-label={t('Undo this change')}>✕</Button>
                </li>
              ))}
            </ul>
            {extra > 0 && <p className="tag tag--warn" role="status">{tn('{n} change over the free allowance: the team loses {hit} rating points of sharpness at first.', '{n} changes over the free allowance: the team loses {hit} rating points of sharpness at first.', extra, { hit: Math.round(sharpHit * 10) / 10 })}</p>}
            {!balanced && plan.length > 0 && <p className="error" role="alert">{t('Your squad needs a balance: at least 2 keepers, 6 defenders, 6 midfielders and 3 forwards.')}</p>}
            {err && <p className="error" role="alert">{err}</p>}
            <div className="row">
              <Button variant={win.ready ? 'soft' : 'primary'} size="lg" disabled={!balanced} onClick={ready}>{win.ready ? t('Not ready yet') : plan.length === 0 ? t('Keep my squad and continue') : t('Confirm changes and continue')}</Button>
            </div>
            <ul className="readyrow" aria-label={t('Managers')}>
              {v.members.map((m) => <li key={m.id} className={win.others[m.id] ? 'is-ready' : ''}>{win.others[m.id] ? '✔' : '…'} {m.name}</li>)}
            </ul>
          </Section>

          <Section title={t('Release a player')}>
            <ul className="plist">
              {[...mine.roster].filter((id) => !outs.has(id)).sort((a, b) => ovrNow(v, a) - ovrNow(v, b)).map((id) => (
                <li key={id}><PlayerRow v={v} id={id} selected={out === id} onClick={() => { const next = out === id ? null : id; setOut(next); if (next) setLine(lineOf(W.player(next).pos)); }} /></li>
              ))}
            </ul>
          </Section>

          <Section title={out ? t('Choose his replacement') : t('Free agents')} aside={<span className="muted small">{tn('{n} available', '{n} available', win.pool.length)}</span>}>
            <Seg label={t('Position')} value={line} onChange={setLine} options={[{ value: 'ALL' as const, label: t('All') }, ...LINES.map((l) => ({ value: l, label: l }))]} />
            <ul className="plist">
              {pool.map((id) => (
                <li key={id}>
                  <PlayerRow v={v} id={id} note={<span className="muted small">{W.player(id).club in v.clubs ? <ClubTag v={v} id={W.player(id).club} size={14} /> : W.club(W.player(id).club).name}</span>}
                    right={<Button size="sm" variant="soft" disabled={!out || plan.length >= win.max} onClick={() => choose(id)}>{t('Sign')}</Button>}>
                    <WhyRating id={id} />
                  </PlayerRow>
                </li>
              ))}
            </ul>
          </Section>
        </>
      ) : (
        <p className="panel muted">{t('You are watching this league. Managers are making their changes.')}</p>
      )}
    </div>
  );
}
