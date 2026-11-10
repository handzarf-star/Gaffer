// Player tendencies that drive cards, penalties and set pieces in the match engine.
//
// HONESTY NOTE: league-level baselines below are calibrated to published averages (Premier League 2024-25 is about
// 4.3 yellows and 0.15 reds per match; top-five-league penalties are about 0.25-0.36 per game converting at ~78%).
// Per-player values are APPROXIMATE recollections of well-known career tendencies (a notorious tackler, a famous penalty
// or free-kick specialist), expressed as multipliers. They are not looked-up per-90 statistics. Everyone not listed
// gets the average for their position. Tune freely: every override key is checked against the player list in tests.

import { player, type Player, type Pos } from './players';

export interface Traits {
  /** yellow-card propensity relative to the position average (1 = average) */
  disc: number;
  /** penalty-taking skill 0..1 (default is "can take one if nobody better is on the pitch") */
  pk: number;
  /** free-kick / set-piece skill 0..1 */
  fk: number;
  /** goalkeepers only: penalty-saving skill 0..1 */
  pks: number;
}

/** Real-world-shaped yellow cards per 90 by position (sums to ~1.9 per team per match, i.e. ~4 per game). */
export const YELLOW_PER_90: Record<Pos, number> = {
  GK: 0.04, CB: 0.23, LB: 0.19, RB: 0.19, CDM: 0.27, CM: 0.2, CAM: 0.13, LW: 0.12, RW: 0.12, ST: 0.13,
};

const PK_DEFAULT: Record<Pos, number> = { GK: 0.05, CB: 0.3, LB: 0.3, RB: 0.3, CDM: 0.35, CM: 0.45, CAM: 0.55, LW: 0.5, RW: 0.5, ST: 0.55 };
const FK_DEFAULT: Record<Pos, number> = { GK: 0.02, CB: 0.15, LB: 0.3, RB: 0.3, CDM: 0.35, CM: 0.45, CAM: 0.5, LW: 0.45, RW: 0.45, ST: 0.3 };

type Partial4 = Partial<Traits>;

const DISC: Record<string, number> = {
  // notorious or card-prone
  'sergio-ramos': 2.2, pepe: 2.3, casemiro: 1.7, 'roy-keane': 2.3, 'gennaro-gattuso': 2.1, 'patrick-vieira': 1.5, 'lothar-matthaus': 1.3,
  'nemanja-vidic': 1.5, 'john-terry': 1.3, 'giorgio-chiellini': 1.5, 'leonardo-bonucci': 1.3, 'diego-godin': 1.6, 'javier-mascherano': 2.0,
  'sergio-busquets': 1.6, 'xabi-alonso': 1.2, rodri: 1.4, 'declan-rice': 1.2, 'moises-caicedo': 1.5, 'aurelien-tchouameni': 1.4,
  'antonio-rudiger': 1.6, 'cristian-romero': 1.9, 'lisandro-martinez': 1.6, 'marcel-desailly': 1.4, 'jaap-stam': 1.3, 'fernando-hierro': 1.3,
  'edgar-davids': 1.5, 'michael-essien': 1.4, 'paul-ince': 1.7, 'stefan-effenberg': 1.6, 'mark-van-bommel': 1.9, 'nigel-de-jong': 1.9,
  'daniele-de-rossi': 1.6, 'joao-palhinha': 1.7, 'granit-xhaka': 1.9, 'paul-scholes': 2.0, 'marco-verratti': 2.3, gavi: 1.8, 'nicolo-barella': 1.6,
  'stuart-pearce': 1.5, 'kalidou-koulibaly': 1.3, 'thomas-partey': 1.3, 'scott-mctominay': 1.2, 'steven-gerrard': 1.4, 'zinedine-zidane': 1.6,
  'bruno-fernandes': 1.4, 'jude-bellingham': 1.3, 'federico-valverde': 1.3, 'bruno-guimaraes': 1.4, 'nuno-mendes': 1.1,
  neymar: 1.4, 'vinicius-junior': 1.6, raphinha: 1.2, 'luis-suarez': 1.6, 'zlatan-ibrahimovic': 1.4, 'eric-cantona': 2.0, 'wayne-rooney': 1.7,
  'diego-maradona': 1.9, 'didier-drogba': 1.3, 'samuel-eto-o': 1.3, 'carlos-tevez': 1.5, 'edinson-cavani': 1.4, 'jamie-vardy': 1.7,
  'ivan-toney': 1.3, 'lautaro-martinez': 1.3, 'mario-mandzukic': 1.4, 'oliver-kahn': 1.8, 'jose-luis-chilavert': 2.0, 'emiliano-martinez': 2.0,
  'jordan-pickford': 1.5, 'andre-onana': 1.2,
  // famously clean
  'paolo-maldini': 0.5, 'alessandro-nesta': 0.5, 'bobby-moore': 0.3, 'philipp-lahm': 0.4, 'franz-beckenbauer': 0.4, cafu: 0.6, 'ashley-cole': 0.8,
  'raphael-varane': 0.6, 'mats-hummels': 0.7, 'virgil-van-dijk': 0.7, 'john-stones': 0.6, 'thiago-silva': 0.6, 'trent-alexander-arnold': 0.7,
  'kyle-walker': 0.8, 'carles-puyol': 1.1, 'n-golo-kante': 0.8, 'claude-makelele': 0.9, xavi: 0.4, 'andres-iniesta': 0.4, 'toni-kroos': 0.6,
  'luka-modric': 0.8, 'andrea-pirlo': 0.7, 'kevin-de-bruyne': 0.7, pedri: 0.5, 'jamal-musiala': 0.4, 'florian-wirtz': 0.4, 'martin-odegaard': 0.6,
  'ilkay-gundogan': 0.6, 'lionel-messi': 0.5, 'cristiano-ronaldo': 0.8, 'kylian-mbappe': 0.6, 'harry-kane': 0.6, 'robert-lewandowski': 0.7,
  'karim-benzema': 0.6, 'mohamed-salah': 0.4, 'sadio-mane': 0.6, 'son-heung-min': 0.4, pele: 0.3, 'ronaldo-nazario': 0.6, ronaldinho: 0.6,
  'thierry-henry': 0.6, 'gary-lineker': 0.15, 'michael-owen': 0.4, 'bukayo-saka': 0.7, 'phil-foden': 0.5, 'manuel-neuer': 0.6, 'gianluigi-buffon': 0.8,
};

