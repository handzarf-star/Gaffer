// Which players can show up in a draft: a source (Modern Stars, Hall of Legends, Everyone, Premier League, Balkans) crossed
// with eras. Everything here is recollection, not data: who played in the Premier League, and which decade a retired
// player peaked in, are my own rough judgement calls. They give the flavour of a themed draft, not a record book.
// Edit the lists below and `npm test` checks every name still matches a real player.

import { getWorld } from './career/data';
import { PLAYERS, STAR_BANDS, player, slug, type Player, type Pos, type TierBands } from './players';

export type PoolId = 'bl' | 'modern' | 'legends' | 'all' | 'epl' | 'balkan';
export type EraId = 'classic' | '80s' | '90s' | '00s' | '10s' | 'now';
/** one or more pools, an era filter and a country filter in one string, e.g. "epl@90s,00s" or "bl+all@now#BIH,CRO". Lets every deal and every CPU draft take a single value. */
export type PoolKey = string;

export const POOLS: Record<PoolId, { id: PoolId; name: string; blurb: string }> = {
  bl: { id: 'bl', name: 'Balkan League', blurb: 'Today\'s real squads of 32 clubs from Bosnia, Croatia and Serbia' },
  modern: { id: 'modern', name: 'Modern Stars', blurb: 'Players from the last few seasons' },
  legends: { id: 'legends', name: 'Hall of Legends', blurb: 'Retired greats from every era' },
  all: { id: 'all', name: 'Everyone', blurb: 'Legends and modern stars in one draft' },
  epl: { id: 'epl', name: 'Premier League', blurb: 'Anyone who played in the English top flight' },
  balkan: { id: 'balkan', name: 'Balkans', blurb: 'Bosnia, Croatia and Serbia, with league players too' },
};
export const POOL_IDS = Object.keys(POOLS) as PoolId[];
/** what the lobby offers up front: real leagues first, then the stars. The other ids are older themed pools and still work. */
export const LOBBY_POOLS: PoolId[] = ['bl', 'epl', 'all'];
/** pools made of the hand-rated stars; everything else is a sourced league */
const STAR_POOLS: ReadonlySet<PoolId> = new Set(['modern', 'legends', 'all', 'epl', 'balkan']);
/** the three pools the solo cup and daily draft use */
export const BASE_POOL_IDS: PoolId[] = ['modern', 'legends', 'all'];

export const ERAS: Record<EraId, { id: EraId; name: string }> = {
  classic: { id: 'classic', name: 'Up to the 70s' },
  '80s': { id: '80s', name: '1980s' },
  '90s': { id: '90s', name: '1990s' },
  '00s': { id: '00s', name: '2000s' },
  '10s': { id: '10s', name: '2010s' },
  now: { id: 'now', name: 'Today' },
};
export const ERA_IDS = Object.keys(ERAS) as EraId[];

