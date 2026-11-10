import { describe, expect, it } from 'vitest';
import { headlineText, motmReasonText } from '../src/shared/i18n/commentary';
import { interpolate } from '../src/shared/i18n';
import { HEADLINE_BS, REASON_BS } from '../src/shared/i18n/result.bs';
import { HEADLINES, REASONS, simulateMatch, type MatchResult } from '../src/shared/sim';
import { PLAYERS } from '../src/shared/players';
import { autoPick } from '../src/shared/draft';
import { emptySquad, type Squad } from '../src/shared/squad';

const ph = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))].sort();
const squadFrom = (offset: number): Squad => {
  let sq = emptySquad('433');
  const ids = PLAYERS.filter((p) => !p.only).slice(offset).map((p) => p.id);
  const taken = new Set<string>();
  for (let r = 0; r < 11; r++) { const pick = autoPick(sq, ids.filter((i) => !taken.has(i)).slice(0, 40)); if (!pick) break; sq = { ...sq, slots: { ...sq.slots, [pick.slotId]: pick.cardId } }; taken.add(pick.cardId); }
  return sq;
};

// Six squads of different strength, so the 40 matches cover every kind of headline (upsets, hat-tricks, shootouts, nil-nils ...).
const squads = [0, 60, 120, 180, 240, 300].map(squadFrom);
const play = (i: number): MatchResult => {
  const x = i % 6, y = (x + 1 + (i % 5)) % 6;
  return simulateMatch(squads[x]!, squads[y]!, ['Alpha', 'Beta'], `rt2/${i}`, { knockout: i % 3 !== 0 });
};
const matches = Array.from({ length: 40 }, (_, i) => play(i));

// [score, went, headline, motm.reason] of play(0..39). Originally recorded BEFORE hk/rk were added to the engine, to prove that adding the
// structured fields changed not a single English word. These matches follow the match engine, so they are re-recorded when the engine is
// changed ON PURPOSE (and only then; say why in the commit). Re-recorded, each time on purpose:
//   - Sprint 2.2: the keeper's shot-stopping curve was steepened (sim.ts gkFactor) so +5 on the keeper is worth +0.10 points a match instead of +0.03.
//   - Sprint 2.3: tactics are zero-sum with a rock-paper-scissors matchup term, the fortress keeper bonus is real, and the computer picks its tactic at random instead of by overall.
//   - Sprint 2.3: keeper divisor 38 -> 36 after the new tactics moved the baseline, so +5 on the keeper is centred in its band in both the draft game and a career league.
const BEFORE: Array<[string, string, string, string]> = [
  ['0-3', 'ft', 'Beta cruise past Alpha', '20 saves'],
  ['2-1', 'ft', 'Alpha win a tight one', '1 goal'],
  ['3-1', 'ft', 'Alpha get the better of Beta', '2 goals'],
  ['0-1', 'ft', 'Beta grind out a 1-0', '1 goal'],
  ['0-0', 'pens', 'Penalty drama: Beta win it from the spot', '4 saves'],
  ['4-1', 'ft', 'Comfortable night for Alpha', '15 saves'],
  ['1-0', 'ft', 'Shock! Alpha topple the favourites', '7 saves'],
  ['0-1', 'et', 'Extra-time winner sends Beta through', '1 goal'],
  ['3-2', 'ft', "Goal-fest! Everyone gets their money's worth", '1 goal'],
  ['1-0', 'ft', 'Alpha grind out a 1-0', '1 goal'],
  ['2-1', 'ft', 'Alpha take the points', '1 goal'],
  ['2-0', 'ft', 'Alpha win a tight one', '4 saves'],
  ['0-0', 'ft', 'Nil-nil: nothing to separate them', '9 saves'],
  ['2-1', 'ft', 'Alpha take the points', '1 goal'],
  ['1-1', 'pens', 'Alpha survive the shootout, 5-3', '1 goal'],
  ['1-1', 'ft', 'Honours even in a thriller', '1 goal'],
  ['1-1', 'pens', 'Beta survive the shootout, 4-3', '12 saves'],
  ['2-1', 'ft', 'Alpha snatch it late', '1 goal'],
  ['0-1', 'ft', 'One goal is enough for Beta', '14 saves'],
  ['3-1', 'et', 'Extra-time winner sends Alpha through', '9 saves'],
  ['1-0', 'et', 'Extra-time winner sends Alpha through', '4 saves'],
  ['0-1', 'ft', 'Beta grind out a 1-0', '6 saves'],
  ['1-2', 'ft', 'Beta snatch it late', '1 goal'],
  ['2-1', 'ft', 'Alpha get the better of Beta', '1 goal'],
  ['0-2', 'ft', 'Beta win a tight one', '2 goals'],
  ['1-0', 'ft', 'One goal is enough for Alpha', '1 goal'],
  ['3-1', 'ft', 'Alpha win a tight one', '1 goal'],
  ['0-0', 'ft', 'Nil-nil: nothing to separate them', '9 saves'],
  ['1-1', 'pens', 'Alpha heartbroken as Beta take it on penalties', '9 saves'],
  ['2-1', 'ft', 'Alpha take the points', '1 goal'],
  ['0-4', 'ft', 'Demolition: Beta 4-0 Alpha', '2 goals'],
  ['2-0', 'ft', 'Alpha take the points', '1 goal'],
  ['2-1', 'ft', 'Alpha win a tight one', '1 goal'],
  ['0-1', 'ft', 'Beta snatch it late', '1 goal'],
  ['1-0', 'ft', 'Alpha grind out a 1-0', '1 goal'],
  ['1-0', 'ft', 'Alpha grind out a 1-0', '14 saves'],
  ['0-2', 'ft', 'Beta take the points', '9 saves'],
  ['1-0', 'ft', 'Alpha grind out a 1-0', '5 saves'],
  ['0-0', 'pens', 'Beta heartbroken as Alpha take it on penalties', '15 saves'],
  ['0-3', 'ft', 'Beta cruise past Alpha', '1 goal'],
];

