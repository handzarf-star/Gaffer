// Pure wikitext helpers for the club squad tables. No network, no clock: everything here is unit-tested (tests/wikitext.test.ts).
// Squads on Wikipedia are {{Fs player|no=|pos=|nat=|name=|other=}} rows between {{Fs start}} and {{Fs end}}.

/** Split `a|b=[[x|y]]|c={{t|1}}` on the top-level pipes only (not those inside [[..]] or {{..}}). */
export function splitArgs(s) {
  const out = [];
  let depthB = 0, depthC = 0, cur = '';
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (two === '[[') { depthB++; cur += two; i++; continue; }
    if (two === ']]') { depthB = Math.max(0, depthB - 1); cur += two; i++; continue; }
    if (two === '{{') { depthC++; cur += two; i++; continue; }
    if (two === '}}') { depthC = Math.max(0, depthC - 1); cur += two; i++; continue; }
    if (s[i] === '|' && depthB === 0 && depthC === 0) { out.push(cur); cur = ''; continue; }
    cur += s[i];
  }
  out.push(cur);
  return out;
}

/** Find every `{{name ...}}` template (balanced braces) and return its raw inner text. */
export function findTemplates(text, nameRe) {
  const out = [];
  const open = new RegExp(`\\{\\{\\s*(?:${nameRe})\\s*(?=[|}])`, 'gi');
  let m;
  while ((m = open.exec(text))) {
    let depth = 0, i = m.index;
    for (; i < text.length; i++) {
      if (text.startsWith('{{', i)) { depth++; i++; } else if (text.startsWith('}}', i)) { depth--; i++; if (depth === 0) break; }
    }
    if (depth !== 0) continue; // unbalanced: skip rather than guess
    out.push({ at: m.index, raw: text.slice(m.index + 2, i - 1) });
    open.lastIndex = i;
  }
  return out;
}

/** `[[Target|Shown]]` / `[[Target]]` / plain -> { name, link }.  `link` is the article title or null (a red/no link). */
export function cleanName(raw) {
  let s = (raw ?? '').replace(/<ref[\s\S]*?(<\/ref>|\/>)/gi, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<\/?(small|nowiki|span)[^>]*>/gi, '').trim();
  let link = null;
  const m = s.match(/^\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/);
  if (m) {
    link = m[1].split('#')[0].replace(/_/g, ' ').trim();
    s = (m[2] ?? m[1]).trim();
  }
  s = s.replace(/\{\{nowrap\|([^}]*)\}\}/gi, '$1').replace(/\s+/g, ' ').trim();
  return { name: s, link };
}

/** Reduce an `other=` note to text (links -> display text). */
export function plainNote(raw) {
  return (raw ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/<ref[\s\S]*?(<\/ref>|\/>)/gi, '').replace(/<[^>]+>/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]*)\]\]/g, '$2').replace(/\[\[([^\]]*)\]\]/g, '$1').replace(/\s+/g, ' ').trim();
}

/** Parse one Fs player template body -> row, or null if it has no usable name. */
export function parseFsPlayer(inner) {
  const parts = splitArgs(inner);
  const args = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    args[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim();
  }
  const { name, link } = cleanName(args.name);
  if (!name) return null;
  const note = plainNote(args.other);
  const numRaw = (args.no ?? '').replace(/<!--[\s\S]*?-->/g, '').trim();
  return {
    name, link,
    no: /^\d{1,2}$/.test(numRaw) ? Number(numRaw) : null,
    pos: (args.pos ?? '').trim().toUpperCase() || null,
    nat: (args.nat ?? '').trim().toUpperCase() || null,
    note: note || null,
    captain: /captain/i.test(note) && !/vice/i.test(note),
    loanFrom: (note.match(/on loan from\s+(.+?)(?:\s+until.*)?$/i) || [])[1] || null,
  };
}

/**
 * Walk the article by headings and keep ONLY the Players section (level 2 "Players" and its sub-sections).
 * "Notable players" / "Former players" etc. also use Fs player and must never leak into a current squad.
 * Sub-section kinds: squad (current/first team), loanedOut, other (reserve etc. -> kept out, reported).
 */
