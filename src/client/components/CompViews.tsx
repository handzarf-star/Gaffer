import { useMemo } from 'react';
import { COMPETITIONS, tables, type CompFixture, type CompState } from '../../shared/competition';
import type { TFn } from '../../shared/i18n';
import { player, shortName } from '../../shared/players';
import type { Seat } from '../../shared/protocol';
import { seatColor } from '../lib/colors';
import { useI18n } from '../lib/i18n';
import { Avatar, Icon, cx } from './ui';

export type SeatMap = Map<string, Seat>;
export const seatMap = (seats: Seat[]): SeatMap => new Map(seats.map((s) => [s.id, s]));

/** Names of rounds, groups and tables as the competition engine writes them ("Matchday 3", "Group B", "Semi-final" ...), in the reader's language. */
export function stageLabel(label: string, t: TFn): string {
  switch (label) {
    case 'Match': return t('Match');
    case 'League table': return t('League table');
    case 'Final': return t('Final');
    case 'Semi-final': return t('Semi-final');
    case 'Quarter-final': return t('Quarter-final');
    case 'Round of 16': return t('Round of 16');
    case 'Round of 32': return t('Round of 32');
  }
  let m = /^Matchday (\d+)$/.exec(label);
  if (m) return t('Matchday {n}', { n: m[1]! });
  m = /^Group stage, matchday (\d+)$/.exec(label);
  if (m) return t('Group stage, matchday {n}', { n: m[1]! });
  m = /^Group ([A-Z])$/.exec(label);
  if (m) return t('Group {g}', { g: m[1]! });
  m = /^Round of (\d+)$/.exec(label);
  if (m) return t('Round of {n}', { n: m[1]! });
  return label;
}

/** Where a goal came from, for the tooltip on a goal chip (the engine's own words: penalty, freekick, corner). */
function goalSource(src: string, t: TFn): string {
  switch (src) {
    case 'penalty': return t('penalty');
    case 'freekick': return t('freekick');
    case 'corner': return t('corner');
    default: return src;
  }
}

export function TeamName({ seat, you, compact }: { seat: Seat | undefined; you?: string; compact?: boolean }) {
  const { t } = useI18n();
  if (!seat) return <span>?</span>;
  return (
    <span className="team">
      <Avatar name={seat.name} hue={seat.hue} color={seatColor(seat)} size={compact ? 20 : 26} />
      <span className="team__name">{seat.name}</span>
      {seat.bot && <span className="cpu">CPU</span>}
      {seat.id === you && <span className="cpu cpu--you">{t('you')}</span>}
    </span>
  );
}

