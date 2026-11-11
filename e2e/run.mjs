// One command for every real-browser check: builds, boots Cloudflare's local runtime (workerd + Durable Objects),
// then runs the two-player flows (desktop duel, mobile packs), the tournament and device-size runs, the stability
// scenarios, the accessibility audit and a hard kill-and-restart of the runtime (which boots its own copy).
//   npm run test:e2e
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const PORT = 8800 + Math.floor(Math.random() * 100);
const BASE = `http://localhost:${PORT}`;
const sh = (cmd, args, env = {}) => spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } }).status ?? 1;

if (!fs.existsSync('dist/client/index.html') || process.env.REBUILD === '1') {
  if (sh('npm', ['run', 'build']) !== 0) process.exit(1);
}
const server = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1'], { stdio: 'ignore' });
const stop = () => { try { server.kill('SIGTERM'); } catch { /* gone */ } spawnSync('pkill', ['-f', `wrangler.*${PORT}`]); };
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });

let up = false;
for (let i = 0; i < 90 && !up; i++) {
  try { up = (await fetch(`${BASE}/api/health`)).ok; } catch { /* booting */ }
  if (!up) await new Promise((r) => setTimeout(r, 500));
}
if (!up) { console.error('server did not start'); process.exit(1); }

const steps = [
  ['League Night on two phones: club, spotlight draft with steals, transfer window, time limits, sealed results (+ a11y)', 'e2e/league-night.mjs', { BASE }],
  ['two players, Duel draft, desktop', 'e2e/flow.mjs', { BASE }],
  ['two players, Packs draft, phone', 'e2e/flow.mjs', { BASE, FORMAT: 'packs', MOBILE: '1' }],
  ['two players, Take turns draft (one drafts, the other watches), phone', 'e2e/flow.mjs', { BASE, FORMAT: 'turns', MOBILE: '1' }],
  ['reconnect, resume, solo cup, daily', 'e2e/more.mjs', { BASE }],
  ['two phones play a league with CPU teams (iPhone + Pixel emulation)', 'e2e/tournament.mjs', { BASE }],
  ['one phone vs CPU teams at small, large and landscape sizes (+ iOS zoom rule)', 'e2e/devices.mjs', { BASE }],
  ['pools: Balkan League, countries, two pools at once, legends and eras, thin-mix guard', 'e2e/pools.mjs', { BASE }],
  ['WCAG audit (axe-core), light + dark, incl. tournament screens', 'e2e/a11y.mjs', { BASE }],
  ['Bosnian on a phone: home, lobby, how to play, cup, career (no sideways scroll, no leftover English)', 'e2e/bosnian.mjs', { BASE }, 'tsx'],
  ['career mode: two phones draft, play, switch to Bosnian, use the transfer window and finish a season (+ a11y)', 'e2e/career.mjs', { BASE }],
  ['Google sign-in loads under the real CSP; other origins stay blocked', 'e2e/csp.mjs', {}],
  ['build id handshake: server, page and socket agree; a newer deploy shows the update banner', 'e2e/update.mjs', {}],
  ['hard kill + restart of the runtime mid-draft and mid-tournament', 'scripts/check-persistence.mjs', {}],
  ['career API on the real runtime: guest sign-in, a league, hard kill + restart keeps cookie and league', 'scripts/check-career-api.mjs', {}],
];
let failed = 0;
for (const [name, file, env, via] of steps) {
  console.log(`\n━━ ${name}`);
  // a step that imports TypeScript (the dictionary) runs through tsx
  const code = via === 'tsx' ? sh('npx', ['tsx', file], env) : sh('node', [file], env);
  if (code !== 0) { failed++; console.log(`✗ FAILED: ${name}`); }
}
stop();
console.log(failed ? `\n${failed} e2e step(s) failed` : '\nALL E2E STEPS PASSED');
process.exit(failed ? 1 : 0);