describe('result text: English is untouched', () => {
  it('headline, reason, score and way of winning of 40 seeded matches equal the values recorded before the change', () => {
    expect(BEFORE).toHaveLength(40);
    matches.forEach((r, i) => {
      expect([r.score.join('-'), r.went, r.headline, r.motm.reason], `match ${i}`).toEqual(BEFORE[i]);
    });
  });
  it('the English rendering is the engine string itself', () => {
    for (const r of matches) {
      expect(headlineText(r, 'en')).toBe(r.headline);
      expect(motmReasonText(r, 'en')).toBe(r.motm.reason);
    }
  });
});

describe('result text: structured fields', () => {
  it('every result has a headline key and a reason key, and the English template filled with the variables gives the English string', () => {
    for (const [i, r] of matches.entries()) {
      expect(r.hk, `match ${i} hk`).toBeTruthy();
      expect(r.hv, `match ${i} hv`).toBeTruthy();
      expect(r.motm.rk, `match ${i} rk`).toBeTruthy();
      expect(r.motm.rv, `match ${i} rv`).toBeTruthy();
      const [group, idx] = r.hk!.split(':');
      const tpl = HEADLINES[group!]?.[Number(idx)];
      expect(tpl, `headline key ${r.hk}`).toBeDefined();
      expect(interpolate(tpl!, r.hv), `match ${i}`).toBe(r.headline);
      expect(REASONS[r.motm.rk!], `reason key ${r.motm.rk}`).toBeDefined();
      expect(interpolate(REASONS[r.motm.rk!]!, r.motm.rv), `match ${i}`).toBe(r.motm.reason);
    }
  });
  it('the sample is varied enough to mean something', () => {
    const groups = new Set(matches.map((r) => r.hk!.split(':')[0]));
    expect(groups.size).toBeGreaterThanOrEqual(8);
    expect(new Set(matches.map((r) => r.motm.rk)).size).toBeGreaterThanOrEqual(3);
  });
});

