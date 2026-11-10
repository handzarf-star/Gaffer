import { z } from 'zod';
import { ROOM_CODE_RE, type C2S } from '../shared/protocol';
import { COMPETITIONS } from '../shared/competition';
import { BOT_LEVELS } from '../shared/bots';

const formation = z.enum(['433', '442', '4231', '352', '343', '532']);
const style = z.enum(['possession', 'press', 'wings', 'fortress', 'counter']);
const slotId = z.string().max(8);
const enumOf = (o: object) => z.enum(Object.keys(o) as [string, ...string[]]);

export const C2SSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('hello'),
    code: z.string().regex(ROOM_CODE_RE),
    id: z.string().max(32).optional(),
    secret: z.string().max(64).optional(),
    name: z.string().max(64),
  }),
  z.object({ t: z.literal('name'), name: z.string().max(64) }),
  z.object({
    t: z.literal('settings'),
    patch: z.object({
      format: z.enum(['duel', 'packs', 'turns']).optional(),
      pool: z.enum(['modern', 'legends', 'all']).optional(),
      ratings: z.enum(['hidden', 'tier', 'full']).optional(),
      pickSeconds: z.union([z.literal(0), z.literal(15), z.literal(25), z.literal(40)]).optional(),
      competition: enumOf(COMPETITIONS).optional(),
      teams: z.number().int().min(2).max(64).optional(),
      botLevel: enumOf(BOT_LEVELS).optional(),
      pace: z.enum(['normal', 'quick']).optional(),
      legs: z.union([z.literal(1), z.literal(2)]).optional(),
    }),
  }),
  z.object({ t: z.literal('formation'), formation }),
  z.object({ t: z.literal('start') }),
  z.object({ t: z.literal('pack'), round: z.number().int().min(0).max(99), index: z.number().int().min(0).max(8) }),
  z.object({ t: z.literal('pick'), round: z.number().int().min(0).max(99), card: z.string().max(80), slot: slotId }),
  z.object({ t: z.literal('swap'), a: slotId, b: slotId }),
  z.object({ t: z.literal('arrange') }),
  z.object({ t: z.literal('style'), style }),
  z.object({ t: z.literal('ready'), ready: z.boolean() }),
  z.object({ t: z.literal('seen') }),
  z.object({ t: z.literal('rematch'), want: z.boolean() }),
  z.object({ t: z.literal('lobby') }),
  z.object({ t: z.literal('kick'), id: z.string().max(32) }),
  z.object({ t: z.literal('emote'), e: z.string().max(8) }),
]);

export function parseMessage(raw: string): C2S | null {
  if (raw.length > 4096) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const r = C2SSchema.safeParse(json);
  return r.success ? (r.data as C2S) : null;
}