/* ───────────── recollection: the decade a retired player peaked in ───────────── */
const DECADE_NAMES: Record<Exclude<EraId, 'now'>, string> = {
  classic: `Lev Yashin; Gordon Banks; Dino Zoff; Sepp Maier; Ubaldo Fillol; Gilmar; Franz Beckenbauer; Bobby Moore; Daniel Passarella; Gaetano Scirea; Ruud Krol; Nilton Santos; Giacinto Facchetti; Paul Breitner; Mario Zagallo; Carlos Alberto Torres; Djalma Santos; Berti Vogts; Cesare Maldini; Nobby Stiles; Johan Neeskens; Didi; Bobby Charlton; Gerson; Gianni Rivera; Sandro Mazzola; Teofilo Cubillas; Roberto Rivelino; Jairzinho; Garrincha; Stanley Matthews; Pele; Johan Cruyff; Gerd Muller; Eusebio; Ferenc Puskas; Alfredo Di Stefano; Jimmy Greaves; Denis Law; Just Fontaine; Tostao; Kevin Keegan; Mario Kempes`,
  '80s': `Peter Shilton; Neville Southall; Thomas N'Kono; Jean-Marie Pfaff; Walter Zenga; Alan Hansen; Frank Rijkaard; Socrates; Falcao; Marco Tardelli; Bryan Robson; Michel Platini; Zico; Ruud Gullit; Diego Maradona; Paulo Futre; Chris Waddle; Marco van Basten; Gary Lineker; Paolo Rossi; Rudi Voller; Karl-Heinz Rummenigge; Hugo Sanchez; Kenny Dalglish; Ian Rush; Roberto Pruzzo`,
  '90s': `Peter Schmeichel; Fabien Barthez; Angelo Peruzzi; Claudio Taffarel; Jose Luis Chilavert; Gianluca Pagliuca; Michel Preud'homme; Andoni Zubizarreta; Packie Bonner; Jorge Campos; Paolo Maldini; Franco Baresi; Lilian Thuram; Laurent Blanc; Marcel Desailly; Ronald Koeman; Jaap Stam; Fernando Hierro; Tony Adams; Aldair; Matthias Sammer; Andreas Brehme; Stuart Pearce; Denis Irwin; Graeme Le Saux; Michael Reiziger; Lothar Matthaus; Fernando Redondo; Dunga; Roy Keane; Demetrio Albertini; Didier Deschamps; Emmanuel Petit; Edgar Davids; Mauro Silva; Paul Ince; Stefan Effenberg; Gheorghe Popescu; Hidetoshi Nakata; Roberto Baggio; Dennis Bergkamp; Gheorghe Hagi; Rui Costa; Jay-Jay Okocha; Alessandro Del Piero; Carlos Valderrama; Enzo Francescoli; Paul Gascoigne; Michael Laudrup; Brian Laudrup; Matt Le Tissier; Ryan Giggs; Hristo Stoichkov; Marc Overmars; Ariel Ortega; Ronaldo Nazario; Romario; Gabriel Batistuta; Alan Shearer; Gianluca Vialli; Jurgen Klinsmann; George Weah; Davor Suker; Roger Milla; Teddy Sheringham; Eric Cantona; Andy Cole; Steve McManaman; Ally McCoist`,
  '00s': `Gianluigi Buffon; Iker Casillas; Oliver Kahn; Edwin van der Sar; Petr Cech; Jens Lehmann; Victor Valdes; Pepe Reina; Rogerio Ceni; Fabio Cannavaro; Alessandro Nesta; Carles Puyol; Rio Ferdinand; John Terry; Nemanja Vidic; Roberto Ayala; Walter Samuel; Lucio; Ricardo Carvalho; Roberto Carlos; Ashley Cole; Bixente Lizarazu; Patrice Evra; Giovanni van Bronckhorst; Eric Abidal; Cafu; Javier Zanetti; Gianluca Zambrotta; Maicon; Gary Neville; Claude Makelele; Patrick Vieira; Gennaro Gattuso; Marcos Senna; Michael Essien; Gilberto Silva; Owen Hargreaves; Mark van Bommel; Daniele De Rossi; Xavi; Paul Scholes; Steven Gerrard; Frank Lampard; Andrea Pirlo; Clarence Seedorf; Michael Ballack; Pavel Nedved; Michael Carrick; Park Ji-sung; Juninho Pernambucano; Zinedine Zidane; Rivaldo; Kaka; Juan Roman Riquelme; Deco; Francesco Totti; Pablo Aimar; Ricardo Quaresma; Ronaldinho; Robert Pires; Andrei Arshavin; Luis Figo; David Beckham; Shaun Wright-Phillips; Damien Duff; Thierry Henry; Raul; Hernan Crespo; Michael Owen; Ruud van Nistelrooy; Andriy Shevchenko; Filippo Inzaghi; Christian Vieri; Miroslav Klose; Fernando Torres; Didier Drogba; Samuel Eto'o; Luca Toni; Dirk Kuyt; Joaquin; Aaron Lennon; Joe Cole; Ryan Babel; Rafael van der Vaart; Glen Johnson; Gael Clichy; Fabio Grosso; Pedro Pauleta; Robin van Persie`,
  '10s': `Joe Hart; Julio Cesar; Gerard Pique; Pepe; Jerome Boateng; Mats Hummels; Diego Godin; Giorgio Chiellini; Leonardo Bonucci; Kalidou Koulibaly; Raphael Varane; Vincent Kompany; Marcelo; Maxwell; Fabio Coentrao; Leighton Baines; Philipp Lahm; Dani Alves; Branislav Ivanovic; Alvaro Arbeloa; Sergio Busquets; Xabi Alonso; Javier Mascherano; Nigel de Jong; Andres Iniesta; Bastian Schweinsteiger; Toni Kroos; Thiago Alcantara; Cesc Fabregas; Yaya Toure; Sami Khedira; Ivan Rakitic; Mohamed Elneny; Mikel Arteta; Mesut Ozil; Wesley Sneijder; David Silva; Shinji Kagawa; Juan Mata; Isco; James Rodriguez; Javier Pastore; Eden Hazard; Franck Ribery; Alexis Sanchez; Pedro Rodriguez; Douglas Costa; Lukas Podolski; Dimitri Payet; Arjen Robben; Gareth Bale; Angel Di Maria; Willian; Antonio Di Natale; Juan Cuadrado; Zlatan Ibrahimovic; Wayne Rooney; David Villa; Diego Forlan; Luis Suarez; Sergio Aguero; Carlos Tevez; Gonzalo Higuain; Edinson Cavani; Radamel Falcao; Mario Mandzukic; Jamie Vardy; Klaas-Jan Huntelaar; Antonio Candreva; Jesus Navas; Nani; Ashley Young; Bacary Sagna; Pablo Zabaleta; Juanfran`,
};

