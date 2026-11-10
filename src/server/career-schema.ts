import { z } from 'zod';

const formation = z.enum(['433', '442', '4231', '352', '343', '532']);
const style = z.enum(['possession', 'press', 'wings', 'fortress', 'counter']);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const id = z.string().min(1).max(80);

export const BadgeSchema = z.object({
  shape: z.enum(['shield', 'round', 'pennant', 'diamond']),
  mark: z.enum(['initial', 'stripes', 'star', 'bar']),
  c1: hex,
  c2: hex,
});

export const ActSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('join'),
    name: z.string().min(1).max(40),
    choice: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('real'), id }),
      z.object({ kind: z.literal('custom'), name: z.string().min(1).max(60) }),
    ]),
    badge: BadgeSchema.optional(),
  }),
  z.object({
    t: z.literal('settings'),
    patch: z.object({
      pickHours: z.number().int().min(1).max(72).optional(),
      dayHours: z.number().int().min(1).max(168).optional(),
      windowHours: z.number().int().min(1).max(168).optional(),
      bot: z.enum(['easy', 'normal', 'hard']).optional(),
    }),
  }),
  z.object({ t: z.literal('start') }),
  z.object({ t: z.literal('pick'), player: id }),
  z.object({ t: z.literal('lineup'), formation, style, slots: z.record(z.string().max(8), id.nullable()) }),
  z.object({ t: z.literal('ready'), ready: z.boolean() }),
  z.object({ t: z.literal('auto'), auto: z.boolean() }),
  z.object({ t: z.literal('plan'), swaps: z.array(z.object({ out: id, in: id })).max(12) }),
  z.object({ t: z.literal('windowReady'), ready: z.boolean() }),
]);
export type Act = z.infer<typeof ActSchema>;

export function parseAct(raw: unknown): Act | null {
  const r = ActSchema.safeParse(raw);
  return r.success ? r.data : null;
}
