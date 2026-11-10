// Sign-in. Two kinds of account, no passwords anywhere:
//   * Google: the browser gets a Google ID token; we verify its signature against Google's published keys, check issuer, audience,
//     expiry and a nonce WE issued (so a stolen token cannot be replayed), then keep only a one-way hash of Google's user id.
//   * Guest: a random id bound to this browser. Good enough to play with friends; clearing the browser's data loses it.
// Either way the browser only ever holds a signed, HttpOnly cookie. Pure WebCrypto, so it runs in Workers and in Node tests.

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64u(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
async function hmacKey(secret: string): Promise<Key> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export function randomId(bytes = 16): string {
  return b64u(crypto.getRandomValues(new Uint8Array(bytes)));
}

/* ───────────── session cookie ───────────── */

export interface Session { a: string; k: 'g' | 'u'; iat: number; exp: number }
export const SESSION_COOKIE = 'gaffer_session';
const DAY = 86_400_000;
export const SESSION_TTL = { g: 30 * DAY, u: 365 * DAY } as const;

export async function signSession(secret: string, s: Omit<Session, 'iat' | 'exp'>, now: number): Promise<string> {
  const body: Session = { ...s, iat: now, exp: now + SESSION_TTL[s.k] };
  const payload = b64u(enc.encode(JSON.stringify(body)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(payload));
  return `${payload}.${b64u(sig)}`;
}

export async function verifySession(secret: string, token: string | null | undefined, now: number): Promise<Session | null> {
  if (!token || token.length > 600) return null;
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64u(sig), enc.encode(payload));
    if (!ok) return null;
    const s = JSON.parse(dec.decode(unb64u(payload))) as Session;
    if (typeof s.a !== 'string' || (s.k !== 'g' && s.k !== 'u') || typeof s.exp !== 'number' || s.exp <= now) return null;
    return s;
  } catch {
    return null;
  }
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function sessionCookie(token: string, kind: 'g' | 'u', secure: boolean): string {
  const maxAge = Math.floor(SESSION_TTL[kind] / 1000);
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
export function clearCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/* ───────────── nonce: a one-time-looking value only we could have issued ───────────── */

export async function makeNonce(secret: string, now: number): Promise<string> {
  const body = `${now.toString(36)}.${randomId(12)}`;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`nonce:${body}`));
  return `${body}.${b64u(sig).slice(0, 22)}`;
}
export async function checkNonce(secret: string, nonce: string, now: number, maxAgeMs = 10 * 60_000): Promise<boolean> {
  const parts = nonce.split('.');
  if (parts.length !== 3) return false;
  const [t, r, s] = parts as [string, string, string];
  const at = parseInt(t, 36);
  if (!Number.isFinite(at) || now - at > maxAgeMs || at - now > 60_000) return false;
  const want = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`nonce:${t}.${r}`));
  return b64u(want).slice(0, 22) === s;
}

/* ───────────── Google ID token ───────────── */

export interface GoogleKey { kid: string; kty: string; n: string; e: string; alg?: string }
export interface GoogleClaims { sub: string; name?: string; given_name?: string; nonce?: string }
export class AuthError extends Error {
  constructor(public code: string, msg: string) { super(msg); }
}

export async function verifyGoogleIdToken(
  token: string,
  opts: { clientId: string; now: number; keys: (refresh: boolean) => Promise<GoogleKey[]>; expectNonce?: (nonce: string) => Promise<boolean> },
): Promise<GoogleClaims> {
  if (!opts.clientId) throw new AuthError('not_configured', 'Google sign-in is not set up on this server.');
  const parts = token.split('.');
  if (parts.length !== 3 || token.length > 4096) throw new AuthError('malformed', 'That sign-in token is not valid.');
  const [h, p, s] = parts as [string, string, string];
  let header: { alg?: string; kid?: string };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(dec.decode(unb64u(h)));
    claims = JSON.parse(dec.decode(unb64u(p)));
  } catch {
    throw new AuthError('malformed', 'That sign-in token is not valid.');
  }
  if (header.alg !== 'RS256' || !header.kid) throw new AuthError('alg', 'That sign-in token is not valid.');
  let keys = await opts.keys(false);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) { keys = await opts.keys(true); jwk = keys.find((k) => k.kid === header.kid); } // Google rotates keys: look once more
  if (!jwk) throw new AuthError('kid', 'That sign-in token is not valid.');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64u(s), enc.encode(`${h}.${p}`));
  if (!ok) throw new AuthError('signature', 'That sign-in token is not valid.');
  const nowS = Math.floor(opts.now / 1000);
  const iss = claims.iss;
  if (iss !== 'https://accounts.google.com' && iss !== 'accounts.google.com') throw new AuthError('iss', 'That sign-in token is not valid.');
  const aud = claims.aud;
  if (aud !== opts.clientId && !(Array.isArray(aud) && aud.includes(opts.clientId))) throw new AuthError('aud', 'That sign-in token is for another app.');
  if (typeof claims.exp !== 'number' || claims.exp + 60 < nowS) throw new AuthError('expired', 'That sign-in has expired. Try again.');
  if (typeof claims.iat === 'number' && claims.iat - 60 > nowS) throw new AuthError('iat', 'That sign-in token is not valid.');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new AuthError('sub', 'That sign-in token is not valid.');
  if (opts.expectNonce) {
    if (typeof claims.nonce !== 'string' || !(await opts.expectNonce(claims.nonce))) throw new AuthError('nonce', 'That sign-in could not be checked. Try again.');
  }
  return { sub: claims.sub, name: typeof claims.name === 'string' ? claims.name : undefined, given_name: typeof claims.given_name === 'string' ? claims.given_name : undefined, nonce: claims.nonce as string | undefined };
}

/** Opaque account id for a Google user: a one-way hash, so the Google id never appears in our data or in any view. */
export async function googleAccountId(sub: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(`gaffer-google:${sub}`));
  return `g_${b64u(h).slice(0, 22)}`;
}

/** A display name that is safe to show other players. */
export function cleanDisplayName(raw: string | undefined | null, fallback = 'Manager'): string {
  const n = (raw ?? '').normalize('NFC').replace(/[^\p{L}\p{N} .'_-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  return n || fallback;
}
