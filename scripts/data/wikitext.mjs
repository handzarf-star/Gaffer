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