/* ───────────── recollection: who has played in the Premier League (any time since 1992) ───────────── */
const PL_NAMES = `Peter Schmeichel; Edwin van der Sar; Petr Cech; Fabien Barthez; Jens Lehmann; Pepe Reina; Joe Hart; Neville Southall; Julio Cesar; Rio Ferdinand; John Terry; Nemanja Vidic; Laurent Blanc; Marcel Desailly; Jaap Stam; Fernando Hierro; Jerome Boateng; Kalidou Koulibaly; Raphael Varane; Vincent Kompany; Tony Adams; Ricardo Carvalho; Ashley Cole; Stuart Pearce; Patrice Evra; Giovanni van Bronckhorst; Leighton Baines; Denis Irwin; Graeme Le Saux; Gary Neville; Branislav Ivanovic; Alvaro Arbeloa; Maicon; Bacary Sagna; Pablo Zabaleta; Glen Johnson; Gael Clichy; Claude Makelele; Roy Keane; Patrick Vieira; Xabi Alonso; Javier Mascherano; Didier Deschamps; Emmanuel Petit; Edgar Davids; Michael Essien; Gilberto Silva; Paul Ince; Owen Hargreaves; Nigel de Jong; Paul Scholes; Steven Gerrard; Frank Lampard; Bryan Robson; Michael Ballack; Bastian Schweinsteiger; Thiago Alcantara; Cesc Fabregas; Yaya Toure; Michael Carrick; Gheorghe Popescu; Hidetoshi Nakata; Park Ji-sung; Mohamed Elneny; Mikel Arteta; Dennis Bergkamp; Deco; Ruud Gullit; Mesut Ozil; David Silva; Jay-Jay Okocha; Paul Gascoigne; Michael Laudrup; Brian Laudrup; Shinji Kagawa; Juan Mata; James Rodriguez; Matt Le Tissier; Ricardo Quaresma; Ryan Giggs; Eden Hazard; Marc Overmars; Robert Pires; Andrei Arshavin; Alexis Sanchez; Pedro Rodriguez; Paulo Futre; Lukas Podolski; Dimitri Payet; Arjen Robben; David Beckham; Gareth Bale; Angel Di Maria; Chris Waddle; Willian; Juan Cuadrado; Shaun Wright-Phillips; Damien Duff; Thierry Henry; Zlatan Ibrahimovic; Hernan Crespo; Alan Shearer; Michael Owen; Wayne Rooney; Ruud van Nistelrooy; Andriy Shevchenko; Gianluca Vialli; Jurgen Klinsmann; Fernando Torres; Diego Forlan; Luis Suarez; Didier Drogba; Samuel Eto'o; George Weah; Davor Suker; Ian Rush; Sergio Aguero; Carlos Tevez; Gonzalo Higuain; Edinson Cavani; Radamel Falcao; Robin van Persie; Teddy Sheringham; Jamie Vardy; Eric Cantona; Andy Cole; Dirk Kuyt; Aaron Lennon; Jesus Navas; Steve McManaman; Nani; Joe Cole; Ashley Young; Ryan Babel; Rafael van der Vaart;
Thibaut Courtois; Alisson; Ederson; Gianluigi Donnarumma; Emiliano Martinez; David de Gea; Hugo Lloris; Keylor Navas; Kasper Schmeichel; David Raya; Jordan Pickford; Aaron Ramsdale; Bernd Leno; Andre Onana; Kepa Arrizabalaga; Robert Sanchez; Dean Henderson; Lukasz Fabianski; Bart Verbruggen; Rui Patricio; Matt Turner; Virgil van Dijk; Ruben Dias; Antonio Rudiger; Josko Gvardiol; William Saliba; Matthijs de Ligt; Gabriel Magalhaes; Aymeric Laporte; John Stones; Harry Maguire; Ibrahima Konate; Micky van de Ven; Levi Colwill; Marc Guehi; Cristian Romero; Lisandro Martinez; Nicolas Otamendi; Nathan Ake; Fikayo Tomori; Leny Yoro; Piero Hincapie; Kevin Danso; Sven Botman; Thiago Silva; Joel Matip; Jarrad Branthwaite; Trevoh Chalobah; Jurrien Timber; Andrew Robertson; Joao Cancelo; Destiny Udogie; Luke Shaw; Ben Chilwell; Marc Cucurella; Oleksandr Zinchenko; Rayan Ait-Nouri; Kieran Tierney; Trent Alexander-Arnold; Kyle Walker; Reece James; Jeremie Frimpong; Pedro Porro; Kieran Trippier; Ben White; Danilo; Noussair Mazraoui; Diogo Dalot; Malo Gusto; Wesley Fofana; Matty Cash; Rodri; Declan Rice; Casemiro; Fabinho; N'Golo Kante; Martin Zubimendi; Jorginho; Wilfred Ndidi; Sandro Tonali; Ruben Neves; Granit Xhaka; Moises Caicedo; Alexis Mac Allister; Enzo Fernandez; Amadou Onana; Joao Palhinha; Edson Alvarez; Scott McTominay; Bruno Guimaraes; Pape Matar Sarr; Sofyan Amrabat; Thomas Partey; Adam Wharton; Douglas Luiz; Idrissa Gueye; Kevin De Bruyne; Bernardo Silva; Ilkay Gundogan; Dominik Szoboszlai; Youri Tielemans; Mateo Kovacic; Mason Mount; Conor Gallagher; Kobbie Mainoo; Christian Eriksen; Pierre-Emile Hojbjerg; Tyler Adams; Rodrigo Bentancur; Manuel Ugarte; Giovani Lo Celso; Mikel Merino; Ryan Gravenberch; Tijjani Reijnders; Lewis Miley; Matteo Guendouzi; Bruno Fernandes; Martin Odegaard; Florian Wirtz; Phil Foden; Lucas Paqueta; Rayan Cherki; Xavi Simons; Joao Felix; Cole Palmer; Jack Grealish; Christopher Nkunku; Emile Smith Rowe; Eberechi Eze; Morgan Gibbs-White; Hakim Ziyech; Matheus Cunha; Son Heung-min; Sadio Mane; Leroy Sane; Gabriel Martinelli; Marcus Rashford; Jadon Sancho; Raheem Sterling; Anthony Gordon; Luis Diaz; Alejandro Garnacho; Cody Gakpo; Kaoru Mitoma; Jeremy Doku; Federico Chiesa; Leandro Trossard; Ferran Torres; Noni Madueke; Anthony Elanga; Gabriel Jesus; Christian Pulisic; Ademola Lookman; Mohamed Salah; Raphinha; Bukayo Saka; Riyad Mahrez; Michael Olise; Mohammed Kudus; Bryan Mbeumo; Antony; Savinho; Yeremy Pino; Pedro Neto; Ivan Perisic; Dejan Kulusevski; Alex Iwobi; Amad Diallo; Ritsu Doan; Anthony Martial; Cristiano Ronaldo; Harry Kane; Erling Haaland; Julian Alvarez; Darwin Nunez; Alexander Isak; Viktor Gyokeres; Ollie Watkins; Rasmus Hojlund; Alvaro Morata; Richarlison; Roberto Firmino; Randal Kolo Muani; Jhon Duran; Kai Havertz; Niclas Fullkrug; Romelu Lukaku; Ivan Toney; Dominic Solanke; Benjamin Sesko; Hugo Ekitike; Memphis Depay; Brian Brobbey; Joshua Zirkzee; Aleksandar Mitrovic; Nicolas Jackson; Sebastien Haller; Olivier Giroud; Raul Jimenez; Jean-Philippe Mateta; Evan Ferguson; Tammy Abraham; Callum Wilson; Ayoze Perez; Takumi Minamino; Hwang Hee-chan; Timo Werner; Folarin Balogun; Alexandre Lacazette; Enner Valencia`;

