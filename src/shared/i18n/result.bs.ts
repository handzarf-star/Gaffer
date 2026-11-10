// Bosnian (ijekavian) texts for the two English lines a match result carries: the one-line headline and the man-of-the-match reason.
// They are aligned with HEADLINES and REASONS in sim.ts: same groups, same order, same {placeholders}.
// Team and player names are always used in the nominative: Bosnian would decline them ("nad Perišićem"), and we cannot decline arbitrary
// names correctly, so each sentence is built so that no name needs another case (colons, commas and a verb in the third person singular,
// as in commentary.bs.ts). That is also why a team is always followed by a singular verb, whatever its name.

/** Headlines: group -> lines, in the order of HEADLINES in sim.ts. The result's `hk` is "group:index". */
export const HEADLINE_BS: Record<string, readonly string[]> = {
  pens: [
    '{wn} preživljava raspucavanje penala, {ws}-{ls}',
    'Drama na penalima: {wn} pobjeđuje sa bijele tačke',
    '{ln} tuguje, {wn} slavi nakon penala',
  ],
  hat: ['Hat-trick: {p} potapa protivnika, {ln} nema odgovora'],
  hatDraw: ['Hat-trick: {p} potapa protivnika'],
  upset: [
    'Šok! {wn} obara favorita',
    'Rušenje giganta: {ln} pada, {wn} pobjeđuje protiv svih očekivanja',
    'Iznenađenje dana: {wn} slavi, {ln} u šoku',
  ],
  penDecider: [
    'Penal odlučuje utakmicu, {wn} slavi',
    '{wn} slavi zahvaljujući penalu',
  ],
  lateWinner: [
    '{ln} tuguje: gol u posljednjim trenucima lomi srca',
    '{wn} otima pobjedu pred sami kraj',
    'Drama u nadoknadi vremena: {wn} slavi golom razlike',
  ],
  nilNil: ['Bez golova: ništa ih ne razdvaja'],
  draw: [
    'Neriješeno u pravom trileru',
    'Podjela bodova',
    'Sve izjednačeno na kraju utakmice',
  ],
  riot: [
    '{wn} nemilosrdno rastura protivnika',
    'Deklasiranje: {wn} {hi}-{lo} {ln}',
    '{ln} se raspada, {wn} ne zna za milost',
  ],
  cruise: [
    '{wn} lako stiže do pobjede, {ln} nema odgovora',
    '{wn} ima ugodno veče',
    '{wn} igra na višem nivou, {ln} ne može pratiti korak',
  ],
  feisty: [
    'Haos s crvenim kartonima, a {wn} ipak izlazi kao pobjednik',
    'Žestoka utakmica: {wn} odnosi pobjedu',
  ],
  et: [
    '{wn} za dlaku slavi u produžecima',
    'Gol u produžecima: {wn} ide dalje',
  ],
  goalfest: [
    'Festival golova! Svi su došli na svoje',
    '{wn} pobjeđuje u utakmici za pamćenje',
  ],
  oneNil: [
    '{wn} izvlači pobjedu 1-0',
    '{wn} slavi, jedan gol je dovoljan',
  ],
  win: [
    '{wn} odnosi bodove',
    '{wn} nadigrava protivnika, {ln} ostaje praznih ruku',
    '{wn} pobjeđuje u tijesnoj utakmici',
  ],
};

/**
 * Man-of-the-match reasons, keyed like REASONS in sim.ts. A phrase with a count {n} has three forms picked by the count:
 * [1, 21, 31 ... | 2-4, 22-24 ... | 0, 5-20, 25-30 ...], the same split tn() uses.
 */
export const REASON_BS: Record<string, string | readonly [string, string, string]> = {
  goal: '{n} gol',
  goals: ['{n} gol', '{n} gola', '{n} golova'],
  assist: '{n} asistencija',
  assists: ['{n} asistencija', '{n} asistencije', '{n} asistencija'],
  allRound: 'solidan nastup u svim segmentima',
  cleanSheet: 'čista mreža i {n} odbrana',
  cleanSheets: ['čista mreža i {n} odbrana', 'čista mreža i {n} odbrane', 'čista mreža i {n} odbrana'],
  rockSolid: 'stijena u odbrani',
  saves: ['{n} odbrana', '{n} odbrane', '{n} odbrana'],
};
