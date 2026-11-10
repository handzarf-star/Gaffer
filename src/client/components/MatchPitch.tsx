import { shade } from '../lib/colors';
import { PH, PW, type Scene } from '../lib/scene';
import { cx } from './ui';

const GOAL_W = 7.32;
const GX = (PW - GOAL_W) / 2;

/** The live match: a striped top-down pitch with 22 dots and a ball. Everything is driven by a Scene. */
export function MatchPitch({ scene, trail, colors, tagKey }: {
  scene: Scene;
  trail: Array<{ x: number; y: number }>;
  colors: [string, string];
  /** changes whenever a new moment starts so the tag pops in again */
  tagKey: string;
}) {
  const [c0, c1] = colors;
  const stripes = Array.from({ length: 14 }, (_, i) => i);
  const rippleTop = scene.ripple?.goal === 0 ? scene.ripple.p : 0;
  const rippleBottom = scene.ripple?.goal === 1 ? scene.ripple.p : 0;
  return (
    <div className="mpitch" role="img" aria-label="Live match view">
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
      </svg>

      {scene.tag && (
        <div className={cx('mtag', `mtag--${scene.tag.kind}`)} key={`${tagKey}-${scene.tag.kind}`} style={{ ['--team' as string]: scene.tag.team === 0 ? c0 : c1 }}>
          <b>{scene.tag.text}</b>
          {scene.tag.sub && <span>{scene.tag.sub}</span>}
        </div>
      )}
      {scene.fast && <div className="mfast" aria-hidden="true"><i>⏩</i> fast-forward</div>}
    </div>
  );
}
