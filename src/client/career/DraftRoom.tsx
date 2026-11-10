import { useMemo, useState } from 'react';
import { MAX_LINE, MIN_LINE, ROSTER, legalAfter } from '../../shared/career/engine';
import { lineOf, type Line } from '../../shared/career/world';
import { Button, Seg } from '../components/ui';
import { useI18n } from '../lib/i18n';
import type { LeagueCtx } from './ctx';
import { ClubTag, PlayerRow, Section, W, WhyRating, clubName, ovrNow, useCountdown, useLineLabel } from './parts';

const LINES: Line[] = ['GK', 'DF', 'MF', 'FW'];

export function DraftRoom({ ctx }: { ctx: LeagueCtx }) {
  const { t, tn } = useI18n();
  const lineLabel = useLineLabel();
  const { v } = ctx;
  const d = v.draft!;
  const me = v.me;
  const onClock = d.onClock;
  const myTurn = !!me && onClock === me.clubId;
  const left = useCountdown(d.deadline);
  const [line, setLine] = useState<'ALL' | Line>('ALL');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(60);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const rosterIds = v.mine?.roster ?? [];
  const legalFor = (id: string) => !me || legalAfter(W, [...rosterIds, id]);

  const pool = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return d.available
      .map((id) => W.player(id))
      .filter((p) => (line === 'ALL' || lineOf(p.pos) === line) && (!needle || p.name.toLowerCase().includes(needle)))
      // players the squad rules allow come first, so the one you need is never buried under blocked names late in the draft
      .sort((a, b) => Number(legalFor(b.id)) - Number(legalFor(a.id)) || ovrNow(v, b.id) - ovrNow(v, a.id) || a.name.localeCompare(b.name));
  }, [d.available, line, q, v]); // eslint-disable-line react-hooks/exhaustive-deps

  const roster = v.mine?.roster ?? [];
  const counts = useMemo(() => {
    const c: Record<Line, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };
    for (const id of roster) c[lineOf(W.player(id).pos)]++;
    return c;
  }, [roster]);

  // the squad rules, checked here too so a player who cannot be taken is greyed out instead of failing when tapped
  const legal = legalFor;

  const pick = async (id: string) => {
    setBusy(id); setErr('');
    const e = await ctx.act({ t: 'pick', player: id });
    setBusy(null);
    if (e) setErr(e);
  };
  const clubOnClock = onClock ? clubName(v, onClock) : '';
  const humanOnClock = onClock ? v.clubs[onClock]?.human : null;
  const round = Math.floor(d.i / 16) + 1;

  return (
    <div className="stack">
      <section className={`panel career__section draftbar ${myTurn ? 'is-turn' : ''}`} aria-live="polite">
        <p className="eyebrow">{t('Draft · round {r} of {n} · pick {p}', { r: Math.min(round, ROSTER), n: ROSTER, p: d.i + 1 })}</p>
        {onClock && (
          <h2 className="draftbar__title">
            {myTurn ? t('You are on the clock') : t('On the clock:')} {!myTurn && <ClubTag v={v} id={onClock} />}
          </h2>
        )}
        {humanOnClock && d.deadline && <p className="muted">{myTurn ? t('Pick within {time} or one is made for you.', { time: left }) : t('{club} has {time} left to pick.', { club: clubOnClock, time: left })}</p>}
        <p className="muted small">{t('Every club, human and computer, drafts in the same snake order. Your squad: {n} of {total}.', { n: roster.length, total: ROSTER })}</p>
        <ul className="linecount" aria-label={t('Squad balance')}>
          {LINES.map((l) => (
            <li key={l} className={counts[l] < MIN_LINE[l] ? 'is-short' : counts[l] >= MAX_LINE[l] ? 'is-full' : ''}>
              <b>{counts[l]}</b> {lineLabel(l)} <span className="muted small">{t('need {a}–{b}', { a: MIN_LINE[l], b: MAX_LINE[l] })}</span>
            </li>
          ))}
        </ul>
      </section>

      <Section title={t('Available players')} aside={<span className="muted small">{tn('{n} left', '{n} left', pool.length)}</span>}>
        <Seg label={t('Position')} value={line} onChange={(l) => { setLine(l); setLimit(60); }} options={[{ value: 'ALL' as const, label: t('All') }, ...LINES.map((l) => ({ value: l, label: l }))]} />
        <label className="sr-only" htmlFor="psearch">{t('Search players')}</label>
        <input id="psearch" className="input" type="search" placeholder={t('Search by name')} value={q} onChange={(e) => { setQ(e.target.value); setLimit(60); }} />
        {err && <p className="error" role="alert">{err}</p>}
        <ul className="plist">
          {pool.slice(0, limit).map((p) => (
            <li key={p.id}>
              <PlayerRow v={v} id={p.id} note={<>
                <span className="muted small">{W.club(p.club).name}</span>
                {me && !legal(p.id) && <span className="tag tag--warn">{t('Would unbalance your squad')}</span>}
              </>} right={
                me ? <Button size="sm" variant={myTurn ? 'primary' : 'soft'} disabled={!myTurn || !!busy || !legal(p.id)} loading={busy === p.id} onClick={() => pick(p.id)}>{t('Pick')}</Button> : undefined
              }>
                <WhyRating id={p.id} />
              </PlayerRow>
            </li>
          ))}
        </ul>
        {pool.length > limit && <Button variant="ghost" block onClick={() => setLimit(limit + 80)}>{t('Show more')}</Button>}
        {pool.length === 0 && <p className="muted">{t('Nobody matches that.')}</p>}
      </Section>

      {d.picks.length > 0 && (
        <Section title={t('Latest picks')}>
          <ol className="picks" reversed>
            {d.picks.slice(-8).reverse().map(([club, pid], i) => (
              <li key={`${d.picks.length - i}`}><ClubTag v={v} id={club} size={18} mine={club === me?.clubId} /> <b>{W.player(pid).name}</b> <span className="muted small">{W.player(pid).pos} · {Math.round(ovrNow(v, pid))}</span></li>
            ))}
          </ol>
        </Section>
      )}

      {roster.length > 0 && (
        <Section title={t('Your squad so far')}>
          <ul className="plist">{[...roster].sort((a, b) => ovrNow(v, b) - ovrNow(v, a)).map((id) => <li key={id}><PlayerRow v={v} id={id} /></li>)}</ul>
        </Section>
      )}
    </div>
  );
}
