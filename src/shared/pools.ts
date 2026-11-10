// Which players can show up in a draft: a source (Modern Stars, Hall of Legends, Everyone, Premier League, Balkans) crossed
// with eras. Everything here is recollection, not data: who played in the Premier League, and which decade a retired
// player peaked in, are my own rough judgement calls. They give the flavour of a themed draft, not a record book.
// Edit the lists below and `npm test` checks every name still matches a real player.

import { PLAYERS, slug, type Player, type Pos } from './players';

export type PoolId = 'modern' | 'legends' | 'all' | 'epl' | 'balkan';
export type EraId = 'classic' | '80s' | '90s' | '00s' | '10s' | 'now';
/** a pool plus its era filter in one string, e.g. "epl@90s,00s". Lets every deal and every CPU draft take a single value. */
export type PoolKey = string;

export const POOLS: Record<PoolId, { id: PoolId; name: string; blurb: string }> = {
  modern: { id: 'modern', name: 'Modern Stars', blurb: 'Players from the last few seasons' },
  legends: { id: 'legends', name: 'Hall of Legends', blurb: 'Retired greats from every era' },
  all: { id: 'all', name: 'Everyone', blurb: 'Legends and modern stars in one draft' },
  epl: { id: 'epl', name: 'Premier League', blurb: 'Anyone who played in the English top flight' },
  balkan: { id: 'balkan', name: 'Balkans', blurb: 'Bosnia, Croatia and Serbia, with league players too' },
};
export const POOL_IDS = Object.keys(POOLS) as PoolId[];
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

export function poolKey(pool: PoolId, eras: readonly EraId[] = []): PoolKey {
  const e = [...new Set(eras)].filter((x) => x in ERAS).sort((a, b) => ERA_IDS.indexOf(a) - ERA_IDS.indexOf(b));
  return e.length && e.length < ERA_IDS.length ? `${pool}@${e.join(',')}` : pool;
}
export function parsePoolKey(key: PoolKey): { pool: PoolId; eras: EraId[] } {
  const [base, e] = key.split('@');
  const pool = (base && base in POOLS ? base : 'all') as PoolId;
  const eras = e ? (e.split(',').filter((x) => x in ERAS) as EraId[]) : [];
  return { pool, eras };
}

const sourceOk = (pool: PoolId, p: Player): boolean => {
  if (p.only) return pool === 'balkan';
  switch (pool) {
    case 'modern': return p.era === 'M';
    case 'legends': return p.era === 'L';
    case 'all': return true;
    case 'epl': return inPremierLeague(p);
    case 'balkan': return BALKAN_NATS.has(p.nat);
  }
};

const cache = new Map<PoolKey, Player[]>();
export function poolPlayers(key: PoolKey): Player[] {
  let list = cache.get(key);
  if (!list) {
    const { pool, eras } = parsePoolKey(key);
    list = PLAYERS.filter((p) => sourceOk(pool, p) && (eras.length === 0 || eras.includes(eraOf(p))));
    cache.set(key, list);
  }
  return list.slice();
}

/** how many players each era has inside a pool, so the lobby can grey out eras that would be empty */
export function eraCounts(pool: PoolId): Record<EraId, number> {
  const out = Object.fromEntries(ERA_IDS.map((e) => [e, 0])) as Record<EraId, number>;
  for (const p of PLAYERS) if (sourceOk(pool, p)) out[eraOf(p)]++;
  return out;
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
