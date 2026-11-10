// What a Durable Object does with whatever is in its storage when it wakes up. Pure, so the policy is unit-tested.
//
//   ready  - readable (maybe after migration/repair); `changed` says the stored copy should be rewritten
//   fresh  - nothing stored yet
//   drop   - rooms only: stored by a version we can no longer read and nobody could be mid-game on it; free the code
//   locked - leave the storage exactly as it is and refuse to serve it. Used for a save written by a NEWER build (a deploy was
//            rolled back), and for a save that could not be repaired. Never overwritten, so a fixed build can still open it.
//
// Careers are never dropped: a league is months of play. Rooms are dropped only when they are too old to migrate.

import { loadCareer } from '../shared/career/migrate';
import type { CareerState } from '../shared/career/engine';
import type { RoomState } from '../shared/protocol';
import { loadRoom } from '../shared/room-migrate';
import { isRec } from '../shared/migrate';

export type LockReason = 'too_new' | 'broken' | 'not_state';

export type Restore<T> =
  | { kind: 'fresh' }
  | { kind: 'ready'; state: T; from: number; changed: boolean }
  | { kind: 'drop'; reason: 'too_old' | 'not_state' }
  | { kind: 'locked'; reason: LockReason; from?: number; detail?: string };

export function restoreCareer(raw: unknown): Restore<CareerState> {
  if (raw === undefined || raw === null) return { kind: 'fresh' };
  const r = loadCareer(raw);
  if (r.ok) return { kind: 'ready', state: r.state, from: r.from, changed: r.changed };
  // a league is never deleted, whatever is wrong with it
  return { kind: 'locked', reason: r.reason === 'too_new' ? 'too_new' : r.reason === 'not_state' ? 'not_state' : 'broken', from: r.from, detail: r.detail ?? r.reason };
}

/** `core` is what the room wrote under "core"; `comp` is the separately stored competition (null when there is none). */
export function restoreRoom(core: unknown, comp: unknown): Restore<RoomState> {
  if (core === undefined || core === null) return { kind: 'fresh' };
  const r = loadRoom(isRec(core) ? { ...core, comp: comp ?? null } : core);
  if (r.ok) return { kind: 'ready', state: r.state, from: r.from, changed: r.changed };
  if (r.reason === 'too_old' || r.reason === 'not_state') return { kind: 'drop', reason: r.reason };
  return { kind: 'locked', reason: r.reason, from: r.from, detail: r.detail ?? r.reason };
}
