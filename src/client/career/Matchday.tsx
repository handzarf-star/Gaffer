import { useEffect, useMemo, useRef, useState } from 'react';
import { DAYS, bestSquad } from '../../shared/career/engine';
import { lineOf, type Line } from '../../shared/career/world';
import { FORMATIONS, FORMATION_IDS, type FormationId } from '../../shared/formations';
import { withRatings } from '../../shared/players';
import { STYLE_IDS, changeFormation, type Squad, type StyleId } from '../../shared/squad';
import { Pitch } from '../components/Pitch';
import { Banner, Button, Seg, cx } from '../components/ui';
import { useI18n } from '../lib/i18n';
import type { LeagueCtx } from './ctx';
import { ClubTag, NewsLine, PlayerRow, Section, Standings, W, WhyRating, clubName, ovrNow, useCountdown, useLineLabel } from './parts';
import { shortName } from '../../shared/players';

type Tab = 'match' | 'squad' | 'table' | 'news';
const isSlot = (s: string) => /^s\d+$/.test(s);
const LINES: Line[] = ['GK', 'DF', 'MF', 'FW'];

function useStyleName() {
  const { t } = useI18n();
  return (id: StyleId): string => {
    switch (id) {
      case 'possession': return t('Possession');
      case 'press': return t('High press');
      case 'wings': return t('Wide attack');
      case 'fortress': return t('Fortress');
      default: return t('Counter');
    }
  };
}

