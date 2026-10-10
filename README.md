# Fooly

**Let people type on their phone instead of with a TV remote.**

Fooly is QR-code text input for Smart TV apps. Your TV app shows a QR code, the person scans it with their phone, types what your app asked for (a username and password, a Wi-Fi password, a server or playlist URL, a search), and your app receives it a few seconds later. Everything typed is **end-to-end encrypted** on the phone for your TV, so Fooly's servers only ever see ciphertext.

**[Try the live demo](https://fooly.bhdit.com/demo/)** · **[Integration guide](https://fooly.bhdit.com/docs/)** · **[Get an app key](https://fooly.bhdit.com/dashboard/)** · **[Report an issue](https://github.com/bhdit/fooly/issues/new/choose)**

## Why

Typing a password with a remote control, one letter at a time on an on-screen keyboard, is the worst part of setting up a TV app. People give up. Fooly turns it into the same thing they already do every day: scan a code, type on a real keyboard, done. Phone password managers can fill the form for them.

- **Any fields, not just sign-in.** Unlike the OAuth device flow, which only signs a person in, Fooly delivers whatever your app needs: credentials, server addresses, Wi-Fi details, IPTV playlist URLs, a search term.
- **End-to-end encrypted.** The phone encrypts for a key that never leaves the TV (P-256 ECDH, HKDF-SHA256, AES-256-GCM). The server stores ciphertext only and deletes it the moment your TV collects it.
- **No app on the phone.** It's a web page. Nothing to install.
- **Fallback code.** People who can't scan type a short code on any device.
- **Built against phishing.** The phone always shows your app's name. Unverified apps carry a caution note, and every page has a report button.

## Platforms

| TV platform | Client |
|---|---|
| Samsung Tizen, LG webOS, Android TV and Fire TV web apps, any WebView | [JavaScript SDK](sdk/javascript/fooly.js), one ES module, no dependencies |
| Apple TV (tvOS), iOS, macOS | [Swift client](sdk/swift/Fooly.swift), one file, Foundation + CryptoKit |
| Android TV, Google TV, Fire TV (native) | [Kotlin client](sdk/kotlin/Fooly.kt), one file, Android built-ins + coroutines |
| Roku, game engines, anything else | [HTTP protocol](docs/integration-guide.md#the-protocol-in-detail), checked with the [test vectors](docs/test-vectors.json) |

## Quick start (JavaScript)

```js
import { Fooly } from './fooly.js';

const fooly = new Fooly({ publishableKey: 'pk_your_key_here', apiBase: 'https://fooly.bhdit.com/api' });

const session = await fooly.createSession({
  fields: [
    { name: 'username', label: 'Username', autocomplete: 'username' },
    { name: 'password', label: 'Password', type: 'password' },
  ],
});

drawQrCode(session.url);   // any QR library
showText(`Or go to ${new URL(session.codeUrl).host} and enter ${session.code}`);

const { username, password } = await session.wait();
```

Swift and Kotlin look the same. See the [integration guide](https://fooly.bhdit.com/docs/) for every platform, side by side, and [examples/web-tv](examples/web-tv/) for a complete TV screen.

## How it works

1. Your TV app makes a key pair and asks Fooly for a session, listing the fields it needs.
2. It shows the QR code. The TV's public key rides in the URL fragment, which browsers never send to a server.
3. The phone opens the page, shows your app's name and the fields, encrypts what's typed for the TV's key, and sends only ciphertext.
4. Your TV collects the ciphertext once and decrypts it locally.

The full protocol, with every byte spelled out, is in the [guide](docs/integration-guide.md#the-protocol-in-detail).

## For AI coding assistants

The guide is written to be followed by an AI assistant as well as a person: a plain-markdown copy lives at [docs/integration-guide.md](docs/integration-guide.md) and at `https://fooly.bhdit.com/docs/fooly.md`, with an index at `https://fooly.bhdit.com/llms.txt`. It includes a section of [rules for AI assistants](docs/integration-guide.md#rules-for-ai-assistants).

## Help and issues

- **A bug, an integration question or an idea:** [open an issue](https://github.com/bhdit/fooly/issues/new/choose).
- **A security problem:** please don't open an issue. Email **fooly@bhdit.com**, see [SECURITY.md](SECURITY.md).
- **Verification, higher limits, your account:** email **fooly@bhdit.com**.

## What's in this repository

This repository holds Fooly's public parts: the client libraries, the integration guide, the test vectors and examples. It is published from Fooly's main codebase, so pull requests are welcome and get carried over (see [CONTRIBUTING.md](CONTRIBUTING.md)). The hosted service runs at **[fooly.bhdit.com](https://fooly.bhdit.com)**.

## License

The client libraries, examples and documentation are released under the [MIT License](LICENSE).
