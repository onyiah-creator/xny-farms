/**
 * Test helper: Cloudflare Access JWTs signed with a generated RSA keypair, and the JWKS document a mocked
 * https://<team>/cdn-cgi/access/certs would serve.
 */
const enc = new TextEncoder();
export const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
export const b64uJson = (o) => b64u(enc.encode(JSON.stringify(o)));

export const TEAM = 'xny-test.cloudflareaccess.com';
export const AUD = 'aud-tag-0123456789abcdef';

export async function makeKey(kid) {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', kp.publicKey));
  return { kid, priv: kp.privateKey, spki, jwk: { kty: jwk.kty, n: jwk.n, e: jwk.e, kid, alg: 'RS256', use: 'sig' } };
}

export const jwksDoc = (...keys) => ({ keys: keys.map((k) => k.jwk), public_cert: { kid: keys[0]?.kid, cert: '-----BEGIN CERTIFICATE-----' }, public_certs: [] });

export function claims(nowMs, over = {}) {
  const now = Math.floor(nowMs / 1000);
  return { iss: `https://${TEAM}`, aud: [AUD], sub: 'user-1', email: 'admin@xnyfarms.com', iat: now, nbf: now - 5, exp: now + 3600, type: 'app', ...over };
}

/** A correctly signed RS256 token. Pass header overrides to forge odd ones. */
export async function sign(key, payload, headerOver = {}) {
  const input = b64uJson({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...headerOver }) + '.' + b64uJson(payload);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.priv, enc.encode(input)));
  return input + '.' + b64u(sig);
}

/** The classic downgrade: alg HS256, "signed" with the RSA PUBLIC key bytes as the HMAC secret. */
export async function signHs256WithPublicKey(key, payload) {
  const input = b64uJson({ alg: 'HS256', kid: key.kid, typ: 'JWT' }) + '.' + b64uJson(payload);
  const hmac = await crypto.subtle.importKey('raw', key.spki, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return input + '.' + b64u(new Uint8Array(await crypto.subtle.sign('HMAC', hmac, enc.encode(input))));
}

export const unsigned = (key, payload, alg = 'none') => b64uJson({ alg, kid: key.kid, typ: 'JWT' }) + '.' + b64uJson(payload) + '.';