const PK: Record<string, number> = {
  'cristiano-ronaldo': 0.92, 'lionel-messi': 0.9, 'robert-lewandowski': 0.93, 'harry-kane': 0.93, 'kylian-mbappe': 0.88, 'erling-haaland': 0.9,
  'mohamed-salah': 0.88, neymar: 0.85, 'bruno-fernandes': 0.93, 'zlatan-ibrahimovic': 0.9, 'zinedine-zidane': 0.88, 'michel-platini': 0.9,
  'roberto-baggio': 0.85, 'francesco-totti': 0.88, 'andrea-pirlo': 0.88, 'eden-hazard': 0.86, 'frank-lampard': 0.9, 'steven-gerrard': 0.88,
  'lothar-matthaus': 0.9, 'ronald-koeman': 0.92, 'alan-shearer': 0.93, 'michael-owen': 0.85, 'thierry-henry': 0.85, 'david-villa': 0.85,
  'antoine-griezmann': 0.85, 'karim-benzema': 0.9, 'luka-modric': 0.8, 'ilkay-gundogan': 0.88, 'paulo-dybala': 0.88, 'ivan-toney': 0.95,
  'cole-palmer': 0.93, 'bukayo-saka': 0.85, 'marcus-rashford': 0.85, 'son-heung-min': 0.8, 'hakan-calhanoglu': 0.9, 'dusan-vlahovic': 0.85,
  'ciro-immobile': 0.85, 'edinson-cavani': 0.88, 'sergio-ramos': 0.88, 'sergio-aguero': 0.85, 'carlos-tevez': 0.8, 'diego-maradona': 0.85,
  pele: 0.9, eusebio: 0.9, 'ferenc-puskas': 0.9, 'gerd-muller': 0.9, 'marco-van-basten': 0.88, romario: 0.85, 'ronaldo-nazario': 0.85,
  ronaldinho: 0.8, 'gabriel-batistuta': 0.88, 'davor-suker': 0.85, 'hugo-sanchez': 0.88, 'samuel-eto-o': 0.85, 'alexander-isak': 0.8,
  'lautaro-martinez': 0.8, 'robin-van-persie': 0.88, 'wayne-rooney': 0.88, 'diego-forlan': 0.85, 'radamel-falcao': 0.88,
};