const idsOf = (names: string): string[] => names.split(';').map((n) => n.trim()).filter(Boolean).map(slug);
const DECADE_OF = new Map<string, EraId>();
for (const [era, names] of Object.entries(DECADE_NAMES)) for (const id of idsOf(names)) DECADE_OF.set(id, era as EraId);
const PL_IDS = new Set(idsOf(PL_NAMES));
export const DATA_CHECK = { decadeIds: [...DECADE_OF.keys()], plIds: [...PL_IDS] };

export const BALKAN_NATS = new Set(['BIH', 'CRO', 'SRB']);

/** the era a player belongs to for filtering: today's players are "Today", retired ones their peak decade */
export function eraOf(p: Player): EraId {
  if (p.era === 'M') return 'now';
  return DECADE_OF.get(p.id) ?? '00s';
}
export const inPremierLeague = (p: Player): boolean => PL_IDS.has(p.id);
export const hasDecade = (id: string): boolean => DECADE_OF.has(id);

/* ───────────── pool keys and filtering ───────────── */

/**
 * The sourced Balkan League squads as draft cards. They are the career world's players (registered with the match engine when the world
 * is built), so `player(id)` knows them everywhere this module is loaded: the room engine, the worker and the client.
 */
const LEAGUE_PLAYERS: readonly Player[] = getWorld().players.map((p) => player(p.id));

