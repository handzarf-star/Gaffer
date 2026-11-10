// Lists the t()/tn() strings in the given source files that have no Bosnian entry yet, and the dictionary keys that nothing uses.
//   npx tsx scripts/i18n-missing.mjs src/client/screens/RoomPage.tsx src/client/components/CompViews.tsx
import fs from 'node:fs';
import { dictOf } from '../src/shared/i18n/index.ts';
import '../src/shared/i18n/bs.ts';

const STR = String.raw`'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"`;
const unq = (s) => s.replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n');
const bs = dictOf('bs');
let missing = 0;
for (const f of process.argv.slice(2)) {
  const text = fs.readFileSync(f, 'utf8');
  const keys = new Set(), plurals = new Set();
  for (const m of text.matchAll(new RegExp(String.raw`\bt\(\s*(?:${STR})`, 'g'))) keys.add(unq(m[1] ?? m[2] ?? ''));
  for (const m of text.matchAll(new RegExp(String.raw`\btn\(\s*(?:${STR})\s*,\s*(?:${STR})`, 'g'))) plurals.add(unq(m[1] ?? m[2] ?? ''));
  const miss = [...keys].filter((k) => !(k in bs));
  const missP = [...plurals].filter((k) => !Array.isArray(bs[k]));
  missing += miss.length + missP.length;
  console.log(`${f}: ${keys.size} t() + ${plurals.size} tn() strings, ${miss.length + missP.length} without a Bosnian entry`);
  for (const k of miss) console.log('   t   ', JSON.stringify(k));
  for (const k of missP) console.log('   tn  ', JSON.stringify(k));
}
process.exit(missing ? 1 : 0);
