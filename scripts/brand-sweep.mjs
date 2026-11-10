// Fails if anything of the original app's identity survives in the shipped project.
// Mirrors the Replica "sweep": names (also inside identifiers), domains, brand colours.
//   npm run check:brand
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const cfg = JSON.parse(fs.readFileSync('replica/brand.json', 'utf8'));
const files = execSync('git ls-files -co --exclude-standard', { encoding: 'utf8' }).split('\n').filter(Boolean);
const SKIP = (f) => f.startsWith('replica/') || f === 'package-lock.json' || /\.(png|ico|woff2?|ttf|otf|jpg|jpeg|webp)$/i.test(f);

const names = cfg.avoid.map((n) => new RegExp(n.split(/[\s_-]+/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s_-]?'), 'i'));
const domains = cfg.domains.map((d) => new RegExp(d.replace(/\./g, '\\.'), 'i'));
const norm = (h) => { h = h.toLowerCase().replace('#', ''); return h.length === 3 ? '#' + [...h].map((c) => c + c).join('') : '#' + h; };
const colors = new Set(cfg.colors.map(norm));

let hits = 0;
for (const f of files) {
  if (SKIP(f) || !fs.existsSync(f)) continue;
  for (const [re] of [...names, ...domains].map((r) => [r])) if (re.test(f)) { console.log(`filename  ${f}`); hits++; }
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
  text.split('\n').forEach((line, i) => {
    for (const re of [...names, ...domains]) if (re.test(line)) { console.log(`name/domain  ${f}:${i + 1}  ${line.trim().slice(0, 100)}`); hits++; }
    for (const m of line.matchAll(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z])/g)) if (colors.has(norm(m[0]))) { console.log(`colour  ${f}:${i + 1}  ${m[0]}`); hits++; }
  });
}
if (hits) { console.log(`\n${hits} hit(s). Replace every one before you launch.`); process.exit(1); }
console.log(`BRAND SWEEP CLEAN: ${files.length} files checked, nothing of the original remains.`);
