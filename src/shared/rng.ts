// Seeded randomness. Everything that affects a game (boards, matches, AI) flows from a string seed,
// so a room can be replayed, tested and "daily" drafts are identical for everyone.

export function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

export class Rng {
  private s: number;
  readonly base: string;

  constructor(seed: string) {
    this.base = seed;
    this.s = hashSeed(seed);
  }

  /** mulberry32 */
  next(): number {
    let t = (this.s += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Independent stream, stable no matter how much this one has been consumed. */
  fork(label: string): Rng {
    return new Rng(`${this.base}/${label}`);
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  range(a: number, b: number): number {
    return a + this.next() * (b - a);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('pick from empty array');
    return arr[this.int(arr.length)]!;
  }

  shuffle<T>(arr: readonly T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }

  weighted<T>(items: readonly T[], weight: (t: T) => number): T {
    if (items.length === 0) throw new Error('weighted pick from empty array');
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    if (total <= 0) return items[this.int(items.length)]!;
    let r = this.next() * total;
    for (const it of items) {
      r -= Math.max(0, weight(it));
      if (r <= 0) return it;
    }
    return items[items.length - 1]!;
  }

  /** Approx. standard normal (Box-Muller). */
  normal(): number {
    const u = Math.max(this.next(), 1e-9);
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

export function randomSeed(): string {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return a[0]!.toString(36) + a[1]!.toString(36);
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // no I, L, O: unambiguous when read aloud or typed on a phone

export function randomRoomCode(): string {
  const a = new Uint8Array(4);
  crypto.getRandomValues(a);
  let s = '';
  for (const b of a) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return s;
}

export function randomToken(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
