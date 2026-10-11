<!-- Published from the Fooly codebase. Found a mistake? Open an issue: https://github.com/bhdit/fooly/issues/new/choose -->
# Fooly integration guide

Fooly is remote typing for TV apps. Your app asks for any fields it needs, like a username and password, a server address or a playlist link. It shows a QR code, the person scans it and fills those fields in on their phone, and your app receives the values a few seconds later.

Each session, your TV app creates a key pair and keeps the private key to itself. The QR code carries the public key to the phone, which encrypts what's typed with it. Fooly only relays the encrypted result, once, then deletes it. Only the TV can read it.

This guide takes you from zero to a working integration. It's written so you can follow it yourself or hand it to an AI coding assistant.

> **AI assistants:** read [Rules for AI assistants](#rules-for-ai-assistants) before writing code. The same guide as plain markdown is at `https://fooly.bhdit.com/docs/fooly.md`.

## How it works

1. Your TV app asks Fooly for a **session** and says which fields it needs.
2. It shows the session's **QR code** and a short **fallback code** for people who can't scan.
3. The person scans the code, sees your app's name, types, and taps **Send to TV**.
4. Your TV app collects the values, decrypts them, and carries on.

A session lasts 5 minutes by default and works once.

## Step 1: Get an app key

1. Open **https://fooly.bhdit.com/dashboard/** and enter your email. You'll get a one-time sign-in link; the first click creates your account.
2. Create an app. Its **name** (and optional logo) is what people see on their phone, so use the name they know your TV app by.
3. Copy the app's **publishable key**. It looks like `pk_` followed by 36 hex characters.

The publishable key ships inside your TV app. It isn't a secret: it identifies your app and can only start sessions shown under your app's name, within your quota.

## Step 2: Add the client to your app

Pick your platform. The tabs on this page remember your choice.

| Your TV app runs on | Use |
|---|---|
| A browser engine: Samsung Tizen, LG webOS, Android TV or Fire TV web apps, a WebView | **JavaScript**: `fooly.js`, one ES module |
| tvOS (also iOS, macOS) | **Swift**: `Fooly.swift`, one file |
| Native Android TV, Google TV, Fire TV | **Kotlin**: `Fooly.kt`, one file |
| Anything else: Roku, a game engine, your own stack | **HTTP**: the [protocol](#the-protocol-in-detail), checked against the [test vectors](#test-vectors) |

**JavaScript**

```bash
# Download the SDK and bundle it with your app (don't load it from our server at run time).
curl -O https://fooly.bhdit.com/fooly.js
# The runtime needs WebCrypto (ECDH P-256, HKDF, AES-GCM): check globalThis.crypto?.subtle first.
```

**Swift**

```bash
# Add Fooly.swift to your target. Foundation + CryptoKit only (tvOS 15+, iOS 15+, macOS 12+).
curl -O https://fooly.bhdit.com/docs/samples/Fooly.swift
```

**Kotlin**

```kotlin
// Add Fooly.kt (https://fooly.bhdit.com/docs/samples/Fooly.kt) to your module and change its package line.
// It needs coroutines and the INTERNET permission, and minSdk 26.
dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
// AndroidManifest.xml: <uses-permission android:name="android.permission.INTERNET" />
```

**HTTP**

```bash
# Nothing to install: any HTTPS client, JSON, and a crypto library with
# P-256 ECDH, HKDF-SHA256 and AES-256-GCM. See "The protocol in detail" below.
```

## Step 3: Start a session and show it

Ask for the fields you need, then show the QR code and the fallback code. Encode the session URL exactly as given: it carries your TV's public key after the `#`, a part browsers never send to any server.

**JavaScript**

```javascript
import { Fooly } from './fooly.js';

const fooly = new Fooly({
  publishableKey: 'pk_your_key_here',
  apiBase: 'https://fooly.bhdit.com/api',
});

const session = await fooly.createSession({
  fields: [
    { name: 'username', label: 'Username', autocomplete: 'username' },
    { name: 'password', label: 'Password', type: 'password' },
  ],
});

drawQrCode(session.url);
showText(`Or go to ${new URL(session.codeUrl).host} and enter ${session.code}`);
```

**Swift**

```swift
let fooly = Fooly(publishableKey: "pk_your_key_here")

let session = try await fooly.createSession(fields: [
    ["name": "username", "label": "Username", "autocomplete": "username"],
    ["name": "password", "label": "Password", "type": "password"],
])

qrImageView.image = qrImage(session.url)
codeLabel.text = "Or go to \(session.codeHost) and enter \(session.code)"
```

**Kotlin**

```kotlin
val fooly = Fooly("pk_your_key_here")

val session = fooly.createSession(listOf(
    mapOf("name" to "username", "label" to "Username", "autocomplete" to "username"),
    mapOf("name" to "password", "label" to "Password", "type" to "password"),
))

qrImage.setImageBitmap(qrBitmap(session.url))
codeText.text = "Or go to ${session.codeHost} and enter ${session.code}"
```

**HTTP**

```http
POST https://fooly.bhdit.com/api/v1/sessions
Authorization: Bearer pk_your_key_here
Content-Type: application/json

{
  "fields": [
    { "name": "username", "label": "Username", "autocomplete": "username" },
    { "name": "password", "label": "Password", "type": "password" }
  ],
  "public_key": "<your TV's P-256 public key: 65-byte uncompressed point, base64url>",
  "ttl_seconds": 300
}

HTTP/1.1 201 Created
{
  "session_id": "Xq3c9V0kQ2mWb7nR1tYp8A",
  "poll_secret": "<43 characters: keep it on the TV, never show or log it>",
  "short_code": "K7QMX2PD",
  "phone_url": "https://fooly.bhdit.com/s/Xq3c9V0kQ2mWb7nR1tYp8A",
  "phone_origin": "https://fooly.bhdit.com",
  "expires_at": "2026-10-07T12:00:00.000Z"
}

QR code content:  phone_url + "#k=" + public_key
Fallback text:    "Or go to fooly.bhdit.com and enter K7QM-X2PD"
```

**Drawing the QR code.** Use any QR library with error correction level M and a small white margin:

**JavaScript**

```javascript
// qrcode-generator (MIT), bundle it from https://fooly.bhdit.com/vendor/qrcode.js
import qrcode from './qrcode.js';

function drawQrCode(canvas, text) {
  const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
  const n = qr.getModuleCount(), scale = 8, quiet = 2;
  canvas.width = canvas.height = (n + quiet * 2) * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
    if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
}
```

**Swift**

```swift
import CoreImage.CIFilterBuiltins
import UIKit

func qrImage(_ text: String, size: CGFloat = 480) -> UIImage? {
    let filter = CIFilter.qrCodeGenerator()
    filter.message = Data(text.utf8)
    filter.correctionLevel = "M"
    guard let output = filter.outputImage else { return nil }
    let scale = (size / output.extent.width).rounded(.down)   // whole pixels keep it sharp
    let scaled = output.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    guard let cg = CIContext().createCGImage(scaled, from: scaled.extent) else { return nil }
    return UIImage(cgImage: cg)
}
```

**Kotlin**

```kotlin
// implementation("com.google.zxing:core:3.5.3")
import android.graphics.Bitmap
import android.graphics.Color
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel

fun qrBitmap(text: String, size: Int = 480): Bitmap {
    val hints = mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M, EncodeHintType.MARGIN to 2)
    val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, hints)
    val pixels = IntArray(size * size) { i -> if (matrix[i % size, i / size]) Color.BLACK else Color.WHITE }
    return Bitmap.createBitmap(pixels, size, size, Bitmap.Config.ARGB_8888)
}
```

## Step 4: Wait for the values

The client polls until the person taps **Send to TV**, then decrypts on the TV. Stop waiting when the person leaves the screen. Every failure is recovered the same way: start a new session and show the new code.

**JavaScript**

```javascript
const controller = new AbortController();   // controller.abort() when the screen closes
try {
  const { username, password } = await session.wait({ signal: controller.signal });
  signIn(username, password);
} catch (err) {
  // err.code: 'expired' | 'consumed' | 'decrypt_failed' | 'not_found' | 'network' | 'aborted'
  if (err.code !== 'aborted') startOver();
}
```

**Swift**

```swift
let task = Task {   // task.cancel() when the screen closes
    do {
        let values = try await fooly.wait(for: session)
        signIn(values["username"] ?? "", values["password"] ?? "")
    } catch is CancellationError {
        // the screen closed
    } catch {
        startOver()   // FoolyError: .expired, .consumed, .decryptFailed, .notFound, .network
    }
}
```

**Kotlin**

```kotlin
val job = lifecycleScope.launch {   // cancelled with the screen's lifecycle, or call job.cancel()
    try {
        val values = fooly.wait(session)
        signIn(values.getValue("username"), values.getValue("password"))
    } catch (e: FoolyException) {
        startOver()   // Expired, Consumed, DecryptFailed, NotFound, Network
    }
}
```

**HTTP**

```http
GET https://fooly.bhdit.com/api/v1/sessions/Xq3c9V0kQ2mWb7nR1tYp8A/result
Authorization: Bearer <poll_secret>

# Repeat every 1-2 s until expires_at (+ a few seconds). Responses:
200 {"status":"pending"}                          poll again
200 {"status":"submitted","payload":{"epk":"...","iv":"...","ct":"..."}}
                                                  returned ONCE: decrypt it (see below)
200 {"status":"consumed"}                         already collected: start over
200 {"status":"expired"}                          time ran out: start over
404 {"error":"not_found"}                         wrong session or poll secret: start over
429 {"error":"rate_limited"}                      wait 3x longer, then poll again
```

## Complete client code

Each client is one file you can read in a few minutes. The JavaScript SDK and the Swift client are checked against the [test vectors](#test-vectors) on every test run. Check the Kotlin client the same way in your unit tests, as described there.

**JavaScript**

```javascript
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
```

**Swift**

```swift
// Fooly client for tvOS (also iOS and macOS). One file, no dependencies: Foundation + CryptoKit.
// Protocol v1. Verified against https://fooly.bhdit.com/docs/test-vectors.json and a live server.
//
//   let fooly = Fooly(publishableKey: "pk_...")
//   let session = try await fooly.createSession(fields: [
//       ["name": "username", "label": "Username"],
//       ["name": "password", "label": "Password", "type": "password"],
//   ])
//   showQRCode(session.url)                       // e.g. CIFilter.qrCodeGenerator()
//   showText("or go to \(session.codeHost) and enter \(session.code)")
//   let values = try await fooly.wait(for: session) // ["username": "...", "password": "..."]
//
// The private key never leaves this process, and the server only ever sees ciphertext.
// Never log `values` or `session.pollSecret`.

import CryptoKit
import Foundation

public enum FoolyError: Error, Equatable {
    case http(status: Int, code: String)   // e.g. 401 invalid_key, 402 quota_exceeded, 403 app_suspended
    case expired                           // nobody submitted in time: start a new session
    case consumed                          // already collected (by another poll)
    case notFound                          // unknown session or wrong poll secret
    case decryptFailed                     // junk or tampered data: start a new session
    case network                           // server unreachable after several retries
}

public struct FoolySession {
    public let id: String
    /// Put this in the QR code. The TV's public key rides in the #fragment, which is never sent to a server.
    public let url: String
    /// Fallback for people who can't scan, e.g. "K7QM-X2PD", entered at `codeHost`.
    public let code: String
    public let codeHost: String
    public let expiresAt: Date
    let pollSecret: String
    let privateKey: P256.KeyAgreement.PrivateKey
}

public struct Fooly {
    public let publishableKey: String
    public var apiBase: URL

    public init(publishableKey: String, apiBase: URL = URL(string: "https://fooly.bhdit.com/api")!) {
        self.publishableKey = publishableKey
        self.apiBase = apiBase
    }

    /// fields: [["name": "...", "label": "...", "type": "text|password|email|number|url|tel", "required": true, "maxLength": 256]]
    public func createSession(fields: [[String: Any]], ttlSeconds: Int = 300) async throws -> FoolySession {
        let key = P256.KeyAgreement.PrivateKey()
        var req = URLRequest(url: apiBase.appendingPathComponent("v1/sessions"))
        req.httpMethod = "POST"
        req.setValue("Bearer \(publishableKey)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: [
            "fields": fields,
            "public_key": Fooly.b64u(key.publicKey.x963Representation),   // 65-byte uncompressed point
            "ttl_seconds": ttlSeconds,
        ])
        let (data, response) = try await URLSession.shared.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard status == 201,
              let id = body["session_id"] as? String, let secret = body["poll_secret"] as? String,
              let phoneURL = body["phone_url"] as? String, let short = body["short_code"] as? String,
              let origin = body["phone_origin"] as? String, let exp = body["expires_at"] as? String
        else { throw FoolyError.http(status: status, code: body["error"] as? String ?? "request_failed") }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return FoolySession(
            id: id,
            url: "\(phoneURL)#k=\(Fooly.b64u(key.publicKey.x963Representation))",
            code: "\(short.prefix(4))-\(short.dropFirst(4))",
            codeHost: URL(string: origin)?.host ?? origin,
            expiresAt: iso.date(from: exp) ?? Date().addingTimeInterval(TimeInterval(ttlSeconds)),
            pollSecret: secret,
            privateKey: key)
    }

    /// Polls until the phone submits, then decrypts. Cancel the surrounding Task to stop.
    public func wait(for s: FoolySession, interval: TimeInterval = 1.5) async throws -> [String: String] {
        var failures = 0
        while true {
            try Task.checkCancellation()
            if Date() > s.expiresAt.addingTimeInterval(5) { throw FoolyError.expired }
            var delay = interval
            var req = URLRequest(url: apiBase.appendingPathComponent("v1/sessions/\(s.id)/result"))
            req.setValue("Bearer \(s.pollSecret)", forHTTPHeaderField: "Authorization")
            do {
                let (data, response) = try await URLSession.shared.data(for: req)
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                failures = 0
                if status == 429 {
                    delay = interval * 3
                } else if status == 404 {
                    throw FoolyError.notFound
                } else {
                    let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
                    switch body["status"] as? String {
                    case "submitted":
                        guard let payload = body["payload"] as? [String: String] else { throw FoolyError.decryptFailed }
                        return try Fooly.decrypt(privateKey: s.privateKey, sessionId: s.id, payload: payload)
                    case "expired": throw FoolyError.expired
                    case "consumed": throw FoolyError.consumed
                    default: break   // "pending"
                    }
                }
            } catch let e as FoolyError {
                throw e
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                failures += 1
                if failures > 8 { throw FoolyError.network }
                delay = interval * 2
            }
            try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
        }
    }

    /// ECDH P-256 -> HKDF-SHA256 (salt = session id, info = "fooly-v1", 32 bytes) -> AES-256-GCM
    /// with the session id as additional data. `ct` is ciphertext followed by the 16-byte tag.
    public static func decrypt(privateKey: P256.KeyAgreement.PrivateKey, sessionId: String,
                               payload: [String: String]) throws -> [String: String] {
        do {
            guard let epk = payload["epk"].flatMap(b64uDecode), let iv = payload["iv"].flatMap(b64uDecode),
                  let ct = payload["ct"].flatMap(b64uDecode), ct.count > 16 else { throw FoolyError.decryptFailed }
            let shared = try privateKey.sharedSecretFromKeyAgreement(with: P256.KeyAgreement.PublicKey(x963Representation: epk))
            let key = shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: Data(sessionId.utf8),
                                                     sharedInfo: Data("fooly-v1".utf8), outputByteCount: 32)
            let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: iv), ciphertext: ct.dropLast(16), tag: ct.suffix(16))
            let plain = try AES.GCM.open(box, using: key, authenticating: Data(sessionId.utf8))
            return try JSONDecoder().decode([String: String].self, from: plain)
        } catch {
            throw FoolyError.decryptFailed
        }
    }

    static func b64u(_ d: Data) -> String {
        d.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    static func b64uDecode(_ s: String) -> Data? {
        var t = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        t += String(repeating: "=", count: (4 - t.count % 4) % 4)
        return Data(base64Encoded: t)
    }
}
```

**Kotlin**

```kotlin
// Fooly client for Android TV, Google TV and Fire TV (Kotlin). One file.
// Dependencies: kotlinx-coroutines (for suspend + delay). Everything else is in Android:
// java.security / javax.crypto for the crypto, org.json for JSON, HttpURLConnection for HTTP.
// minSdk 26 (java.util.Base64, java.time.Instant). Needs <uses-permission android:name="android.permission.INTERNET"/>.
// Protocol v1. Check it against https://fooly.bhdit.com/docs/test-vectors.json in a unit test.
//
//   val fooly = Fooly("pk_...")
//   val session = fooly.createSession(listOf(
//       mapOf("name" to "username", "label" to "Username"),
//       mapOf("name" to "password", "label" to "Password", "type" to "password"),
//   ))
//   showQrCode(session.url)                         // e.g. ZXing
//   showText("Or go to ${session.codeHost} and enter ${session.code}")
//   val values = fooly.wait(session)                // mapOf("username" to "...", "password" to "...")
//
// The private key never leaves this process, and the server only ever sees ciphertext.
// Never log `values` or the poll secret.

package com.example.fooly // change to your package

import java.io.IOException
import java.math.BigInteger
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import java.time.Instant
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import kotlin.coroutines.coroutineContext

sealed class FoolyException(message: String) : Exception(message) {
    /** e.g. 401 invalid_key, 402 quota_exceeded, 403 app_suspended, 429 rate_limited */
    class Http(val status: Int, val code: String) : FoolyException("HTTP $status: $code")
    class Expired : FoolyException("expired")             // nobody submitted in time: start a new session
    class Consumed : FoolyException("consumed")           // already collected
    class NotFound : FoolyException("not_found")          // unknown session or wrong poll secret
    class DecryptFailed : FoolyException("decrypt_failed") // junk or tampered data: start a new session
    class Network : FoolyException("network")             // server unreachable after several retries
}

class FoolySession internal constructor(
    val id: String,
    /** Put this in the QR code. The TV's public key rides in the #fragment, never sent to a server. */
    val url: String,
    /** Fallback for people who can't scan, e.g. "K7QM-X2PD", entered at [codeHost]. */
    val code: String,
    val codeHost: String,
    val expiresAtMillis: Long,
    internal val pollSecret: String,
    internal val keyPair: KeyPair,
)

class Fooly(
    private val publishableKey: String,
    private val apiBase: String = "https://fooly.bhdit.com/api",
) {
    /** fields: listOf(mapOf("name" to "...", "label" to "...", "type" to "text|password|email|number|url|tel")) */
    suspend fun createSession(fields: List<Map<String, Any>>, ttlSeconds: Int = 300): FoolySession =
        withContext(Dispatchers.IO) {
            val keyPair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
            val publicKey = b64u(uncompressedPoint(keyPair.public as ECPublicKey))
            val body = JSONObject()
                .put("fields", JSONArray(fields.map { JSONObject(it) }))
                .put("public_key", publicKey)
                .put("ttl_seconds", ttlSeconds)
            val (status, json) = request("POST", "$apiBase/v1/sessions", "Bearer $publishableKey", body)
            if (status != 201) throw FoolyException.Http(status, json.optString("error", "request_failed"))
            val short = json.getString("short_code")
            FoolySession(
                id = json.getString("session_id"),
                url = json.getString("phone_url") + "#k=" + publicKey,
                code = short.substring(0, 4) + "-" + short.substring(4),
                codeHost = URL(json.getString("phone_origin")).host,
                expiresAtMillis = Instant.parse(json.getString("expires_at")).toEpochMilli(),
                pollSecret = json.getString("poll_secret"),
                keyPair = keyPair,
            )
        }

    /** Polls until the phone submits, then decrypts. Cancel the calling coroutine to stop. */
    suspend fun wait(session: FoolySession, intervalMs: Long = 1500): Map<String, String> {
        var failures = 0
        while (true) {
            coroutineContext.ensureActive()
            if (System.currentTimeMillis() > session.expiresAtMillis + 5000) throw FoolyException.Expired()
            var delayMs = intervalMs
            try {
                val (status, json) = withContext(Dispatchers.IO) {
                    request("GET", "$apiBase/v1/sessions/${session.id}/result", "Bearer ${session.pollSecret}", null)
                }
                failures = 0
                when {
                    status == 429 -> delayMs = intervalMs * 3
                    status == 404 -> throw FoolyException.NotFound()
                    else -> when (json.optString("status")) {
                        "submitted" -> return decrypt(session.keyPair, session.id, json.getJSONObject("payload"))
                        "expired" -> throw FoolyException.Expired()
                        "consumed" -> throw FoolyException.Consumed()
                        // "pending": poll again
                    }
                }
            } catch (e: IOException) {
                if (++failures > 8) throw FoolyException.Network()
                delayMs = intervalMs * 2
            }
            delay(delayMs)
        }
    }

    companion object {
        /**
         * ECDH P-256 -> HKDF-SHA256 (salt = session id, info = "fooly-v1", 32 bytes) -> AES-256-GCM
         * with the session id as additional data. `ct` is the ciphertext followed by the 16-byte tag.
         */
        fun decrypt(keyPair: KeyPair, sessionId: String, payload: JSONObject): Map<String, String> {
            try {
                val params = (keyPair.public as ECPublicKey).params
                val epk = b64uDecode(payload.getString("epk"))
                require(epk.size == 65 && epk[0] == 4.toByte())
                val phoneKey = KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(
                    ECPoint(BigInteger(1, epk.copyOfRange(1, 33)), BigInteger(1, epk.copyOfRange(33, 65))), params))
                val shared = KeyAgreement.getInstance("ECDH").run {
                    init(keyPair.private); doPhase(phoneKey, true); generateSecret()   // 32-byte X coordinate
                }
                val sid = sessionId.toByteArray(Charsets.UTF_8)
                val key = hkdfSha256(shared, salt = sid, info = "fooly-v1".toByteArray(Charsets.UTF_8))
                val plain = Cipher.getInstance("AES/GCM/NoPadding").run {
                    init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, b64uDecode(payload.getString("iv"))))
                    updateAAD(sid)
                    doFinal(b64uDecode(payload.getString("ct")))
                }
                val obj = JSONObject(String(plain, Charsets.UTF_8))
                return obj.keys().asSequence().associateWith { obj.getString(it) }
            } catch (e: Exception) {
                throw FoolyException.DecryptFailed()
            }
        }

        /** RFC 5869 with a single output block (32 bytes is all v1 needs). */
        fun hkdfSha256(ikm: ByteArray, salt: ByteArray, info: ByteArray): ByteArray {
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(SecretKeySpec(salt, "HmacSHA256"))
            val prk = mac.doFinal(ikm)                  // extract
            mac.init(SecretKeySpec(prk, "HmacSHA256"))
            mac.update(info)
            mac.update(1.toByte())
            return mac.doFinal()                        // expand: T(1), 32 bytes
        }

        /** 0x04 || X || Y, each coordinate left-padded to 32 bytes. */
        fun uncompressedPoint(key: ECPublicKey): ByteArray {
            fun fixed32(n: BigInteger): ByteArray {
                val b = n.toByteArray()
                return when {
                    b.size == 32 -> b
                    b.size > 32 -> b.copyOfRange(b.size - 32, b.size)   // drop the sign byte
                    else -> ByteArray(32 - b.size) + b
                }
            }
            return byteArrayOf(4) + fixed32(key.w.affineX) + fixed32(key.w.affineY)
        }

        fun b64u(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        fun b64uDecode(s: String): ByteArray = Base64.getUrlDecoder().decode(s)

        private fun request(method: String, url: String, auth: String, body: JSONObject?): Pair<Int, JSONObject> {
            val conn = URL(url).openConnection() as HttpURLConnection
            try {
                conn.requestMethod = method
                conn.connectTimeout = 10_000
                conn.readTimeout = 15_000
                conn.setRequestProperty("Authorization", auth)
                if (body != null) {
                    conn.doOutput = true
                    conn.setRequestProperty("Content-Type", "application/json")
                    conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                }
                val status = conn.responseCode
                val text = (if (status < 400) conn.inputStream else conn.errorStream)?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
                return status to (if (text.isBlank()) JSONObject() else JSONObject(text))
            } finally {
                conn.disconnect()
            }
        }
    }
}
```

## The protocol in detail

For platforms without a ready-made client. You need HTTPS + JSON, P-256 ECDH, HKDF-SHA256 and AES-256-GCM. Write it, then check it against the [test vectors](#test-vectors) before talking to the API.

1. **Make a key pair** for every session. Keep the private key in memory only. Export the public key as the 65-byte uncompressed point (`0x04 || X || Y`), base64url without padding (87 characters).
2. **Create the session** and show it, as in [Step 3](#step-3-start-a-session-and-show-it) (HTTP tab). The QR content is `phone_url + "#k=" + public key`, exactly.
3. **Poll** as in [Step 4](#step-4-wait-for-the-values) (HTTP tab).
4. **Decrypt** the payload. All binary values are base64url without padding:
   1. `shared` = ECDH(TV private key, `epk`). `epk` is the phone's uncompressed P-256 point. Use the 32-byte X coordinate, which is what every standard ECDH API returns.
   2. `key` = HKDF-SHA256(input = `shared`, salt = UTF-8 bytes of `session_id`, info = UTF-8 bytes of `fooly-v1`, length = 32 bytes).
   3. `plaintext` = AES-256-GCM decrypt(`key`, nonce = `iv` (12 bytes), additional data = UTF-8 bytes of `session_id`, input = `ct`). `ct` is the ciphertext followed by the 16-byte tag.
   4. `plaintext` is UTF-8 JSON: an object mapping each field name to the string the person typed.

If any step fails, treat it like an expired session: discard it and start a new one. Never fall back to anything unencrypted.

## Fields

Each field is an object. Only `name` is required.

| Property | Values | Default |
|---|---|---|
| `name` | Starts with a letter; letters, digits, `_`; up to 32 characters; unique in the session | (required) |
| `label` | What the person sees, up to 40 characters | the name |
| `type` | `text`, `password`, `email`, `number`, `url`, `tel` | `text` |
| `required` | `true` or `false` | `true` |
| `maxLength` | 1 to 512 | 256 |
| `autocomplete` | `off`, `username`, `email`, `current-password`, `new-password`, `one-time-code`, `name`, `url`, `tel` | `current-password` for passwords, `email`, `tel` and `url` for those types, otherwise `off` |

Apps can ask for up to **4 fields** per session (more on request through the [contact form](https://fooly.bhdit.com/contact/?topic=limits)). Every value comes back as a **string**, including `number` fields, so convert and validate in your app.

Set `autocomplete` correctly: phone password managers then fill the form for the person, which is often faster than typing.

## Errors when creating a session

| HTTP | `error` | What it means |
|---|---|---|
| 400 | `invalid_body`, `invalid_fields`, `too_many_fields`, `invalid_public_key` | Your request is wrong; `message` says how |
| 401 | `invalid_key` | Missing, malformed or unknown publishable key (also after the app is deleted) |
| 402 | `quota_exceeded` | This month's session limit is used up (sessions count when someone scans the code) |
| 402 | `code_limit` | Too many codes generated this month without being scanned. Create a code only when someone is about to use it |
| 403 | `app_suspended` | The app was suspended, usually after abuse reports |
| 429 | `rate_limited` | Too many requests; back off |
| 503 | `busy` | Try again |

Show the person a friendly "Couldn't start, try again" and log the `error` code (never the values).

## What the person sees

- **The QR link** opens a page with your app's name and logo and the fields you asked for, with a **Send to TV** button.
- **Unverified apps** carry a caution note: "Only continue if you just opened [your app] on your own TV." Verified apps show "Verified app" instead.
- Every page has a **Report this page** link. Reports from several different people suspend an unverified app until it's reviewed.
- After sending: "Sent to your TV. You can close this page."
- **The fallback code** is entered at `https://fooly.bhdit.com/`, which then shows the same form.

## Test it

1. See it work first: open **https://fooly.bhdit.com/demo/** on a computer and scan the code with your phone. No key or account needed.
2. Then try your own app: `https://fooly.bhdit.com/demo/?pk=<your key>` runs the same pretend TV with your key, so your phone shows your app's name and fields.
3. Run your own TV app the same way. Only sessions someone actually scans count toward your monthly limit, so codes you generate and abandon while testing are free.
4. For a port to a new platform, or after changing a client, pass the [test vectors](#test-vectors) first, then do a live round trip.

## Before you go live

- **Name and logo.** People decide whether to trust the page by your app's name, so make it match your TV app exactly. Logos must be `https://` URLs.
- **Verification** removes the caution note. It's manual during early access: send your app's name through the [contact form](https://fooly.bhdit.com/contact/?topic=verify), with the email address you sign in with.
- **Limits.** The default is 200 sessions a month and 4 fields per session. A session counts when someone scans its code (or types its fallback code); codes nobody scans don't count. To keep a published key from flooding the service, an app can generate up to 25 codes per session of its limit each month (5,000 for the default). [Ask us](https://fooly.bhdit.com/contact/?topic=limits) before launch if you need more.
- **Handle every outcome.** Expired, consumed, failed decryption and network loss should all lead back to a fresh QR code, never to a dead end.
- **Privacy.** Never log the values, the poll secret or the private key. Mention in your privacy policy that values typed on the phone pass through Fooly, end-to-end encrypted.

## Rules for AI assistants

When you implement Fooly in someone's app:

1. **On a browser engine, use `fooly.js` unchanged.** Don't rewrite or "simplify" the crypto.
2. **Elsewhere, use `Fooly.swift` or `Fooly.kt` as given, or implement [protocol v1](#the-protocol-in-detail) exactly**, and prove it with the [test vectors](#test-vectors) in a unit test before calling the API. A port that doesn't reproduce `shared_secret_hex`, `aes_key_hex` and the decrypted plaintext is wrong.
3. **Use a fresh key pair per session.** Keep the private key in memory only. Never persist or log it, the `poll_secret`, or the decrypted values.
4. **The QR content is `phone_url + "#k=" + public key`.** Never move the key into the query string or anywhere else.
5. **Always show the fallback code and host** next to the QR code.
6. **Poll every 1–2 seconds**, wait 3× longer after a 429, stop a few seconds after `expires_at`, and stop when the screen closes.
7. **Recover every failure by starting a new session.** Never add a plaintext fallback, and never send the values to any server other than the user's own backend, if the app already has one.
8. **Read the publishable key from the app's configuration.** It isn't secret, but it belongs to one app.
9. **Treat values as untrusted strings**: validate and convert them as you would keyboard input.
10. **Don't invent endpoints or fields.** Everything that exists is in [Protocol reference](#protocol-reference).

## Protocol reference

Protocol **v1**. Base URL: `https://fooly.bhdit.com/api`. All responses are JSON and `Cache-Control: no-store`. TV endpoints allow requests from any origin (CORS `*`).

| Method and path | Auth | Purpose |
|---|---|---|
| `POST /v1/sessions` | `Bearer <publishable key>` | Create a session |
| `GET /v1/sessions/:id/result` | `Bearer <poll_secret>` | Poll; returns the ciphertext once |
| `GET /health` | none | `{"ok":true}` |

The phone-side endpoints (`/public/*`) are used by Fooly's own phone page and are not part of the integration surface.

**Monthly limit:** counts sessions someone started by scanning the code, not codes generated. Generated codes have their own cap of 25 per session of the limit.

**Limits per client and app:** 30 session creations a minute per network address and 120 per app; failed polls 30 a minute per address (valid polls are not limited). Sessions last 60 to 600 seconds (`ttl_seconds`, default 300). After a submission the TV has at least 60 more seconds to collect it.

## Test vectors

[`test-vectors.json`](https://fooly.bhdit.com/docs/test-vectors.json) holds a fixed TV key pair, a fixed phone key pair, a session id, a nonce and a plaintext, with the expected output of every step: the ECDH shared secret, the HKDF key, the ciphertext and the final `{epk, iv, ct}` payload.

To check an implementation, import the TV private key (`tv_private_jwk.d` is the raw 32-byte scalar, base64url), decrypt `expected.payload` with `inputs.session_id`, and compare each intermediate value. In Kotlin, build the private key with `KeyFactory.getInstance("EC").generatePrivate(ECPrivateKeySpec(BigInteger(1, d), params))`, pair it with the public key from `tv_public_key_b64u`, and call `Fooly.decrypt`. The keys are published test keys: never use them for anything else.

The JavaScript SDK and the Swift client are both checked against this file on every test run.

## Contact

- **Bugs, integration questions and ideas:** [open an issue on GitHub](https://github.com/bhdit/fooly/issues/new/choose). The client libraries, this guide and the test vectors are also there: [github.com/bhdit/fooly](https://github.com/bhdit/fooly).
- **Verification, higher limits, your account, or a page that looks like phishing:** the [contact form](https://fooly.bhdit.com/contact/).
- **Security problems:** privately, through the [contact form](https://fooly.bhdit.com/contact/?topic=security) or [GitHub's private reporting](https://github.com/bhdit/fooly/security/advisories/new), not a public issue.
