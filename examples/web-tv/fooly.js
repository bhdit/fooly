// Fooly SDK (ES module). Runs in any browser-based TV runtime (Tizen, webOS,
// Android TV WebView, Fire TV, ...) and Node 18+. The phone page imports the same
// crypto helpers, so both sides stay in lockstep.
//
//   import { Fooly } from './fooly.js';
//   const h = new Fooly({ publishableKey: 'pk_...', apiBase: 'https://fooly.bhdit.com/api' });
//   const s = await h.createSession({ fields: [{ name: 'username' }, { name: 'password', type: 'password' }] });
//   showQr(s.url); showText(s.code);            // QR content, plus fallback code
//   const { username, password } = await s.wait();
//
// Crypto: the TV makes an ECDH P-256 key pair and keeps the private key in memory.
// The phone makes its own ephemeral pair, derives a shared secret, runs it through
// HKDF-SHA256 and encrypts with AES-256-GCM, binding the session id as AAD.
// The server only ever stores {epk, iv, ct}.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();
const CURVE = { name: 'ECDH', namedCurve: 'P-256' };

export const b64u = {
  encode(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(str) {
    const s = str.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

async function deriveAesKey(privateKey, peerPublicRaw, sessionId, usages) {
  const peer = await subtle.importKey('raw', peerPublicRaw, CURVE, false, []);
  const bits = await subtle.deriveBits({ name: 'ECDH', public: peer }, privateKey, 256);
  const hkdf = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(sessionId), info: enc.encode('fooly-v1') },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  );
}

/** TV side: key pair for one session. The private key is non-extractable. */
export async function generateTvKeys() {
  const pair = await subtle.generateKey(CURVE, false, ['deriveBits']);
  return { privateKey: pair.privateKey, publicKey: b64u.encode(await subtle.exportKey('raw', pair.publicKey)) };
}

/** Phone side: encrypt the entered values so that only the TV can read them. */
export async function encryptForTv(tvPublicKey, sessionId, values) {
  const eph = await subtle.generateKey(CURVE, false, ['deriveBits']);
  const key = await deriveAesKey(eph.privateKey, b64u.decode(tvPublicKey), sessionId, ['encrypt']);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(sessionId) },
    key,
    enc.encode(JSON.stringify(values)),
  );
  return {
    epk: b64u.encode(await subtle.exportKey('raw', eph.publicKey)),
    iv: b64u.encode(iv),
    ct: b64u.encode(ct),
  };
}

/** TV side: decrypt what the phone sent. Throws if the data was tampered with or belongs to another session. */
export async function decryptFromPhone(privateKey, sessionId, { epk, iv, ct }) {
  const key = await deriveAesKey(privateKey, b64u.decode(epk), sessionId, ['decrypt']);
  const plain = await subtle.decrypt(
    { name: 'AES-GCM', iv: b64u.decode(iv), additionalData: enc.encode(sessionId) },
    key,
    b64u.decode(ct),
  );
  return JSON.parse(dec.decode(plain));
}

export class FoolyError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'FoolyError';
    this.code = code;
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(new FoolyError('aborted'));
    const t = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(new FoolyError('aborted')); }, { once: true });
  });
}

export class Session {
  constructor(h, data, privateKey, publicKey) {
    this._h = h;
    this._privateKey = privateKey;
    this._pollSecret = data.poll_secret;
    this.id = data.session_id;
    this.expiresAt = Date.parse(data.expires_at);
    /** Put this in the QR code. The TV's public key rides in the URL fragment, which browsers never send to a server. */
    this.url = `${data.phone_url}#k=${publicKey}`;
    /** Fallback for people who can't scan, e.g. "K7QM-X2PD". Enter it at `codeUrl`. */
    this.code = `${data.short_code.slice(0, 4)}-${data.short_code.slice(4)}`;
    this.codeUrl = data.phone_origin;
  }

  /** Resolves with the values the user typed, e.g. { username, password }. */
  async wait({ intervalMs = 1500, signal } = {}) {
    let failures = 0;
    for (;;) {
      if (signal && signal.aborted) throw new FoolyError('aborted');
      if (Date.now() > this.expiresAt + 5000) throw new FoolyError('expired', 'Session expired');
      let retryAfter = intervalMs;
      try {
        const res = await this._h._fetch(`${this._h.apiBase}/v1/sessions/${this.id}/result`, {
          headers: { Authorization: `Bearer ${this._pollSecret}` },
          signal,
        });
        if (res.status === 429) {
          retryAfter = intervalMs * 3;
        } else {
          const body = await res.json().catch(() => ({}));
          if (res.status === 404) throw new FoolyError('not_found');
          if (body.status === 'expired') throw new FoolyError('expired', 'Session expired');
          if (body.status === 'consumed') throw new FoolyError('consumed', 'Already collected');
          if (body.status === 'submitted') {
            try {
              return await decryptFromPhone(this._privateKey, this.id, body.payload);
            } catch (e) {
              throw new FoolyError('decrypt_failed', 'Could not decrypt the data from the phone');
            }
          }
          failures = 0;
        }
      } catch (e) {
        if (e instanceof FoolyError) throw e;
        if (e && e.name === 'AbortError') throw new FoolyError('aborted');
        if (++failures > 8) throw new FoolyError('network', 'Server unreachable');
        retryAfter = intervalMs * 2;
      }
      await sleep(retryAfter, signal);
    }
  }
}

export class Fooly {
  constructor({ publishableKey, apiBase = 'https://fooly.bhdit.com/api', fetch: fetchImpl }) {
    if (!publishableKey) throw new Error('publishableKey is required');
    this.publishableKey = publishableKey;
    this.apiBase = apiBase.replace(/\/$/, '');
    this._fetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  }

  /**
   * fields: [{ name, label?, type?: text|password|email|number|url|tel, required?, maxLength?, autocomplete? }]
   */
  async createSession({ fields, ttlSeconds = 300 }) {
    const { privateKey, publicKey } = await generateTvKeys();
    const res = await this._fetch(`${this.apiBase}/v1/sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.publishableKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields, public_key: publicKey, ttl_seconds: ttlSeconds }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new FoolyError(body.error || 'request_failed', body.message || `HTTP ${res.status}`);
    return new Session(this, body, privateKey, publicKey);
  }
}
