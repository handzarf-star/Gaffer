import { describe, expect, it } from 'vitest';
import { parseMessage } from '../src/server/schema';
import { DEFAULT_SETTINGS } from '../src/shared/protocol';

// zod silently strips keys it does not know, so a setting missing from the wire schema looks like a
// working button that does nothing. This test fails the moment a setting is added without a schema entry.
describe('wire schema', () => {
  it('lets every setting through the settings patch', () => {
    for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof typeof DEFAULT_SETTINGS>) {
      const patch = { [key]: DEFAULT_SETTINGS[key] };
      const parsed = parseMessage(JSON.stringify({ t: 'settings', patch }));
      expect(parsed, key).not.toBeNull();
      expect((parsed as { patch: object }).patch, `${key} was stripped`).toEqual(patch);
    }
  });

  it('accepts the values the lobby can send', () => {
    for (const patch of [
      { competition: 'league', teams: 4 },
      { competition: 'groups', teams: 8, pace: 'quick' },
      { competition: 'knockout', teams: 4 },
      { botLevel: 'hard' },
      { format: 'turns' },
      { legs: 2 },
    ]) {
      const parsed = parseMessage(JSON.stringify({ t: 'settings', patch }));
      expect(parsed, JSON.stringify(patch)).toEqual({ t: 'settings', patch });
    }
  });

  it('knows the pack message and refuses nonsense for it', () => {
    expect(parseMessage(JSON.stringify({ t: 'pack', round: 3, index: 2 }))).toEqual({ t: 'pack', round: 3, index: 2 });
    for (const bad of [{ t: 'pack', round: 1, index: -1 }, { t: 'pack', round: 1, index: 99 }, { t: 'pack', round: 1 }, { t: 'pack', index: 1 }]) {
      expect(parseMessage(JSON.stringify(bad)), JSON.stringify(bad)).toBeNull();
    }
  });

  it('rejects junk', () => {
    for (const patch of [{ competition: 'worldcup' }, { teams: 1.5 }, { teams: 999 }, { botLevel: 'god' }, { pace: 'slow' }, { legs: 3 }]) {
      expect(parseMessage(JSON.stringify({ t: 'settings', patch })), JSON.stringify(patch)).toBeNull();
    }
  });
});