export function Matchday({ ctx, onWatch }: { ctx: LeagueCtx; onWatch: () => void }) {
  const { t, tn } = useI18n();
  const styleName = useStyleName();
  const lineLabel = useLineLabel();
  const { v } = ctx;
  const me = v.me!;
  const mine = v.mine!;
  const myClub = v.clubs[me.clubId]!;
  const league = myClub.league;
  const [tab, setTab] = useState<Tab>('match');
  const [err, setErr] = useState('');
  const left = useCountdown(v.deadline);

  /* the line-up is edited locally and saved at once; a newer view replaces it only when there is nothing unsaved */
  const [lineup, setLineup] = useState<Squad>({ formation: mine.formation, style: mine.style, slots: { ...mine.xi } });
  const dirty = useRef(false);
  useEffect(() => { if (!dirty.current) setLineup({ formation: mine.formation, style: mine.style, slots: { ...mine.xi } }); }, [v.rev, mine.formation, mine.style, mine.xi]);
  const [sel, setSel] = useState<string | null>(null);

  const save = async (next: Squad) => {
    setLineup(next);
    dirty.current = true;
    const e = await ctx.act({ t: 'lineup', formation: next.formation, style: next.style, slots: next.slots });
    dirty.current = false;
    setErr(e ?? '');
  };

  const inXI = new Set(Object.values(lineup.slots).filter((x): x is string => !!x));
  const bench = mine.roster.filter((id) => !inXI.has(id));
  const fit = (id: string) => !v.injuries[id] && !((v.susp[id] ?? 0) > 0);
  const problems = Object.entries(lineup.slots).filter(([, id]) => id && !fit(id)).map(([, id]) => id!);
  const empty = FORMATIONS[lineup.formation].slots.filter((s) => !lineup.slots[s.id]).length;

  const tapSlot = (slot: string) => {
    if (sel === null) return setSel(slot);
    if (sel === slot) return setSel(null);
    const slots = { ...lineup.slots };
    if (isSlot(sel)) { [slots[sel], slots[slot]] = [slots[slot] ?? null, slots[sel] ?? null]; }
    else slots[slot] = sel; // a bench player takes the slot; whoever stood there goes to the bench
    setSel(null);
    void save({ ...lineup, slots });
  };
  const tapBench = (id: string) => {
    if (sel && isSlot(sel)) { setSel(null); void save({ ...lineup, slots: { ...lineup.slots, [sel]: id } }); return; }
    setSel(sel === id ? null : id);
  };
  const best = () => {
    const pool = mine.roster.filter(fit);
    const sq = withRatings(v.ratings, () => bestSquad(pool.length >= 11 ? pool : mine.roster));
    setSel(null);
    void save(sq);
  };
  const reformation = (f: FormationId) => { setSel(null); void save({ ...withRatings(v.ratings, () => changeFormation(lineup, f)), style: lineup.style }); };

  const fixtures = v.leagues[league === 1 ? '1' : '2'];
  const next = fixtures.next.find((f) => f.a === me.clubId || f.b === me.clubId);
  const opp = next ? (next.a === me.clubId ? next.b : next.a) : null;
  const last = fixtures.last.find((f) => (f.a === me.clubId || f.b === me.clubId) && f.r);
  const lastOpp = last ? (last.a === me.clubId ? last.b : last.a) : null;
  const lastMine = last ? (last.a === me.clubId ? last.r![0] : last.r![1]) : 0;
  const lastTheirs = last ? (last.a === me.clubId ? last.r![1] : last.r![0]) : 0;

  const toggleReady = async () => { setErr((await ctx.act({ t: 'ready', ready: !me.ready })) ?? ''); };
  const toggleAuto = async () => { setErr((await ctx.act({ t: 'auto', auto: !me.auto })) ?? ''); };

  const tabs: Array<[Tab, string]> = [['match', t('Match')], ['squad', t('Squad')], ['table', t('Table')], ['news', t('News')]];

  return (
    <div className="stack">
      <div className="tabs" role="tablist" aria-label={t('Career sections')}>
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} className={cx('tab', tab === id && 'is-on')} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'match' && (
        <>
          <section className="panel career__section">
            <p className="eyebrow">{t('Season {s} · matchday {d} of {n}', { s: v.season, d: Math.min(v.day + 1, DAYS), n: DAYS })} · {league === 1 ? t('First League') : t('Second League')}</p>
            {next && opp && (
              <h2 className="fixture">
                <ClubTag v={v} id={next.a} size={34} mine={next.a === me.clubId} /> <span className="fixture__vs">{t('v')}</span> <ClubTag v={v} id={next.b} size={34} mine={next.b === me.clubId} />
              </h2>
            )}
            <p className="muted">
              {me.ready ? t('You are ready. The matchday plays when everyone is ready, or in {time}.', { time: left })
                : t('Plays when everyone is ready, or in {time} with your saved line-up.', { time: left })}
            </p>
            <ul className="readyrow" aria-label={t('Managers')}>
              {v.members.map((m) => <li key={m.id} className={m.ready || m.auto ? 'is-ready' : ''}>{m.ready || m.auto ? '✔' : '…'} {m.name}{m.auto ? ` (${t('auto')})` : ''}</li>)}
            </ul>
            <div className="row">
              <Button variant={me.ready ? 'soft' : 'primary'} size="lg" onClick={toggleReady}>{me.ready ? t('Not ready yet') : t('Ready: play the matchday')}</Button>
              <Button variant="ghost" onClick={toggleAuto} aria-pressed={me.auto}>{me.auto ? t('Auto-play is on') : t('Let the computer play my matches')}</Button>
            </div>
            {err && <p className="error" role="alert">{err}</p>}
          </section>

          {last && lastOpp && (
            <section className="panel career__section lastresult">
              <p className="eyebrow">{t('Last matchday')}</p>
              <p className={cx('lastresult__score', lastMine > lastTheirs ? 'is-win' : lastMine < lastTheirs ? 'is-loss' : '')}>
                <ClubTag v={v} id={me.clubId} size={22} mine /> <b>{lastMine}–{lastTheirs}</b> <ClubTag v={v} id={lastOpp} size={22} />
              </p>
              {v.lastMatches.some((m) => m.a === me.clubId || m.b === me.clubId) && <Button variant="soft" icon="play" onClick={onWatch}>{t('Watch the match')}</Button>}
            </section>
          )}

          <Section title={t('Line-up')} aside={<Button size="sm" variant="soft" onClick={best}>{t('Best eleven')}</Button>}>
            {problems.length > 0 && <Banner tone="warn" icon="info">{tn('{n} player in your eleven is out. He will be replaced automatically, or tap him to choose.', '{n} players in your eleven are out. They will be replaced automatically, or tap one to choose.', problems.length)}</Banner>}
            {empty > 0 && <Banner tone="warn" icon="info">{t('Your eleven has empty places. The best available players will fill them.')}</Banner>}
            <Seg label={t('Formation')} value={lineup.formation} onChange={reformation} options={FORMATION_IDS.map((f) => ({ value: f, label: FORMATIONS[f].name }))} />
            <Pitch formation={lineup.formation} slots={lineup.slots} selected={sel && isSlot(sel) ? sel : null} onSlot={tapSlot} ratings="full" label={t('Your line-up')} />
            <Seg label={t('Style')} value={lineup.style} onChange={(style) => void save({ ...lineup, style })} options={STYLE_IDS.map((s) => ({ value: s, label: styleName(s) }))} />
            <p className="muted small">{sel ? (isSlot(sel) ? t('Now tap another place, or a player on the bench.') : t('Now tap the place he should take.')) : t('Tap a place on the pitch, then another place or a bench player to swap them.')}</p>
          </Section>

          <Section title={t('Bench')} aside={<span className="muted small">{tn('{n} player', '{n} players', bench.length)}</span>}>
            <ul className="plist">
              {bench.sort((a, b) => ovrNow(v, b) - ovrNow(v, a)).map((id) => (
                <li key={id}><PlayerRow v={v} id={id} selected={sel === id} onClick={() => tapBench(id)} /></li>
              ))}
            </ul>
          </Section>
        </>
      )}

      {tab === 'squad' && LINES.map((l) => {
        const ids = mine.roster.filter((id) => lineOf(W.player(id).pos) === l).sort((a, b) => ovrNow(v, b) - ovrNow(v, a));
        return (
          <Section key={l} title={lineLabel(l)} aside={<span className="muted small">{ids.length}</span>}>
            <ul className="plist">
              {ids.map((id) => {
                const st = v.stats[id];
                return (
                  <li key={id}>
                    <PlayerRow v={v} id={id} note={inXI.has(id) ? <span className="tag tag--ok">{t('starts')}</span> : undefined}
                      right={st ? <span className="prow__stats muted small" title={t('Appearances · goals · assists')}>{st.app}·{st.g}·{st.a}</span> : undefined}>
                      <WhyRating id={id} />
                    </PlayerRow>
                  </li>
                );
              })}
            </ul>
          </Section>
        );
      })}

      {tab === 'table' && (
        <>
          <Section title={league === 1 ? t('First League') : t('Second League')}><Standings v={v} league={league} mineId={me.clubId} /></Section>
          {v.scorers.length > 0 && (
            <Section title={t('Top scorers')}>
              <ol className="scorers">{v.scorers.map((s) => <li key={s.player}><b>{shortName(W.player(s.player).name)}</b> <span className="muted small">{s.club ? clubName(v, s.club) : ''}</span> <span className="scorers__n">{s.goals}</span></li>)}</ol>
            </Section>
          )}
          <Section title={league === 1 ? t('Second League') : t('First League')}><Standings v={v} league={league === 1 ? 2 : 1} mineId={me.clubId} /></Section>
        </>
      )}

      {tab === 'news' && (
        <>
          <Section title={t('News')}><ul className="news">{[...v.news].reverse().map((n, i) => <NewsLine key={`${i}-${n.kind}`} v={v} n={n} />)}</ul></Section>
          {v.history.length > 0 && (
            <Section title={t('Past seasons')}>
              <ul className="history">
                {[...v.history].reverse().map((h) => (
                  <li key={h.season}>
                    <b>{t('Season {n}', { n: h.season })}</b> · {t('Champions: {a} (First League), {b} (Second League)', { a: clubName(v, h.champion['1']), b: clubName(v, h.champion['2']) })}
                    {Object.entries(h.humans).map(([cid, r]) => <div key={cid} className="muted small">{clubName(v, cid)}: {t('finished {pos} in the {league}', { pos: r.pos, league: r.league === 1 ? t('First League') : t('Second League') })}</div>)}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
