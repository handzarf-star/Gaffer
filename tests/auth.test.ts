import { describe, expect, it } from 'vitest';
import {
  AuthError, b64u, checkNonce, cleanDisplayName, googleAccountId, makeNonce, readCookie, sessionCookie, signSession, verifyGoogleIdToken, verifySession, type GoogleKey,
} from '../src/server/auth';

const SECRET = 'test-secret-value-which-is-long-enough';
const NOW = 1_800_000_000_000;
const enc = new TextEncoder();

async function keypair() {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = (await crypto.subtle.exportKey('jwk', kp.publicKey)) as { kty?: string; n?: string; e?: string };
  return { priv: kp.privateKey, key: { kid: 'k1', kty: jwk.kty!, n: jwk.n!, e: jwk.e!, alg: 'RS256' } as GoogleKey };
}
async function idToken(priv: Awaited<ReturnType<typeof keypair>>['priv'], claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: 'k1' }) {
  const h = b64u(enc.encode(JSON.stringify(header)));
  const p = b64u(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', priv, enc.encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(sig)}`;
}
const good = (over: Record<string, unknown> = {}) => ({ iss: 'https://accounts.google.com', aud: 'client-123', sub: '1234567890', exp: NOW / 1000 + 3000, iat: NOW / 1000 - 10, name: 'Sam Example', ...over });
const opts = (key: GoogleKey, extra: Partial<Parameters<typeof verifyGoogleIdToken>[1]> = {}) => ({ clientId: 'client-123', now: NOW, keys: async () => [key], ...extra });
const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: AuthError) => e.code);

describe('session cookie', () => {
  it('round-trips and rejects tampering, expiry and a different secret', async () => {
    const t = await signSession(SECRET, { a: 'g_abc', k: 'g' }, NOW);
    expect(await verifySession(SECRET, t, NOW + 1000)).toMatchObject({ a: 'g_abc', k: 'g' });
    expect(await verifySession('another-secret-of-similar-length-xx', t, NOW + 1000)).toBeNull();
    const [p, s] = t.split('.');
    const forged = b64u(enc.encode(JSON.stringify({ a: 'g_evil', k: 'g', iat: NOW, exp: NOW + 1e9 })));
    expect(await verifySession(SECRET, `${forged}.${s}`, NOW + 1000)).toBeNull();
    expect(await verifySession(SECRET, `${p}.${s}x`, NOW + 1000)).toBeNull();
    expect(await verifySession(SECRET, t, NOW + 31 * 86_400_000)).toBeNull(); // google sessions last 30 days
    expect(await verifySession(SECRET, 'garbage', NOW)).toBeNull();
    expect(await verifySession(SECRET, null, NOW)).toBeNull();
    expect(await verifySession(SECRET, 'a.b.c', NOW)).toBeNull();
  });
  it('guests last longer than Google sessions', async () => {
    const t = await signSession(SECRET, { a: 'u_abc', k: 'u' }, NOW);
    expect(await verifySession(SECRET, t, NOW + 200 * 86_400_000)).not.toBeNull();
  });
  it('cookie flags: HttpOnly and SameSite always, Secure on https', () => {
    const c = sessionCookie('tok', 'g', true);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Secure');
    expect(sessionCookie('tok', 'g', false)).not.toContain('Secure');
    expect(readCookie('a=1; gaffer_session=tok; b=2', 'gaffer_session')).toBe('tok');
    expect(readCookie(null, 'x')).toBeNull();
  });
});

describe('nonce', () => {
  it('accepts a fresh nonce we issued, rejects forged, edited and old ones', async () => {
    const n = await makeNonce(SECRET, NOW);
    expect(await checkNonce(SECRET, n, NOW + 1000)).toBe(true);
    expect(await checkNonce(SECRET, n, NOW + 11 * 60_000)).toBe(false);
    expect(await checkNonce('other-secret-other-secret-other', n, NOW + 1000)).toBe(false);
    expect(await checkNonce(SECRET, n.replace(/.$/, 'A'), NOW + 1000)).toBe(false);
    expect(await checkNonce(SECRET, 'x.y', NOW)).toBe(false);
  });
});

