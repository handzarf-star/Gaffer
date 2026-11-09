// Nations are drawn as small coloured bands + a 3-letter code. Flag emoji are not used on purpose:
// Windows does not render them (it shows two letters), and England/Scotland/Wales are not ISO countries.
// The bands are a simplified, original rendering, not a copy of anyone's artwork.

export interface Nation {
  code: string;
  name: string;
  colors: string[];
  dir: 'h' | 'v';
}

const N = (code: string, name: string, dir: 'h' | 'v', ...colors: string[]): Nation => ({ code, name, colors, dir });

export const NATIONS: Record<string, Nation> = Object.fromEntries(
  [
    N('ARG', 'Argentina', 'h', '#75aadb', '#ffffff', '#75aadb'),
    N('BRA', 'Brazil', 'h', '#009c3b', '#ffdf00', '#009c3b'),
    N('FRA', 'France', 'v', '#0055a4', '#ffffff', '#ef4135'),
    N('ITA', 'Italy', 'v', '#009246', '#ffffff', '#ce2b37'),
    N('GER', 'Germany', 'h', '#111111', '#dd0000', '#ffce00'),
    N('ESP', 'Spain', 'h', '#aa151b', '#f1bf00', '#aa151b'),
    N('ENG', 'England', 'h', '#ffffff', '#ce1124', '#ffffff'),
    N('SCO', 'Scotland', 'h', '#0065bf', '#ffffff', '#0065bf'),
    N('WAL', 'Wales', 'h', '#ffffff', '#c8102e', '#00ab39'),
    N('IRL', 'Ireland', 'v', '#169b62', '#ffffff', '#ff883e'),
    N('NED', 'Netherlands', 'h', '#ae1c28', '#ffffff', '#21468b'),
    N('POR', 'Portugal', 'v', '#046a38', '#046a38', '#da291c'),
    N('BEL', 'Belgium', 'v', '#111111', '#fdda24', '#ef3340'),
    N('CRO', 'Croatia', 'h', '#ff0000', '#ffffff', '#171796'),
    N('URU', 'Uruguay', 'h', '#7bafd4', '#ffffff', '#7bafd4'),
    N('COL', 'Colombia', 'h', '#fcd116', '#003893', '#ce1126'),
    N('CHI', 'Chile', 'h', '#ffffff', '#ffffff', '#d52b1e'),
    N('PAR', 'Paraguay', 'h', '#d52b1e', '#ffffff', '#0038a8'),
    N('PER', 'Peru', 'v', '#d91023', '#ffffff', '#d91023'),
    N('ECU', 'Ecuador', 'h', '#ffdd00', '#034ea2', '#ed1c24'),
    N('MEX', 'Mexico', 'v', '#006847', '#ffffff', '#ce1126'),
    N('USA', 'United States', 'h', '#b22234', '#ffffff', '#3c3b6e'),
    N('CAN', 'Canada', 'v', '#d52b1e', '#ffffff', '#d52b1e'),
    N('CRC', 'Costa Rica', 'h', '#002b7f', '#ce1126', '#002b7f'),
    N('DEN', 'Denmark', 'h', '#c8102e', '#ffffff', '#c8102e'),
    N('SWE', 'Sweden', 'h', '#006aa7', '#fecc00', '#006aa7'),
    N('NOR', 'Norway', 'h', '#ba0c2f', '#ffffff', '#00205b'),
    N('FIN', 'Finland', 'h', '#ffffff', '#003580', '#ffffff'),
    N('POL', 'Poland', 'h', '#ffffff', '#dc143c', '#dc143c'),
    N('CZE', 'Czechia', 'h', '#ffffff', '#d7141a', '#11457e'),
    N('SVK', 'Slovakia', 'h', '#ffffff', '#0b4ea2', '#ee1c25'),
    N('SVN', 'Slovenia', 'h', '#ffffff', '#005da4', '#ed1c24'),
    N('SRB', 'Serbia', 'h', '#c6363c', '#0c4076', '#ffffff'),
    N('BIH', 'Bosnia and Herzegovina', 'h', '#002f6c', '#ffcd00', '#002f6c'),
    N('BUL', 'Bulgaria', 'h', '#ffffff', '#00966e', '#d62612'),
    N('ROU', 'Romania', 'v', '#002b7f', '#fcd116', '#ce1126'),
    N('HUN', 'Hungary', 'h', '#ce2939', '#ffffff', '#477050'),
    N('AUT', 'Austria', 'h', '#ed2939', '#ffffff', '#ed2939'),
    N('SUI', 'Switzerland', 'h', '#d52b1e', '#ffffff', '#d52b1e'),
    N('RUS', 'Russia / USSR', 'h', '#ffffff', '#0039a6', '#d52b1e'),
    N('UKR', 'Ukraine', 'h', '#0057b7', '#0057b7', '#ffd700'),
    N('TUR', 'Turkey', 'h', '#e30a17', '#ffffff', '#e30a17'),
    N('GRE', 'Greece', 'h', '#0d5eaf', '#ffffff', '#0d5eaf'),
    N('GEO', 'Georgia', 'h', '#ffffff', '#e8112d', '#ffffff'),
    N('MAR', 'Morocco', 'h', '#c1272d', '#006233', '#c1272d'),
    N('ALG', 'Algeria', 'v', '#006233', '#ffffff', '#d21034'),
    N('EGY', 'Egypt', 'h', '#ce1126', '#ffffff', '#111111'),
    N('SEN', 'Senegal', 'v', '#00853f', '#fdef42', '#e31b23'),
    N('NGA', 'Nigeria', 'v', '#008751', '#ffffff', '#008751'),
    N('GHA', 'Ghana', 'h', '#ce1126', '#fcd116', '#006b3f'),
    N('CIV', 'Ivory Coast', 'v', '#f77f00', '#ffffff', '#009e60'),
    N('CMR', 'Cameroon', 'v', '#007a5e', '#ce1126', '#fcd116'),
    N('LBR', 'Liberia', 'h', '#bf0a30', '#ffffff', '#002868'),
    N('GUI', 'Guinea', 'v', '#ce1126', '#fcd116', '#009460'),
    N('JPN', 'Japan', 'h', '#ffffff', '#bc002d', '#ffffff'),
    N('KOR', 'South Korea', 'h', '#ffffff', '#cd2e3a', '#0047a0'),
    N('IRN', 'Iran', 'h', '#239f40', '#ffffff', '#da0000'),
    N('AUS', 'Australia', 'h', '#00008b', '#ffffff', '#cc0000'),
    N('NZL', 'New Zealand', 'h', '#00247d', '#ffffff', '#cc142b'),
  ].map((n) => [n.code, n]),
);

export function nation(code: string): Nation {
  return (
    NATIONS[code] ?? { code, name: code, colors: ['#94a3b8', '#e2e8f0', '#94a3b8'], dir: 'h' as const }
  );
}

/** CSS background for a nation's band chip. */
export function nationGradient(code: string): string {
  const n = nation(code);
  const cs = n.colors;
  const angle = n.dir === 'h' ? '180deg' : '90deg';
  const step = 100 / cs.length;
  const stops = cs.map((c, i) => `${c} ${(i * step).toFixed(2)}% ${((i + 1) * step).toFixed(2)}%`).join(', ');
  return `linear-gradient(${angle}, ${stops})`;
}