export function poolKey(pools: PoolId | readonly PoolId[], eras: readonly EraId[] = [], nations: readonly string[] = []): PoolKey {
  const list = typeof pools === 'string' ? [pools] : [...new Set(pools)].filter((x) => x in POOLS).sort((a, b) => POOL_IDS.indexOf(a) - POOL_IDS.indexOf(b));
  const e = [...new Set(eras)].filter((x) => x in ERAS).sort((a, b) => ERA_IDS.indexOf(a) - ERA_IDS.indexOf(b));
  const n = [...new Set(nations)].filter((x) => /^[A-Z]{3}$/.test(x)).sort();
  return `${list.length ? list.join('+') : 'all'}${e.length && e.length < ERA_IDS.length ? `@${e.join(',')}` : ''}${n.length ? `#${n.join(',')}` : ''}`;
}
export function parsePoolKey(key: PoolKey): { pool: PoolId; pools: PoolId[]; eras: EraId[]; nations: string[] } {
  const [head, nat] = key.split('#');
  const [base, e] = (head ?? '').split('@');
  const pools = (base ?? '').split('+').filter((x): x is PoolId => x in POOLS);
  if (pools.length === 0) pools.push('all');
  const eras = e ? (e.split(',').filter((x) => x in ERAS) as EraId[]) : [];
  const nations = nat ? nat.split(',').filter((x) => /^[A-Z]{3}$/.test(x)) : [];
  return { pool: pools[0]!, pools, eras, nations };
}

const sourceOk = (pool: PoolId, p: Player): boolean => {
  if (p.only) return pool === 'balkan';
  switch (pool) {
    case 'modern': return p.era === 'M';
    case 'legends': return p.era === 'L';
    case 'all': return true;
    case 'epl': return inPremierLeague(p);
    case 'balkan': return BALKAN_NATS.has(p.nat);
    case 'bl': return false; // league players are not in PLAYERS
  }
};

