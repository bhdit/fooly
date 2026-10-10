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
