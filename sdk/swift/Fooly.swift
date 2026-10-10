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