describe('Google ID token', () => {
  it('accepts a correctly signed token for our client id', async () => {
    const { priv, key } = await keypair();
    const c = await verifyGoogleIdToken(await idToken(priv, good()), opts(key));
    expect(c.sub).toBe('1234567890');
    expect(c.name).toBe('Sam Example');
  });
  it('rejects a bad signature, the wrong audience, the wrong issuer, an expired token and alg=none', async () => {
    const { priv, key } = await keypair();
    const other = await keypair();
    expect(await code(verifyGoogleIdToken(await idToken(other.priv, good()), opts(key)))).toBe('signature');
    expect(await code(verifyGoogleIdToken(await idToken(priv, good({ aud: 'someone-else' })), opts(key)))).toBe('aud');
    expect(await code(verifyGoogleIdToken(await idToken(priv, good({ iss: 'https://evil.example' })), opts(key)))).toBe('iss');
    expect(await code(verifyGoogleIdToken(await idToken(priv, good({ exp: NOW / 1000 - 3600 })), opts(key)))).toBe('expired');
    expect(await code(verifyGoogleIdToken(await idToken(priv, good(), { alg: 'none', kid: 'k1' }), opts(key)))).toBe('alg');
    expect(await code(verifyGoogleIdToken(await idToken(priv, good(), { alg: 'HS256', kid: 'k1' }), opts(key)))).toBe('alg');
    expect(await code(verifyGoogleIdToken('a.b', opts(key)))).toBe('malformed');
    expect(await code(verifyGoogleIdToken(await idToken(priv, good()), { ...opts(key), clientId: '' }))).toBe('not_configured');
  });
  it('re-reads Google keys once when the key id is unknown (key rotation), but not forever', async () => {
    const { priv, key } = await keypair();
    let calls = 0;
    const keys = async (refresh: boolean) => { calls++; return refresh ? [key] : []; };
    expect((await verifyGoogleIdToken(await idToken(priv, good()), { clientId: 'client-123', now: NOW, keys })).sub).toBe('1234567890');
    expect(calls).toBe(2);
    calls = 0;
    expect(await code(verifyGoogleIdToken(await idToken(priv, good(), { alg: 'RS256', kid: 'zzz' }), { clientId: 'client-123', now: NOW, keys: async () => { calls++; return [key]; } }))).toBe('kid');
    expect(calls).toBe(2);
  });
  it('checks the nonce when asked, so a captured token cannot be replayed', async () => {
    const { priv, key } = await keypair();
    const nonce = await makeNonce(SECRET, NOW);
    const expectNonce = (n: string) => checkNonce(SECRET, n, NOW + 1000);
    expect((await verifyGoogleIdToken(await idToken(priv, good({ nonce })), opts(key, { expectNonce }))).sub).toBe('1234567890');
    expect(await code(verifyGoogleIdToken(await idToken(priv, good({ nonce: 'made.up.value' })), opts(key, { expectNonce })))).toBe('nonce');
    expect(await code(verifyGoogleIdToken(await idToken(priv, good()), opts(key, { expectNonce })))).toBe('nonce');
  });
});

describe('account identity', () => {
  it('derives an opaque, stable id that does not contain the Google id', async () => {
    const a = await googleAccountId('1234567890');
    expect(a).toMatch(/^g_[A-Za-z0-9_-]{22}$/);
    expect(a).not.toContain('1234567890');
    expect(await googleAccountId('1234567890')).toBe(a);
    expect(await googleAccountId('1234567891')).not.toBe(a);
  });
  it('cleans display names', () => {
    const evil = cleanDisplayName('  <script>alert(1)</script> Sam ');
    expect(evil).not.toMatch(/[<>()\/]/); // no markup characters survive
    expect(evil.length).toBeLessThanOrEqual(20);
    expect(cleanDisplayName('', 'Guest')).toBe('Guest');
    expect(cleanDisplayName('Đorđe Čolić')).toBe('Đorđe Čolić');
    expect(cleanDisplayName('x'.repeat(50)).length).toBe(20);
  });
});
