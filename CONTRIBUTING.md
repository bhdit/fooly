# Contributing

Thanks for helping make TV apps less painful to set up.

## Issues

[Open an issue](https://github.com/bhdit/fooly/issues/new/choose) for a bug, a question about integrating Fooly, a mistake in the docs, or an idea. Pick the form that fits and fill it in; the more exact the platform and steps, the faster we can help.

**Never paste** what a person typed, a `poll_secret`, private keys or any user's data into an issue. Publishable keys (`pk_…`) are fine.

Security problems go to **fooly@bhdit.com**, not issues. See [SECURITY.md](SECURITY.md).

## Pull requests

Welcome, especially for the client libraries and the docs. This repository is published from Fooly's main codebase, so a merged change is carried over there and then published back here with credit.

Before sending a change to a client library:

1. Check it against [docs/test-vectors.json](docs/test-vectors.json): it must reproduce `shared_secret_hex`, `aes_key_hex` and the decrypted plaintext exactly.
2. Run a live round trip against the [demo](https://fooly.bhdit.com/demo/) or your own app key.
3. Keep each client one dependency-light file. That's what makes them easy to drop into a TV app.

## Porting to a new platform

Follow [the protocol in detail](docs/integration-guide.md#the-protocol-in-detail), prove it with the test vectors first, then open a pull request or an issue linking your port.