describe('result text: Bosnian', () => {
  it('has a line for every English headline, in the same order, with the same placeholders', () => {
    expect(Object.keys(HEADLINE_BS).sort()).toEqual(Object.keys(HEADLINES).sort());
    for (const [group, list] of Object.entries(HEADLINES)) {
      const bs = HEADLINE_BS[group]!;
      expect(bs.length, `group ${group} length`).toBe(list.length);
      list.forEach((en, i) => expect(ph(bs[i]!), `${group}:${i}`).toEqual(ph(en)));
    }
  });
  it('has a line for every reason, every plural form with the same placeholders', () => {
    expect(Object.keys(REASON_BS).sort()).toEqual(Object.keys(REASONS).sort());
    for (const [key, en] of Object.entries(REASONS)) {
      const bs = REASON_BS[key]!;
      for (const form of typeof bs === 'string' ? [bs] : bs) expect(ph(form), key).toEqual(ph(en));
    }
  });
  it('renders every real result with no placeholder left over, and with the team and player names intact', () => {
    for (const [i, r] of matches.entries()) {
      const h = headlineText(r, 'bs');
      const m = motmReasonText(r, 'bs');
      expect(h, `match ${i} headline`).not.toMatch(/[{}]/);
      expect(m, `match ${i} reason`).not.toMatch(/[{}]/);
      expect(h.length).toBeGreaterThan(8);
      expect(m.length).toBeGreaterThan(4);
      // not an English fallback: the key resolved to a Bosnian template
      const [group, idx] = r.hk!.split(':');
      expect(h).toBe(interpolate(HEADLINE_BS[group!]![Number(idx)]!, r.hv));
      // names are never altered or dropped: each name the English template mentions appears exactly as given
      for (const k of ph(HEADLINES[group!]![Number(idx)]!)) if (['wn', 'ln', 'p'].includes(k)) expect(h, `${r.hk} lost {${k}}`).toContain(r.hv![k]!);
    }
  });
  it('uses the right plural form for the count', () => {
    const reason = (rk: string, n: number) => motmReasonText({ motm: { reason: 'x', rk, rv: { n: String(n) } } }, 'bs');
    expect(reason('goal', 1)).toBe('1 gol');
    expect(reason('goals', 2)).toBe('2 gola');
    expect(reason('goals', 4)).toBe('4 gola');
    expect(reason('goals', 5)).toBe('5 golova');
    expect(reason('assist', 1)).toBe('1 asistencija');
    expect(reason('assists', 3)).toBe('3 asistencije');
    expect(reason('assists', 6)).toBe('6 asistencija');
    expect(reason('cleanSheet', 1)).toBe('čista mreža i 1 odbrana');
    expect(reason('cleanSheets', 0)).toBe('čista mreža i 0 odbrana');
    expect(reason('cleanSheets', 3)).toBe('čista mreža i 3 odbrane');
    expect(reason('saves', 4)).toBe('4 odbrane');
    expect(reason('saves', 11)).toBe('11 odbrana');
    expect(reason('saves', 22)).toBe('22 odbrane');
  });
  it('keeps names in the nominative', () => {
    expect(headlineText({ headline: 'x', hk: 'hat:0', hv: { p: 'Pedri', ln: 'Beta' } }, 'bs')).toBe('Hat-trick: Pedri potapa protivnika, Beta nema odgovora');
    expect(headlineText({ headline: 'x', hk: 'riot:1', hv: { wn: 'Alpha', ln: 'Beta', hi: '5', lo: '0' } }, 'bs')).toBe('Deklasiranje: Alpha 5-0 Beta');
  });
  it('falls back to the English text for an unknown key, a missing key or a missing variable', () => {
    expect(headlineText({ headline: 'Hello', hk: 'nope:3', hv: {} }, 'bs')).toBe('Hello');
    expect(headlineText({ headline: 'Hello', hk: 'win:9', hv: {} }, 'bs')).toBe('Hello');
    expect(headlineText({ headline: 'Hello' }, 'bs')).toBe('Hello');
    expect(headlineText({ headline: 'Hello', hk: 'win:0', hv: {} }, 'bs')).toBe('Hello');
    expect(motmReasonText({ motm: { reason: 'Hi', rk: 'nope' } }, 'bs')).toBe('Hi');
    expect(motmReasonText({ motm: { reason: 'Hi' } }, 'bs')).toBe('Hi');
    expect(motmReasonText({ motm: { reason: 'Hi', rk: 'goals', rv: {} } }, 'bs')).toBe('Hi');
  });
});
