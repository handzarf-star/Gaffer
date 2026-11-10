import { describe, expect, it } from 'vitest';
import { cleanName, findTemplates, fold, parseFsPlayer, parseSquad, plainNote, splitArgs } from '../scripts/data/wikitext.mjs';

// Fixtures are trimmed copies of real Wikipedia markup (CC BY-SA), including the awkward bits.
const PAGE = `
==History==
{{Fs player|no=99|pos=FW|nat=XXX|name=Not In The Squad Section}}
==Players==
===Current squad===
{{Fs start}}
{{Fs player|no=1|pos=GK|nat=BIH|name=Tarik Abdulahović}}
{{Fs player|no=6|pos=MF|nat=SRB|name=[[Aleksa Pejić]]|other=[[Captain (association football)|captain]]}}
{{Fs player|no=4|pos=MF|nat=MNE|name=[[Mirko Ivanić]]|other=<small>[[Captain (association football)|captain]]</small>}}
{{Fs player|no=1|pos=GK|nat=BRA|name=[[Matheus (footballer, born March 1992)|Matheus]]}}
{{Fs player|no=5|pos=DF|nat=BIH|name=Amar Ibrišimović|other=on loan from [[FC Schalke 04 II|Schalke 04 II]]}}
{{Fs player|no=|pos=FW|nat=BIH|name=Aldian Korora}}
{{Fs mid}}
{{Fs player|no=23|pos=MF|nat=BIH|name=Eldar Dragović|other=vice-captain}}
{{Fs end}}

====Players with multiple nationalities====
* [[Someone Else]] holds two passports
{{Fs player|no=77|pos=MF|nat=AAA|name=Dual Citizen Table Row}}

===Out on loan===
{{Fs start}}
{{Fs player|no=17|pos=MF|nat=NGA|name=Olanrewaju Ibraheem|other=at [[NK Zvijezda Gradačac|Zvijezda Gradačac]] until 30 June 2027}}
{{Fs end}}

===Youth academy===
{{Fs player|no=50|pos=DF|nat=BIH|name=Kid Defender}}

==Club officials==
{{Fs player|no=88|pos=GK|nat=ZZZ|name=Coach Who Is Listed By Mistake}}
==Notable players==
{{Fs start}}
{{Fs player|no=10|pos=FW|nat=YUG|name=[[Retired Legend]]}}
{{Fs end}}
`;

describe('wikitext helpers', () => {
  it('splits arguments only on top-level pipes', () => {
    expect(splitArgs('Fs player|no=6|name=[[A|B]]|other={{small|x|y}}')).toEqual(['Fs player', 'no=6', 'name=[[A|B]]', 'other={{small|x|y}}']);
  });

  it('finds balanced templates, nested ones included', () => {
    const t = findTemplates('x {{Fs player|name=a|other={{small|n}}}} y {{Fs player|name=b}}', 'fs player');
    expect(t.map((x) => x.raw)).toEqual(['Fs player|name=a|other={{small|n}}', 'Fs player|name=b']);
  });

  it('cleans names and keeps the article link separate from the shown name', () => {
    expect(cleanName('[[Matheus (footballer, born March 1992)|Matheus]]')).toEqual({ name: 'Matheus', link: 'Matheus (footballer, born March 1992)' });
    expect(cleanName('[[Marin Karamarko]]')).toEqual({ name: 'Marin Karamarko', link: 'Marin Karamarko' });
    expect(cleanName('Tarik Abdulahović')).toEqual({ name: 'Tarik Abdulahović', link: null });
    expect(cleanName('[[Page#Section|Shown]]').link).toBe('Page');
  });

  it('reduces notes to plain text', () => {
    expect(plainNote('<small>[[Captain (association football)|captain]]</small>')).toBe('captain');
  });

  it('folds accents but never guesses spelling variants', () => {
    expect(fold('Ismaël Bennacer')).toBe('ismael bennacer');
    expect(fold('Željezničar')).toBe('zeljeznicar');
    expect(fold('Đorđe')).toBe('dorde');
    expect(fold('Djordje')).not.toBe(fold('Đorđe'));
  });
});

describe('parseFsPlayer', () => {
  it('reads captain, loan and missing number', () => {
    expect(parseFsPlayer('Fs player|no=6|pos=MF|nat=SRB|name=[[Aleksa Pejić]]|other=[[Captain (association football)|captain]]')).toMatchObject({ name: 'Aleksa Pejić', link: 'Aleksa Pejić', no: 6, pos: 'MF', nat: 'SRB', captain: true, loanFrom: null });
    expect(parseFsPlayer('Fs player|no=5|pos=DF|nat=BIH|name=Amar Ibrišimović|other=on loan from [[FC Schalke 04 II|Schalke 04 II]]')).toMatchObject({ captain: false, loanFrom: 'Schalke 04 II' });
    expect(parseFsPlayer('Fs player|no=|pos=FW|nat=BIH|name=Aldian Korora')?.no).toBeNull();
    expect(parseFsPlayer('Fs player|no=23|pos=MF|nat=BIH|name=Eldar Dragović|other=vice-captain')?.captain).toBe(false);
  });
  it('drops a row without a name instead of inventing one', () => {
    expect(parseFsPlayer('Fs player|no=9|pos=FW|nat=CRO|name=')).toBeNull();
  });
});

describe('parseSquad', () => {
  const { rows, skipped } = parseSquad(PAGE);
  const names = rows.map((r) => r.name);

  it('keeps the current squad and the loan list, nothing from other sections', () => {
    expect(names).toEqual(['Tarik Abdulahović', 'Aleksa Pejić', 'Mirko Ivanić', 'Matheus', 'Amar Ibrišimović', 'Aldian Korora', 'Eldar Dragović', 'Olanrewaju Ibraheem']);
    for (const bad of ['Not In The Squad Section', 'Dual Citizen Table Row', 'Kid Defender', 'Coach Who Is Listed By Mistake', 'Retired Legend']) expect(names).not.toContain(bad);
  });
  it('marks who is out on loan', () => {
    expect(rows.filter((r) => r.section === 'loanedOut').map((r) => r.name)).toEqual(['Olanrewaju Ibraheem']);
  });
  it('reports what it left out (youth, footnote tables) so nothing disappears silently', () => {
    expect(skipped).toEqual([{ section: 'Players with multiple nationalities', name: 'Dual Citizen Table Row' }, { section: 'Youth academy', name: 'Kid Defender' }]);
  });
  it('accepts a level-2 "Current squad" heading as well', () => {
    const r = parseSquad('==Current squad==\n===First team===\n{{Fs player|no=1|pos=GK|nat=SRB|name=A B}}\n==Notable players==\n{{Fs player|no=2|pos=DF|nat=SRB|name=Old Timer}}');
    expect(r.rows.map((x) => x.name)).toEqual(['A B']);
  });
});