/** One played (or upcoming) fixture: names, score, scorers. */
export function FixtureRow({ fx, seats, you, showScorers = true }: { fx: CompFixture; seats: SeatMap; you: string; showScorers?: boolean }) {
  const { t } = useI18n();
  const a = seats.get(fx.a);
  const b = seats.get(fx.b);
  const l = fx.lite;
  const mine = fx.a === you || fx.b === you;
  const humans = fx.humans.length > 0;
  return (
    <div className={cx('fxrow', mine && 'is-mine', !humans && 'is-cpu')}>
      <div className="fxrow__main">
        <span className={cx('fxrow__t', l?.winner === 0 && 'is-win')}><TeamName seat={a} you={you} compact /></span>
        <span className="fxrow__score">
          {l ? (
            <>
              <b>{l.score[0]}</b><i>–</i><b>{l.score[1]}</b>
            </>
          ) : <i>v</i>}
        </span>
        <span className={cx('fxrow__t fxrow__t--r', l?.winner === 1 && 'is-win')}><TeamName seat={b} you={you} compact /></span>
      </div>
      {l && (
        <div className="fxrow__meta">
          <span>{stageLabel(fx.stage, t)}</span>
          {l.went === 'et' && <span>{t('after extra time')}</span>}
          {l.pens && <span>{t('{a}–{b} on penalties', { a: l.pens[0], b: l.pens[1] })}</span>}
          {!humans && <span>{t('CPU match')}</span>}
        </div>
      )}
      {l && showScorers && l.goals.length > 0 && (
        <div className="fxrow__goals">
          {l.goals.map((g, i) => (
            <span key={i} className={cx('goalchip', g.team === 1 && 'goalchip--b')} title={g.src && g.src !== 'play' ? goalSource(g.src, t) : undefined}>
              ⚽ {shortName(player(g.p).name)} {g.t}'{g.src === 'penalty' ? ` ${t('(pen)')}` : g.src === 'freekick' ? ` ${t('(fk)')}` : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function TableView({ name, rows, seats, you, qualify }: { name: string; rows: ReturnType<typeof tables>[number]['rows']; seats: SeatMap; you: string; qualify?: number }) {
  const { t } = useI18n();
  const title = stageLabel(name, t);
  return (
    <div className="tblwrap">
      <h3 className="tbl__name">{title}</h3>
      <table className="table" aria-label={title}>
        <thead><tr><th>#</th><th>{t('Team')}</th><th>{t('P')}</th><th>{t('W')}</th><th>{t('D')}</th><th>{t('L')}</th><th>{t('GD')}</th><th>{t('Pts')}</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className={cx(i === 0 && 'is-top', r.id === you && 'is-me', !!qualify && i < qualify && 'is-through')}>
              <td>{i + 1}</td>
              <td><TeamName seat={seats.get(r.id)} you={you} compact /></td>
              <td>{r.played}</td><td>{r.w}</td><td>{r.d}</td><td>{r.l}</td>
              <td>{r.gf - r.ga > 0 ? '+' : ''}{r.gf - r.ga}</td>
              <td><b>{r.pts}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Knockout rounds as columns (scrolls sideways on a phone). */
export function BracketView({ comp, seats, you }: { comp: CompState; seats: SeatMap; you: string }) {
  const { t } = useI18n();
  const rounds = useMemo(() => comp.days.filter((d) => d.kind === 'ko'), [comp.days]);
  if (rounds.length === 0) return null;
  return (
    <div className="bracket" role="group" aria-label={t('Knockout bracket')}>
      {rounds.map((d) => (
        <div className="bracket__col" key={d.label}>
          <h4>{stageLabel(d.label, t)}</h4>
          {d.fixtures.map((f) => {
            const l = f.lite;
            const mine = f.a === you || f.b === you;
            return (
              <div key={f.id} className={cx('bracket__fx', mine && 'is-mine')}>
                {([f.a, f.b] as const).map((id, i) => (
                  <div key={id} className={cx('bracket__team', l?.winner === i && 'is-win', l && l.winner !== i && 'is-out')}>
                    <TeamName seat={seats.get(id)} you={you} compact />
                    <b>{l ? l.score[i] : ''}{l?.pens ? ` (${l.pens[i]})` : ''}</b>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** League table, or group tables plus the bracket, whichever the competition has. */
export function CompetitionTables({ comp, seats, you }: { comp: CompState; seats: SeatMap; you: string }) {
  const tbls = useMemo(() => tables(comp), [comp]);
  const koStarted = comp.days.some((d) => d.kind === 'ko');
  return (
    <div className="comptables">
      {tbls.map((t) => (
        <TableView key={t.name} name={t.name} rows={t.rows} seats={seats} you={you} qualify={comp.kind === 'groups' ? 2 : undefined} />
      ))}
      {koStarted && <BracketView comp={comp} seats={seats} you={you} />}
    </div>
  );
}

/** The competition's name; pass `t` to get it in the reader's language. */
export function compName(kind: CompState['kind'], t?: TFn): string {
  const name = COMPETITIONS[kind].name;
  return t ? t(name) : name;
}

export function ChampionBanner({ id, seats, you }: { id: string | null; seats: SeatMap; you: string }) {
  const s = id ? seats.get(id) : undefined;
  if (!s) return null;
  return (
    <div className={cx('champ', id === you && 'champ--you')}>
      <Icon name="trophy" size={22} />
      <Avatar name={s.name} hue={s.hue} color={seatColor(s)} size={34} />
      <b>{s.name}</b>
      {s.bot && <span className="cpu">CPU</span>}
    </div>
  );
}
