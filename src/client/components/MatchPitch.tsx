import type { TFn } from '../../shared/i18n';
import { shade } from '../lib/colors';
import { useI18n } from '../lib/i18n';
import { PH, PW, type FlowLabel, type Scene } from '../lib/scene';
import { cx } from './ui';

const GOAL_W = 7.32;
const GX = (PW - GOAL_W) / 2;

/** The word under the team name on the arrow. */
function stateWord(label: FlowLabel, t: TFn): string {
  switch (label) {
    case 'attack': return t('ATTACKING');
    case 'danger': return t('DANGEROUS ATTACK');
    default: return t('BIG CHANCE');
  }
}

/** The big label that pops in over the pitch. scene.ts writes it in English; this is where it is shown in the reader's language. */
function tagText(text: string, t: TFn): string {
  switch (text) {
    case 'GOAL!': return t('GOAL!');
    case 'SAVED': return t('SAVED');
    case 'MISSED': return t('MISSED');
    case 'SCORES': return t('SCORES');
    case 'OFF TARGET': return t('OFF TARGET');
    case 'OFF THE POST': return t('OFF THE POST');
    case 'YELLOW CARD': return t('YELLOW CARD');
    case 'RED CARD': return t('RED CARD');
    case 'FREE KICK': return t('FREE KICK');
    case 'PENALTY': return t('PENALTY');
    case 'CORNER': return t('CORNER');
    case 'CHANCE': return t('CHANCE');
    case 'KICK-OFF': return t('KICK-OFF');
    case 'HALF-TIME': return t('HALF-TIME');
    case 'FULL-TIME': return t('FULL-TIME');
    case 'EXTRA TIME': return t('EXTRA TIME');
    case 'END OF EXTRA TIME': return t('END OF EXTRA TIME');
    case 'PENALTIES': return t('PENALTIES');
    default: return text;
  }
}

/** hex colour a mixed toward b by t (0 to 1) */
function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => { const x = h.replace('#', ''); const n = x.length === 3 ? x.split('').map((c) => c + c).join('') : x; return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)); };
  const [r1, g1, b1] = p(a); const [r2, g2, b2] = p(b);
  const m = (u: number, v: number) => Math.round(u + (v - u) * t).toString(16).padStart(2, '0');
  return `#${m(r1!, r2!)}${m(g1!, g2!)}${m(b1!, b2!)}`;
}

/**
 * Quiet play: one big arrow over the whole pitch. It points at the goal the team is attacking, its tip gets closer to
 * that goal as the attack gets more dangerous, and for a big chance their whole half glows red. The team and the state are
 * written on the pitch. Distances below are measured from the attacking team's own goal line.
 */
