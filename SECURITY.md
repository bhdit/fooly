# Security policy

Fooly carries passwords and other secrets from a phone to a TV, so we take reports seriously.

## Reporting a vulnerability

**Please don't open a public issue.** Email **fooly@bhdit.com** with:

- what you found and where (SDK, protocol, the hosted service at fooly.bhdit.com),
- steps to reproduce, and what an attacker could do with it,
- whether you'd like to be credited.

We'll confirm we received it, keep you updated while we fix it, and credit you when it's published if you want.

## In scope

- The client libraries in this repository (JavaScript, Swift, Kotlin).
- The protocol as described in the [integration guide](docs/integration-guide.md#the-protocol-in-detail).
- The hosted service: the phone page, the API, and the developer dashboard at `fooly.bhdit.com`.

## Out of scope

- Phishing that relies on a person scanning a QR code they shouldn't have. Report the app instead with the "Report this page" link on the phone page; reported unverified apps are suspended automatically.
- Denial-of-service and volumetric testing against the hosted service. Please don't.

## Good to know

- The publishable key (`pk_…`) inside a TV app is not a secret. It identifies the app and can only start sessions shown under that app's name.
- The test vectors in `docs/test-vectors.json` contain published test keys. They are not secrets either.