const FK: Record<string, number> = {
  'lionel-messi': 0.95, 'cristiano-ronaldo': 0.82, 'david-beckham': 0.95, 'andrea-pirlo': 0.95, ronaldinho: 0.92, 'juninho-pernambucano': 0.98,
  'roberto-carlos': 0.96, 'michel-platini': 0.92, zico: 0.94, 'gheorghe-hagi': 0.86, 'diego-maradona': 0.92, 'trent-alexander-arnold': 0.88,
  'kieran-trippier': 0.88, 'angel-di-maria': 0.84, neymar: 0.85, marcelo: 0.7, 'toni-kroos': 0.86, 'luka-modric': 0.72, 'riyad-mahrez': 0.78,
  'wayne-rooney': 0.65, 'frank-lampard': 0.62, 'steven-gerrard': 0.7, 'antoine-griezmann': 0.76, 'paulo-dybala': 0.86, 'christian-eriksen': 0.9,
  'hakan-calhanoglu': 0.93, 'gareth-bale': 0.88, 'ronald-koeman': 0.93, 'fernando-hierro': 0.85, 'zinedine-zidane': 0.78,
  'juan-roman-riquelme': 0.86, 'dani-alves': 0.8, 'kevin-de-bruyne': 0.86, 'james-rodriguez': 0.86, 'mesut-ozil': 0.66, 'mohamed-salah': 0.6,
  'martin-odegaard': 0.72, raphinha: 0.84, 'bruno-fernandes': 0.8, 'alessandro-del-piero': 0.9, 'francesco-totti': 0.8, 'paul-gascoigne': 0.8,
  xavi: 0.6, 'cesc-fabregas': 0.6, 'xabi-alonso': 0.7, rivaldo: 0.86, 'eden-hazard': 0.55, 'lothar-matthaus': 0.7, 'gianluca-vialli': 0.6,
  'dimitri-payet': 0.88, 'jay-jay-okocha': 0.75, 'andreas-brehme': 0.8, 'miroslav-klose': 0.3,
};

const PKS: Record<string, number> = {
  'lev-yashin': 0.5, 'gianluigi-buffon': 0.3, 'iker-casillas': 0.25, 'emiliano-martinez': 0.5, alisson: 0.3, 'yassine-bounou': 0.45,
  'dominik-livakovic': 0.5, 'jan-oblak': 0.3, 'thibaut-courtois': 0.2, 'manuel-neuer': 0.25, 'edwin-van-der-sar': 0.3, 'peter-schmeichel': 0.3,
  'petr-cech': 0.3, 'gordon-banks': 0.3, 'diogo-costa': 0.5, 'mike-maignan': 0.35, 'david-de-gea': 0.2, 'keylor-navas': 0.25, 'hugo-lloris': 0.25,
  'gianluigi-donnarumma': 0.35, 'jordan-pickford': 0.45, ederson: 0.2, 'jose-luis-chilavert': 0.2, 'julio-cesar': 0.4, 'claudio-taffarel': 0.45,
  'victor-valdes': 0.2, 'sepp-maier': 0.3, 'dino-zoff': 0.25, 'oliver-kahn': 0.3, 'jens-lehmann': 0.35, 'rui-patricio': 0.4,
};

function clampRange(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export const TRAIT_OVERRIDE_KEYS = [...Object.keys(DISC), ...Object.keys(PK), ...Object.keys(FK), ...Object.keys(PKS)];

const cache = new Map<string, Traits>();

export function traits(p: Player | string): Traits {
  const pl = typeof p === 'string' ? player(p) : p;
  const hit = cache.get(pl.id);
  if (hit) return hit;
  const o: Partial4 = {
    disc: DISC[pl.id],
    pk: PK[pl.id],
    fk: FK[pl.id],
    pks: PKS[pl.id],
  };
  const t: Traits = {
    disc: clampRange(o.disc ?? 1, 0.1, 3),
    pk: clampRange(o.pk ?? PK_DEFAULT[pl.pos], 0, 1),
    fk: clampRange(o.fk ?? FK_DEFAULT[pl.pos], 0, 1),
    pks: clampRange(o.pks ?? 0.2, 0, 1),
  };
  cache.set(pl.id, t);
  return t;
}