function FlowArrow({ team, show, level, lane, color, name, label }: {
  team: 0 | 1; show: number; level: number; lane: number; color: string; name: string; label: FlowLabel;
}) {
  const { t } = useI18n();
  const yy = (d: number) => (team === 0 ? PH - d : d); // team 0 attacks up the screen, team 1 down
  const dTail = 16;
  const dTip = 56 + level * 39; // from just past halfway to ten metres from goal
  const dHead = Math.max(dTail + 12, dTip - 13);
  const hw = 3.2 + level * 3.3;
  const hh = hw * 2.1;
  const hot = Math.min(1, Math.max(0, (level - 0.62) / 0.38));
  const fill = mixHex(color, '#ff2a1f', hot * 0.85);
  const path = `M${lane - hw} ${yy(dTail)}L${lane + hw} ${yy(dTail)}L${lane + hw} ${yy(dHead)}L${lane + hh} ${yy(dHead)}L${lane} ${yy(dTip)}L${lane - hh} ${yy(dHead)}L${lane - hw} ${yy(dHead)}Z`;
  const chevrons: number[] = [];
  for (let d = dTail - 7; d < dTip; d += 7) chevrons.push(d);
  const words = stateWord(label, t);
  const nm = name.length > 15 ? `${name.slice(0, 14)}.` : name;
  const wide = Math.max(nm.length, words.length) * 1.62 + 4.5;
  const mid = (dTail + dTip) / 2;
  return (
    <g className={cx('mp-flow', `mp-flow--${team}`, label === 'chance' && 'is-hot')} opacity={Math.min(1, show)}>
      <defs>
        <clipPath id={`mp-clip-${team}`}><path d={path} /></clipPath>
        <linearGradient id={`mp-heat-${team}`} x1="0" y1={team === 0 ? 0 : 1} x2="0" y2={team === 0 ? 1 : 0}>
          <stop offset="0" stopColor="#ff2a1f" stopOpacity=".62" />
          <stop offset="1" stopColor="#ff2a1f" stopOpacity="0" />
        </linearGradient>
      </defs>
      {hot > 0 && <rect className="mp-heat" x="0" y={team === 0 ? 0 : PH / 2} width={PW} height={PH / 2} fill={`url(#mp-heat-${team})`} opacity={hot} />}
      <path d={path} fill={fill} fillOpacity=".72" stroke="#fff" strokeOpacity=".7" strokeWidth=".5" strokeLinejoin="round" />
      <g clipPath={`url(#mp-clip-${team})`}>
        <g className={`mp-chev mp-chev--${team}`}>
          {chevrons.map((d) => (
            <polyline key={d} points={`${lane - hh * 0.62} ${yy(d - 3.4)} ${lane} ${yy(d)} ${lane + hh * 0.62} ${yy(d - 3.4)}`} fill="none" stroke="#fff" strokeOpacity=".62" strokeWidth=".95" strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </g>
      </g>
      <g transform={`translate(${lane} ${yy(mid)})`} className="mp-flow__label">
        <rect x={-wide / 2} y="-4.2" width={wide} height="8.4" rx="2.2" fill="#0a1017" fillOpacity=".82" stroke={fill} strokeWidth=".45" />
        <text y="-.55" textAnchor="middle" className="mp-flow__team">{nm.toUpperCase()}</text>
        <text y="2.7" textAnchor="middle" className={cx('mp-flow__state', label !== 'attack' && 'is-danger')}>{words}</text>
      </g>
    </g>
  );
}

/** The live match: a striped top-down pitch with 22 dots and a ball. Everything is driven by a Scene. */
export function MatchPitch({ scene, trail, colors, names, tagKey }: {
  scene: Scene;
  trail: Array<{ x: number; y: number }>;
  colors: [string, string];
  names: [string, string];
  /** changes whenever a new moment starts so the tag pops in again */
  tagKey: string;
}) {
  const { t } = useI18n();
  const [c0, c1] = colors;
  const stripes = Array.from({ length: 14 }, (_, i) => i);
  const rippleTop = scene.ripple?.goal === 0 ? scene.ripple.p : 0;
  const rippleBottom = scene.ripple?.goal === 1 ? scene.ripple.p : 0;
  return (
    <div className="mpitch" role="img" aria-label={t('Live match view')}>
      <svg viewBox={`-2.5 -5 ${PW + 5} ${PH + 10}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="mp-grass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--pitch-hi, #2b9159)" />
            <stop offset="1" stopColor="var(--pitch-lo, #1c6e41)" />
          </linearGradient>
          <radialGradient id="mp-light" cx="50%" cy="46%" r="70%">
            <stop offset="0" stopColor="#fff" stopOpacity=".16" />
            <stop offset="1" stopColor="#000" stopOpacity=".28" />
          </radialGradient>
          <radialGradient id="mp-a" cx="35%" cy="30%" r="80%">
            <stop offset="0" stopColor={shade(c0, 0.45)} />
            <stop offset="1" stopColor={shade(c0, -0.18)} />
          </radialGradient>
          <radialGradient id="mp-b" cx="35%" cy="30%" r="80%">
            <stop offset="0" stopColor={shade(c1, 0.45)} />
            <stop offset="1" stopColor={shade(c1, -0.18)} />
          </radialGradient>
          <radialGradient id="mp-ball" cx="35%" cy="30%" r="80%">
            <stop offset="0" stopColor="#fff" />
            <stop offset="1" stopColor="#d9dee6" />
          </radialGradient>
          <pattern id="mp-net" width="1.1" height="1.1" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <path d="M0 0H1.1M0 0V1.1" stroke="#fff" strokeOpacity=".55" strokeWidth=".12" fill="none" />
          </pattern>
          <filter id="mp-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation=".7" />
          </filter>
        </defs>

        {/* grass, mown in stripes, with floodlight falloff */}
        <rect x="-2.5" y="-5" width={PW + 5} height={PH + 10} fill="url(#mp-grass)" />
        {stripes.map((i) => (i % 2 === 0 ? <rect key={i} x="-2.5" y={(PH / 14) * i} width={PW + 5} height={PH / 14} fill="#000" opacity=".055" /> : null))}
        <rect x="-2.5" y="-5" width={PW + 5} height={PH + 10} fill="url(#mp-light)" />

        {/* markings */}
        <g className="mp-lines">
          <rect x="0" y="0" width={PW} height={PH} />
          <line x1="0" y1={PH / 2} x2={PW} y2={PH / 2} />
          <circle cx={PW / 2} cy={PH / 2} r="9.15" />
          <circle cx={PW / 2} cy={PH / 2} r=".45" className="mp-dot" />
          <rect x="13.84" y="0" width="40.32" height="16.5" />
          <rect x="24.84" y="0" width="18.32" height="5.5" />
          <rect x="13.84" y={PH - 16.5} width="40.32" height="16.5" />
          <rect x="24.84" y={PH - 5.5} width="18.32" height="5.5" />
          <circle cx={PW / 2} cy="11" r=".45" className="mp-dot" />
          <circle cx={PW / 2} cy={PH - 11} r=".45" className="mp-dot" />
          <path d="M26.7 16.5a9.15 9.15 0 0 0 14.6 0" />
          <path d={`M26.7 ${PH - 16.5}a9.15 9.15 0 0 1 14.6 0`} />
          <path d="M1 0a1 1 0 0 0-1 1M67 0a1 1 0 0 1 1 1" />
          <path d={`M0 ${PH - 1}a1 1 0 0 0 1 1M${PW} ${PH - 1}a1 1 0 0 1-1 1`} />
        </g>

        {/* goals */}
        {[0, 1].map((g) => {
          const y = g === 0 ? -2.6 : PH;
          const p = g === 0 ? rippleTop : rippleBottom;
          return (
            <g key={g} className="mp-goal">
              <rect x={GX} y={y} width={GOAL_W} height="2.6" fill="url(#mp-net)" />
              <rect x={GX} y={y} width={GOAL_W} height="2.6" fill="#fff" opacity={p ? (1 - p) * 0.55 : 0} />
              <path d={g === 0 ? `M${GX} 0V-2.6H${GX + GOAL_W}V0` : `M${GX} ${PH}v2.6h${GOAL_W}v-2.6`} className="mp-post" />
            </g>
          );
        })}

        {/* quiet play: the arrow(s). They cross-fade when the attack changes hands. */}
        {scene.flow && ([0, 1] as const).map((tm) => scene.flow!.show[tm] > 0.02 && (
          <FlowArrow key={tm} team={tm} show={scene.flow!.show[tm]} level={scene.flow!.level[tm]} lane={scene.flow!.lane[tm]} color={tm === 0 ? c0 : c1} name={names[tm]} label={scene.flow!.label[tm]} />
        ))}

        {/* highlights: the players and the ball are only there when something is happening */}
        <g opacity={scene.live} style={{ visibility: scene.live < 0.01 ? 'hidden' : 'visible' }}>
        {/* chance pulse and shot line */}
        {scene.pulse && (
          <circle cx={scene.pulse.x} cy={scene.pulse.y} r={2.4 + scene.pulse.p * 5.5} className="mp-pulse" style={{ stroke: scene.pulse.team === 0 ? c0 : c1, opacity: 1 - scene.pulse.p }} />
        )}
        {scene.shot && (
          <line
            x1={scene.shot.x1} y1={scene.shot.y1}
            x2={scene.shot.x1 + (scene.shot.x2 - scene.shot.x1) * scene.shot.p}
            y2={scene.shot.y1 + (scene.shot.y2 - scene.shot.y1) * scene.shot.p}
            className="mp-shot"
          />
        )}

        {/* players */}
        {scene.dots.map((d) => {
          const fill = d.gk ? (d.team === 0 ? '#ffd23f' : '#5eead4') : `url(#mp-${d.team === 0 ? 'a' : 'b'})`;
          return (
            <g key={d.key} transform={`translate(${d.x.toFixed(2)} ${d.y.toFixed(2)})`} className={cx('mp-dot-g', d.hot && 'is-hot')}>
              <ellipse cx=".5" cy="1.15" rx="1.9" ry="1" className="mp-shadow" />
              <g transform={`scale(${d.down ? 0.85 : d.scale})`}>
                {d.hot && <circle r="3.1" className="mp-hot" style={{ stroke: d.team === 0 ? c0 : c1 }} />}
                <circle r="1.95" fill={fill} className="mp-player" />
                <circle r="1.95" fill="none" className="mp-rim" />
                {d.down && <circle r="2.6" className="mp-down" />}
              </g>
              {d.booked && d.carded === null && <rect x="1.1" y="-2.6" width=".95" height="1.35" rx=".15" fill="#ffd23f" stroke="#000" strokeWidth=".08" strokeOpacity=".4" />}
              {d.carded && (
                <g className="mp-card" key={`${d.key}-${d.carded}`}>
                  <rect x="-.9" y="-6.3" width="1.8" height="2.5" rx=".25" fill={d.carded === 'red' ? '#ef2f2f' : '#ffd23f'} stroke="#000" strokeWidth=".1" strokeOpacity=".5" transform="rotate(-8)" />
                </g>
              )}
              {d.hot && <text y="5.1" textAnchor="middle" className="mp-name">{d.label}</text>}
            </g>
          );
        })}

        {scene.ref && (
          <g transform={`translate(${scene.ref.x.toFixed(2)} ${scene.ref.y.toFixed(2)})`}>
            <circle r="1.55" fill="#111" stroke="#ffd23f" strokeWidth=".35" />
          </g>
        )}

        {/* the ball, with a short trail */}
        {trail.map((tp, i) => (
          <circle key={i} cx={tp.x} cy={tp.y} r={0.25 + i * 0.1} className="mp-trail" style={{ opacity: 0.08 + i * 0.07 }} />
        ))}
        <g transform={`translate(${scene.ball.x.toFixed(2)} ${(scene.ball.y - scene.ball.lift * 1.5).toFixed(2)})`}>
          <ellipse cx=".25" cy={0.9 + scene.ball.lift * 1.5} rx=".95" ry=".45" className="mp-shadow" />
          {scene.ball.hot && <circle r="2.6" className="mp-ballglow" filter="url(#mp-glow)" />}
          <circle r={0.95 + scene.ball.lift * 0.35} fill="url(#mp-ball)" stroke="#111" strokeWidth=".14" />
          <path d="M0-.55l.5.35-.2.6h-.6l-.2-.6z" fill="#111" opacity=".85" />
        </g>
        </g>
      </svg>

      {scene.tag && (
        <div className={cx('mtag', `mtag--${scene.tag.kind}`)} key={`${tagKey}-${scene.tag.kind}`} style={{ ['--team' as string]: scene.tag.team === 0 ? c0 : c1 }}>
          <b>{tagText(scene.tag.text, t)}</b>
          {scene.tag.sub && <span>{scene.tag.sub}</span>}
        </div>
      )}
    </div>
  );
}
