// The clubs of the season mode and the exact Wikipedia article each one is read from.
// `league` is a game decision (which clubs make the First League), not a claim about real-world league membership.
// Titles are resolved through Wikipedia redirects; the fetch step reports any that do not resolve to an article.
export const CLUBS = [
  { id: 'dinamo-zagreb', name: 'Dinamo Zagreb', country: 'HR', page: 'GNK Dinamo Zagreb', league: 1 },
  { id: 'crvena-zvezda', name: 'Crvena Zvezda', country: 'RS', page: 'FK Crvena zvezda', league: 1 },
  { id: 'partizan', name: 'Partizan', country: 'RS', page: 'FK Partizan', league: 1 },
  { id: 'hajduk', name: 'Hajduk Split', country: 'HR', page: 'HNK Hajduk Split', league: 1 },
  { id: 'zeljeznicar', name: 'Željezničar', country: 'BA', page: 'FK Željezničar Sarajevo', league: 1 },
  { id: 'sarajevo', name: 'Sarajevo', country: 'BA', page: 'FK Sarajevo', league: 1 },
  { id: 'rijeka', name: 'Rijeka', country: 'HR', page: 'HNK Rijeka', league: 1 },
  { id: 'osijek', name: 'Osijek', country: 'HR', page: 'NK Osijek', league: 1 },
  { id: 'varazdin', name: 'Varaždin', country: 'HR', page: 'NK Varaždin (2012)', league: 1 },
  { id: 'vojvodina', name: 'Vojvodina', country: 'RS', page: 'FK Vojvodina', league: 1 },
  { id: 'cukaricki', name: 'Čukarički', country: 'RS', page: 'FK Čukarički', league: 1 },
  { id: 'imt', name: 'IMT', country: 'RS', page: 'FK IMT', league: 1 },
  { id: 'novi-pazar', name: 'Novi Pazar', country: 'RS', page: 'FK Novi Pazar', league: 1 },
  { id: 'zrinjski', name: 'Zrinjski Mostar', country: 'BA', page: 'HŠK Zrinjski Mostar', league: 1 },
  { id: 'borac', name: 'Borac Banja Luka', country: 'BA', page: 'FK Borac Banja Luka', league: 1 },
  { id: 'siroki-brijeg', name: 'Široki Brijeg', country: 'BA', page: 'NK Široki Brijeg', league: 1 },
];
