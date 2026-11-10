// Tiny synthesised sound effects: no audio files to download, nothing to license, ~1KB.
// Sounds only play after a user gesture (browser rule) and can be muted; the choice is remembered.

import type { Tier } from '../../shared/players';
import { lsGet, lsSet } from './storage';

let ctx: AudioContext | null = null;
let enabled = lsGet<boolean>('sound', true);
const listeners = new Set<() => void>();

function audio(): AudioContext | null {
  if (!enabled) return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; at?: number; to?: number } = {}) {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + (opts.at ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
  const peak = opts.gain ?? 0.05;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(dur: number, opts: { gain?: number; at?: number; freq?: number } = {}) {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + (opts.at ?? 0);
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = opts.freq ?? 900;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.04, t0 + dur * 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(g).connect(c.destination);
  src.start(t0);
}

export const sfx = {
  isOn: () => enabled,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  set(on: boolean) {
    enabled = on;
    lsSet('sound', on);
    for (const l of listeners) l();
    if (on) this.pick();
  },
  pick() {
    tone(520, 0.09, { type: 'triangle', gain: 0.05 });
    tone(780, 0.12, { type: 'triangle', gain: 0.05, at: 0.06 });
  },
  select() {
    tone(420, 0.05, { type: 'sine', gain: 0.035 });
  },
  reveal(tier: Tier) {
    if (tier === 'icon') {
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.22, { type: 'sine', gain: 0.045, at: i * 0.06 }));
    } else if (tier === 'gold') {
      tone(660, 0.14, { type: 'triangle', gain: 0.04 });
      tone(880, 0.18, { type: 'triangle', gain: 0.04, at: 0.07 });
    } else {
      tone(360, 0.07, { type: 'sine', gain: 0.025 });
    }
  },
  turn() {
    tone(660, 0.1, { type: 'sine', gain: 0.05 });
    tone(990, 0.16, { type: 'sine', gain: 0.05, at: 0.09 });
  },
  tick() {
    tone(1000, 0.04, { type: 'square', gain: 0.018 });
  },
  whistle() {
    tone(2600, 0.22, { type: 'sine', gain: 0.045, to: 2900 });
    tone(2900, 0.34, { type: 'sine', gain: 0.045, at: 0.24, to: 2600 });
  },
  goal() {
    noise(1.4, { gain: 0.05, freq: 1100 });
    [392, 523, 659, 784].forEach((f, i) => tone(f, 0.28, { type: 'triangle', gain: 0.05, at: i * 0.08 }));
  },
  card() {
    tone(220, 0.18, { type: 'sawtooth', gain: 0.03 });
  },
  error() {
    tone(200, 0.16, { type: 'square', gain: 0.03 });
  },
  win() {
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, 0.24, { type: 'triangle', gain: 0.05, at: i * 0.1 }));
  },
};

export function buzz(ms = 12): void {
  try {
    // browsers log an error if you vibrate before the user has interacted with the page
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
}
