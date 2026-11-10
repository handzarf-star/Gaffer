// Bosnian match commentary, aligned line by line with the English templates in sim.ts (same groups, same order, same {placeholders}).
// Names are always used in the nominative: Bosnian would decline them ("nad Perišićem"), and we cannot decline arbitrary names correctly,
// so the sentences are built so that no name needs a different case.
export const COMMENTARY_BS: Record<string, string[]> = {
  goal: [
    '{p} to završava. Gol za {t}!',
    'GOOOL! {p} je sjajno pogodio za {t}.',
    '{p} zakopava loptu u mrežu. Golman nije imao šanse.',
    'Hladnokrvno, {p}! {t} slavi.',
    '{p} stvara prostor i puca u mrežu.',
    'Prelijepa akcija, a na kraju je tu {p}.',
  ],
  goalAssist: [
    '{a} ga pronalazi i {p} ne griješi.',
    '{a} probija loptu kroz odbranu, {p} je ubacuje u mrežu.',
    'Prekrasna lopta, {a}. {p} završava akciju.',
    '{a} centrira, {p} se oslobađa čuvara i zabija.',
    'Odličan posao, {a}, a {p} stavlja tačku na akciju.',
  ],
  goalFk: [
    '{p} podiže slobodni udarac preko zida u ugao!',
    'Kakav slobodnjak, {p}! Golman se nije ni pomakao.',
    '{p} zavija loptu oko zida. Neodbranjivo.',
  ],
  goalPen: [
    '{p} šalje golmana u pogrešnu stranu. Penal pogođen.',
    '{p} prilazi i sigurno realizuje penal.',
    'Potpuno hladnokrvno, {p}. Penal realizovan.',
  ],
  goalCorner: [
    'Korner je ubačen, a {p} najviše skače i glavom ga šalje u mrežu!',
    '{p} snažno glavom pogađa nakon korner udarca.',
    'Nije lijepo, ali važi: {p} gura loptu u mrežu poslije korner udarca.',
  ],
  save: [
    '{k} se sjajno baca i brani udarac. Pokušao je {p}.',
    '{p} puca, ali {k} odbija loptu.',
    'Velika odbrana, {k}! {p} ne može vjerovati.',
    '{k} prstima skreće loptu oko stative. Udarac: {p}.',
  ],
  saveFk: [
    '{k} izbacuje slobodnjak. Izvodio ga je {p}.',
    '{p} dobro puca, ali {k} je na mjestu i brani.',
  ],
  savePen: [
    '{k} pogađa stranu i brani penal! Izvodio ga je {p}.',
    'PENAL ODBRANJEN! Heroj je {k}, {p} ostaje bez gola.',
  ],
  saveCorner: [
    '{k} pod pritiskom šakama izbacuje loptu poslije korner udarca.',
    '{p} puca glavom, {k} brani.',
  ],
  miss: [
    '{p} je imao priliku, ali puca visoko iznad grede.',
    '{p} iz dobre pozicije puca pored gola.',
    'Rasipnički, {p}. Ovo se moralo iskoristiti.',
    '{p} puca snagom i gubi kontrolu nad loptom.',
  ],
  missFk: [
    '{p} šalje slobodnjak u zid.',
    '{p} diže slobodnjak preko grede.',
    'Slobodnjak koji izvodi {p} ide pored gola.',
  ],
  missPen: [
    '{p} šutira penal preko grede!',
    '{p} penal šalje pored gola. Katastrofa.',
  ],
  missCorner: [
    'Glavom puca {p}, ali lopta ide tik iznad.',
    '{p} ne uspijeva spustiti loptu glavom.',
  ],
  post: [
    '{p} pogađa okvir gola!',
    'U stativu! {p} je bio na centimetre.',
    '{p} pogađa prečku. Tako blizu.',
  ],
  yellow: [
    '{p} ide u bilježnicu zbog prekršaja.',
    'Žuti karton za {p} nakon kasnog starta.',
    '{p} dobija karton zbog povlačenja protivnika.',
  ],
  red: [
    'CRVENI KARTON! {p} je isključen.',
    '{p} dobija crveni. {t} ostaje s desetoricom.',
    'Direktan crveni karton za {p}. Katastrofa.',
  ],
  red2: [
    'Drugi žuti za {p}, a to je crveni. {t} ostaje s desetoricom.',
    '{p} ponovo dobija karton i mora napustiti teren!',
  ],
  fk: [
    'Opasan slobodni udarac, a loptu postavlja {p}.',
    'Prekršaj na rubu šesnaesterca. Slobodnjak će izvoditi {p}.',
    'Slobodni udarac s dobre pozicije za {t}. Izvodi {p}.',
  ],
  pen: [
    'PENAL! Prekršaj u šesnaestercu.',
    'Penal za {t}! Igrač pada nakon starta.',
    'Sudija pokazuje na bijelu tačku. Igrač je srušen.',
  ],
  corner: [
    'Korner za {t}. Lopta se ubacuje u gust šesnaesterac.',
    '{t} osvaja korner i šalje sve naprijed.',
  ],
};

/** Events whose text is fixed rather than picked from a group. */
export const FIXED_BS: Record<string, string> = {
  kickoff: 'Početak utakmice: {a} – {b}.',
  half: 'Poluvrijeme: {a} {x}-{y} {b}.',
  full: 'Kraj utakmice: {a} {x}-{y} {b}.',
  et: 'Neriješeno nakon 90 minuta. Produžeci.',
  etend: 'Poslije produžetaka: {x}-{y}.',
  shootout: 'Penali. Potrebni su čelični živci.',
  pen_goal: '{p} pogađa. {x}-{y}.',
  pen_miss: '{p} promašuje! {x}-{y}.',
};