/** Everyone a set of pools holds, before the era and country filters. A footballer who is both a star and in a league squad appears once: the star entry. */
function sourcePlayers(pools: readonly PoolId[]): Player[] {
  const out = PLAYERS.filter((p) => pools.some((pool) => sourceOk(pool, p)));
  if (pools.includes('bl')) {
    const stars = new Set(out.map((p) => p.id));
    for (const p of LEAGUE_PLAYERS) if (!stars.has(slug(p.name))) out.push(p);
  }
  return out;
}

const cache = new Map<PoolKey, Player[]>();
export function poolPlayers(key: PoolKey): Player[] {
  let list = cache.get(key);
  if (!list) {
    const { pools, eras, nations } = parsePoolKey(key);
    list = sourcePlayers(pools).filter((p) => (eras.length === 0 || eras.includes(eraOf(p))) && (nations.length === 0 || nations.includes(p.nat)));
    cache.set(key, list);
  }
  return list.slice();
}

/** does the mix contain hand-rated stars (then cards are graded on the stars' thresholds), or only sourced league players? */
export const poolHasStars = (key: PoolKey): boolean => parsePoolKey(key).pools.some((p) => STAR_POOLS.has(p));

const bandCache = new Map<PoolKey, TierBands>();
/**
 * Where bronze, silver, gold and icon begin for this mix. Star pools use the fixed thresholds. A pool of league players only is graded
 * against itself (top 3% icon, next 17% gold, next 40% silver): on the stars' thresholds every one of them would be bronze, and a
 * pack where every card looks the same is not a pack.
 */
export function poolBands(key: PoolKey): TierBands {
  if (poolHasStars(key)) return STAR_BANDS;
  let b = bandCache.get(key);
  if (!b) {
    const sorted = poolPlayers(key).map((p) => p.ovr).sort((x, y) => y - x);
    const at = (share: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;
    b = sorted.length ? [at(0.6), at(0.2), at(0.03)] : STAR_BANDS;
    bandCache.set(key, b);
  }
  return b;
}

/** how many players each era has inside a mix, so the lobby can grey out eras that would be empty */
export function eraCounts(pools: PoolId | readonly PoolId[], nations: readonly string[] = []): Record<EraId, number> {
  const out = Object.fromEntries(ERA_IDS.map((e) => [e, 0])) as Record<EraId, number>;
  for (const p of sourcePlayers(typeof pools === 'string' ? [pools] : pools)) if (nations.length === 0 || nations.includes(p.nat)) out[eraOf(p)]++;
  return out;
}

/** the countries in a mix (with the eras applied) and how many players each has, biggest first */
export function nationCounts(pools: readonly PoolId[], eras: readonly EraId[] = []): Array<[nat: string, players: number]> {
  const m = new Map<string, number>();
  for (const p of poolPlayers(poolKey(pools, eras))) m.set(p.nat, (m.get(p.nat) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

/* ───────────── is there enough to draft from? ───────────── */

const LINES: Record<'gk' | 'def' | 'mid' | 'att', Pos[]> = { gk: ['GK'], def: ['CB', 'LB', 'RB'], mid: ['CDM', 'CM', 'CAM'], att: ['LW', 'RW', 'ST'] };

export interface PoolHealth {
  ok: boolean;
  players: number;
  /** a sentence for the lobby when the mix is too thin */
  problem: string | null;
}

/** every team needs a keeper, four defenders, three midfielders and three attackers, with a little room to choose */
export function poolHealth(key: PoolKey, teams: number): PoolHealth {
  const list = poolPlayers(key);
  const count = (ps: Pos[]) => list.filter((p) => ps.includes(p.pos)).length;
  const need = { gk: teams + 1, def: teams * 4 + 2, mid: teams * 3 + 2, att: teams * 3 + 2 };
  const short = (Object.keys(LINES) as Array<keyof typeof LINES>).filter((l) => count(LINES[l]) < need[l]);
  if (list.length >= teams * 11 + 12 && short.length === 0) return { ok: true, players: list.length, problem: null };
  const names = { gk: 'goalkeepers', def: 'defenders', mid: 'midfielders', att: 'attackers' };
  return {
    ok: false,
    players: list.length,
    problem: `Only ${list.length} players here${short.length ? `, and too few ${short.map((l) => names[l]).join(' and ')}` : ''}, which is thin for ${teams} teams. Add another era or choose a bigger pool.`,
  };
}
