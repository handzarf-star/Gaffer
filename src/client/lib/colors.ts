import { BOT_HUES, SEAT_HUES, type Seat } from '../../shared/protocol';

/** The colour a team plays in: humans keep their seat colour, CPU teams get their own palette. */
export function seatColor(seat: Pick<Seat, 'hue' | 'bot'>): string {
  return seat.bot ? BOT_HUES[seat.hue % BOT_HUES.length]! : SEAT_HUES[seat.hue % SEAT_HUES.length]!;
}

/** Slightly darker/lighter variants for gradients. */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + amt * (amt < 0 ? v : 255 - v))));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