export function parseSquad(wikitext) {
  const lines = wikitext.split('\n');
  const rows = [];
  const skipped = [];
  let inPlayers = false, kind = null, buf = [], title = '';
  const flush = () => {
    if (!buf.length) return;
    const text = buf.join('\n');
    for (const t of findTemplates(text, 'fs player|football squad player|fs2 player')) {
      const row = parseFsPlayer(t.raw);
      if (!row) continue;
      if (kind === 'squad' || kind === 'loanedOut') rows.push({ ...row, section: kind });
      else skipped.push({ section: title, name: row.name });
    }
    buf = [];
  };
  for (const line of lines) {
    const h = line.match(/^(={2,6})\s*(.*?)\s*\1\s*$/);
    if (h) {
      flush();
      const level = h[1].length;
      const name = h[2].replace(/<!--[\s\S]*?-->/g, '').trim();
      title = name;
      if (level === 2) { inPlayers = /^(players|current squad|first[- ]team( squad)?|squad)$/i.test(name); kind = inPlayers ? 'squad' : null; continue; }
      if (!inPlayers) { kind = null; continue; }
      if (/out on loan|loaned out|on loan/i.test(name)) kind = 'loanedOut';
      else if (/^(current squad|first[- ]team( squad)?|squad|senior squad)$/i.test(name)) kind = 'squad';
      else if (/nationalit|citizenship/i.test(name)) kind = null; // a footnote table, not a squad
      else kind = 'other';
      continue;
    }
    if (inPlayers) buf.push(line);
  }
  flush();
  return { rows, skipped };
}

/** Compare names without accents/case/punctuation. Only exact folded equality counts ("Đorđe" is NOT guessed to be "Djordje"). */
export const fold = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').replace(/ø/gi, 'o').replace(/ł/gi, 'l').replace(/ß/g, 'ss').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/* ───────────── player articles: the football infobox ───────────── */

const stripNoise = (s) => (s ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/<ref[^>]*\/>/gi, '').replace(/<ref[\s\S]*?<\/ref>/gi, '').trim();
const digits = (s) => { const m = stripNoise(s).match(/\d+/); return m ? Number(m[0]) : null; };
const YOUTH = /\bU-?\d{2}\b|olympic|youth|under-?\d|\bB team\b/i;

/**
 * Read the facts we use from an "Infobox football biography": senior national-team caps/goals, senior club appearances
 * (loan spells included, listed separately on Wikipedia so there is no double count), birth date and the current club.
 * Returns null when the article has no such infobox. Missing numbers stay null: nothing is guessed.
 */
export function parseInfobox(wikitext) {
  const box = findTemplates(wikitext, 'infobox football biography|infobox footballer|infobox soccer biography')[0];
  if (!box) return null;
  const args = {};
  for (const part of splitArgs(box.raw).slice(1)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    args[part.slice(0, eq).trim().toLowerCase().replace(/ /g, '_')] = stripNoise(part.slice(eq + 1));
  }
  const clubs = [];
  for (let i = 1; i <= 40; i++) {
    const c = args[`clubs${i}`];
    if (c === undefined) continue;
    const loan = /^→|\(loan\)/i.test(c) || /loan/i.test(c);
    const { name, link } = cleanName(c.replace(/^→\s*/, '').replace(/\(loan\)/i, '').trim());
    const years = (args[`years${i}`] ?? '').replace(/\s+/g, ' ').trim();
    clubs.push({ name, link, loan, years, apps: digits(args[`caps${i}`]), goals: digits(args[`goals${i}`]) });
  }
  const national = [];
  for (let i = 1; i <= 12; i++) {
    // current articles write national_team1 / national_caps1; older ones nationalteam1 / nationalcaps1
    const t = args[`national_team${i}`] ?? args[`nationalteam${i}`];
    if (t === undefined) continue;
    const { name } = cleanName(t);
    national.push({
      team: name, youth: YOUTH.test(t) || YOUTH.test(name),
      caps: digits(args[`national_caps${i}`] ?? args[`nationalcaps${i}`]), goals: digits(args[`national_goals${i}`] ?? args[`nationalgoals${i}`]),
    });
  }
  let born = null, bornPrecision = null;
  const bd = (args.birth_date ?? '').match(/\{\{\s*(?:birth[ _]date(?:[ _]and[ _]age)?|bda|dob)\s*\|\s*(?:df=\w+\|\s*)?(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})/i);
  if (bd) { born = `${bd[1]}-${bd[2].padStart(2, '0')}-${bd[3].padStart(2, '0')}`; bornPrecision = 'day'; }
  const sum = (arr, k) => arr.reduce((a, x) => a + (x[k] ?? 0), 0);
  const senior = clubs.filter((c) => c.apps != null);
  const intl = national.filter((n) => !n.youth && n.caps != null);
  return {
    born, bornPrecision,
    position: plainNote(args.position) || null,
    currentClub: cleanName(args.current_club ?? args.currentclub ?? '').link ?? (cleanName(args.current_club ?? '').name || null),
    clubApps: senior.length ? sum(senior, 'apps') : null,
    clubGoals: senior.length ? sum(senior, 'goals') : null,
    clubLines: clubs.length,
    intlCaps: intl.length ? sum(intl, 'caps') : (national.some((n) => !n.youth) ? null : 0),
    intlGoals: intl.length ? sum(intl, 'goals') : null,
    nationalTeams: national.filter((n) => !n.youth).map((n) => n.team),
  };
}
